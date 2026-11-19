"""Topology-preserving horizontal and vertical difference-constraint graphs.

Uses upstream Vertex/Edge records and the same coordinate-cut representation.
HiGHS solves the reduced single-layer graph, including fixed-dimension cycles,
without all-path enumeration or optional optimization-framework dependencies.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import combinations
import math

import networkx as nx
import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix

from ._vendor.graph_types import Edge, Vertex
from .geometry import build_corner_stitch, gap, spacing, validate_layout
from .model import Design, DesignError, Layout


def prepare_optimization(design: Design) -> Design:
    """Release die placement and patterned copper while preserving fixtures.

    The source object is not modified. Leads, non-die components, passive
    conductors, and any component/region defining a measurement port stay fixed.
    Electrical settings, topology, dimensions of footprints, and rules are kept.
    """
    pinned_components={c.id for c in design.components if c.kind != "die"}
    pinned_regions=set()
    for ref in (design.loop.source,design.loop.sink):
        terminal=next((t for t in design.terminals if t.id==ref),None)
        if terminal is not None:
            if terminal.region is not None:
                pinned_regions.add(terminal.region)
            if terminal.align_to:
                pinned_components.add(terminal.align_to.split(".",1)[0])
        elif "." in ref:
            pinned_components.add(ref.split(".",1)[0])
    return replace(design,
        regions=tuple(replace(r,fixed=(not design.layer_map[r.layer].patterned or r.id in pinned_regions)) for r in design.regions),
        components=tuple(replace(c,fixed=c.id in pinned_components) for c in design.components))


@dataclass(frozen=True)
class Difference:
    source: int
    target: int
    minimum_mm: float
    reason: str


class AxisGraph:
    def __init__(self, design: Design, axis: int):
        self.axis = axis
        self.initial_extent = design.board_mm[axis]
        self.cuts = sorted({0.0, self.initial_extent, *(round(v, 9) for item in (*design.regions, *design.components)
                            for v in (item.rect_mm[axis], item.rect_mm[axis]+item.rect_mm[axis+2]))})
        self.indices = {round(x, 9): i for i, x in enumerate(self.cuts)}
        self.vertices = [Vertex(index=i, coordinate=x) for i, x in enumerate(self.cuts)]
        self.edges: list[Difference] = []
        self.fixed = {self.idx(0): 0.0}
        self.end = self.idx(self.initial_extent)
        for lo, hi in zip(self.cuts, self.cuts[1:]):
            self.add(lo, hi, 0.001, "coordinate ordering")
        for r in design.regions:
            left, right = r.rect_mm[axis], r.rect_mm[axis]+r.rect_mm[axis+2]
            self.add(left, right, max(r.min_size_mm[axis], design.rules.min_trace_width_mm), r.id+" minimum dimension")
            border = design.rules.edge_clearance_mm if design.layer_map[r.layer].patterned else 0.0
            self.add(0, left, border, r.id+" edge")
            self.add(right, self.initial_extent, border, r.id+" edge")
            if r.fixed:
                self.fixed[self.idx(left)] = left
                self.fixed[self.idx(right)] = right
        for c in design.components:
            left, right = c.rect_mm[axis], c.rect_mm[axis]+c.rect_mm[axis+2]
            self.add(left, right, c.rect_mm[axis+2], c.id+" fixed footprint")
            self.add(right, left, -c.rect_mm[axis+2], c.id+" fixed footprint")
            parent = design.region_map[c.parent]
            self.add(parent.rect_mm[axis], left, design.rules.enclosure_mm, c.id+" enclosure")
            self.add(right, parent.rect_mm[axis]+parent.rect_mm[axis+2], design.rules.enclosure_mm, c.id+" enclosure")
            if c.fixed:
                self.fixed[self.idx(left)] = left
                self.fixed[self.idx(right)] = right
        for a, b in combinations(design.regions, 2):
            if a.layer == b.layer and a.net != b.net:
                self._separate(a.rect_mm, b.rect_mm, spacing(design, a, b), a.id+"/"+b.id)
        for a, b in combinations(design.components, 2):
            if design.region_map[a.parent].layer == design.region_map[b.parent].layer:
                self._separate(a.rect_mm, b.rect_mm, design.rules.component_spacing_mm, a.id+"/"+b.id)
        # Pads have finite area; keep their fractional anchors clear of edges.
        for terminal in design.terminals:
            if terminal.region:
                r = design.region_map[terminal.region]
                size = terminal.pad_mm[axis]/2
                if terminal.align_axis == ("x" if axis == 0 else "y"):
                    comp_id,_,pin_id = terminal.align_to.partition(".")
                    comp = next(c for c in design.components if c.id == comp_id)
                    pin = next(p for p in comp.pins if p.id == pin_id)
                    offset = pin.offset_mm[axis]
                    self.add(r.rect_mm[axis],comp.rect_mm[axis],size-offset,terminal.id+" aligned pad lower enclosure")
                    self.add(comp.rect_mm[axis],r.rect_mm[axis]+r.rect_mm[axis+2],offset+size,terminal.id+" aligned pad upper enclosure")
                    continue
                fraction = terminal.uv[axis]
                minimum = max(size/max(fraction, 1e-12), size/max(1-fraction, 1e-12))
                self.add(r.rect_mm[axis], r.rect_mm[axis]+r.rect_mm[axis+2], minimum, terminal.id+" pad")
        self.nx_graph = nx.MultiDiGraph()
        self.nx_graph.add_nodes_from(range(len(self.vertices)))
        self.upstream_edges = []
        for i, e in enumerate(self.edges):
            self.nx_graph.add_edge(e.source, e.target, weight=e.minimum_mm, reason=e.reason)
            self.upstream_edges.append(Edge(self.vertices[e.source], self.vertices[e.target],
                                           constraint=e.minimum_mm, index=i, type="flexible", weight=e.minimum_mm))

    def idx(self, val):
        return self.indices[round(val, 9)]

    def add(self, lo, hi, value, reason):
        if self.idx(lo) == self.idx(hi):
            if value > 1e-9:
                raise DesignError(f"Infeasible shared coordinate: {reason}")
            return
        self.edges.append(Difference(self.idx(lo), self.idx(hi), value, reason))

    def _separate(self, a, b, clearance, reason):
        dx, dy = gap(a, b)
        # Preserve one separating direction. Global ordered cuts preserve the other.
        selected = 0 if dx >= dy else 1
        if selected != self.axis:
            return
        lo, hi = (a, b) if a[self.axis]+a[self.axis+2] <= b[self.axis]+1e-8 else (b, a)
        self.add(lo[self.axis]+lo[self.axis+2], hi[self.axis], clearance, reason+" spacing")

    def solve(self, *, extent=None, objective=None):
        n = len(self.vertices)
        rows, cols, data, bound = [], [], [], []
        for i, edge in enumerate(self.edges):
            rows.extend([i, i]); cols.extend([edge.source, edge.target]); data.extend([1, -1])
            bound.append(-edge.minimum_mm)
        matrix = coo_matrix((data, (rows, cols)), shape=(len(bound), n)).tocsr()
        bounds = [(0, None) for _ in range(n)]
        for i, v in self.fixed.items():
            bounds[i] = (v, v)
        if extent is not None:
            if not math.isfinite(extent) or extent <= 0:
                raise DesignError("Floorplan dimensions must be finite and positive")
            if self.end in self.fixed and abs(extent-self.fixed[self.end])>1e-8:
                raise DesignError("Infeasible floorplan: a fixed conductor pins this boundary")
            bounds[self.end] = (extent, extent)
        c = np.zeros(n) if objective is None else np.asarray(objective)
        if objective is None:
            c[self.end] = 1
            c += np.arange(n, dtype=float)*1e-9
        result = linprog(c, A_ub=matrix, b_ub=bound, bounds=bounds, method="highs")
        if not result.success:
            raise DesignError(f"Infeasible {'horizontal' if self.axis == 0 else 'vertical'} constraint graph: {result.message}")
        return result.x


def _reconstruct(design, gx, gy, x, y):
    def rect(original):
        ax, ay, w, h = original
        left, right = x[gx.idx(ax)], x[gx.idx(ax+w)]
        bottom, top = y[gy.idx(ay)], y[gy.idx(ay+h)]
        return tuple(round(v, 6) for v in (left, bottom, right-left, top-bottom))
    return replace(design, board_mm=(round(float(x[gx.end]), 6), round(float(y[gy.end]), 6)),
                   regions=tuple(replace(r, rect_mm=rect(r.rect_mm)) for r in design.regions),
                   components=tuple(replace(c, rect_mm=rect(c.rect_mm)) for c in design.components))


def generate_candidates(design: Design, *, mode: str = "fixed", count: int = 10,
                        floorplan_mm=None, seed: int = 0, variable_scale=(1.05, 1.7)) -> list[Layout]:
    """Return the baseline plus ``count`` legal candidates. Seed controls all search.

    Modes: minimum (one compact candidate), variable, fixed. The initial layout
    always remains first, even if a requested candidate floorplan is smaller.
    """
    if mode not in {"minimum", "variable", "fixed"}:
        raise DesignError("mode must be minimum, variable, or fixed")
    if type(count) is not int or count < 1:
        raise DesignError("count must be a positive integer")
    if type(seed) is not int or seed < 0:
        raise DesignError("seed must be a nonnegative integer")
    if len(variable_scale) != 2 or not 1 <= variable_scale[0] <= variable_scale[1] or not all(math.isfinite(v) for v in variable_scale):
        raise DesignError("variable_scale must be a finite increasing range >= 1")
    checks = validate_layout(design)
    if not checks.valid:
        raise DesignError("Invalid initial layout: " + "; ".join(checks.issues))
    planes = build_corner_stitch(design)
    gx, gy = AxisGraph(design, 0), AxisGraph(design, 1)
    minimum = (gx.solve(), gy.solve())
    rng = np.random.default_rng(seed)
    results = [Layout("initial", design, diagnostics=(f"Corner stitch: {planes.summary()}",))]
    total = 1 if mode == "minimum" else count
    floorplan = tuple(floorplan_mm if floorplan_mm is not None else design.board_mm)
    if len(floorplan) != 2:
        raise DesignError("floorplan_mm requires width and height")
    attempts = 0
    while len(results) <= total and attempts < total*30:
        attempts += 1
        locs = []
        for axis, graph in enumerate((gx, gy)):
            if mode == "minimum":
                locations = minimum[axis]
            else:
                extent = floorplan[axis] if mode == "fixed" else float(minimum[axis][graph.end])*rng.uniform(*variable_scale)
                # Integral micron difference bounds stay feasible after rounding.
                extent = math.ceil(extent*1000)/1000
                base = graph.solve(extent=extent)
                obj = rng.normal(size=len(graph.cuts))
                obj[graph.end] = 0
                vertex = graph.solve(extent=extent, objective=obj)
                # One coefficient for the entire vector preserves every inequality.
                fraction = rng.uniform(0.1, 0.9)
                locations = np.round((1-fraction)*base+fraction*vertex, 3)
            locs.append(locations)
        candidate = _reconstruct(design, gx, gy, *locs)
        check = validate_layout(candidate, reference=design)
        if check.valid:
            results.append(Layout(f"{mode}_{len(results)-1:04d}", candidate, mode, seed))
        elif mode == "minimum":
            raise DesignError("Minimum layout violates a contact or geometry rule: "+"; ".join(check.issues))
    if len(results) <= total:
        raise DesignError("Could not generate the requested legal layouts; review contact sizes and constraints")
    return results
