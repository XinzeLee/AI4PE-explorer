"""Rectilinear volume-filament mesh and three-dimensional interconnect geometry."""
from __future__ import annotations

from dataclasses import dataclass
from collections import defaultdict
from bisect import bisect_left, insort
import math
from functools import cached_property

import numpy as np

from .geometry import contains, validate_layout
from .model import BondWire, Design, DesignError, EvaluationError
from .solver import CircuitBranch


@dataclass(frozen=True)
class MeshSettings:
    cell_mm: float = 4.0
    thickness_cells: int = 1
    quadrature_order: int = 6
    max_branches: int = 1400
    wire_segments: int | None = None

    def __post_init__(self):
        if not math.isfinite(self.cell_mm) or self.cell_mm <= 0:
            raise DesignError("mesh cell_mm must be positive and finite")
        if type(self.thickness_cells) is not int or not 1 <= self.thickness_cells <= 8:
            raise DesignError("thickness_cells must be an integer in [1,8]")
        if type(self.quadrature_order) is not int or not 2 <= self.quadrature_order <= 20:
            raise DesignError("quadrature_order must be an integer in [2,20]")
        if type(self.max_branches) is not int or self.max_branches < 1:
            raise DesignError("max_branches must be a positive integer")
        if self.wire_segments is not None and (type(self.wire_segments) is not int or self.wire_segments < 2):
            raise DesignError("wire_segments must be an integer >= 2")


@dataclass(frozen=True)
class Filament:
    id: str
    source: str
    target: str
    start_m: tuple[float, float, float]
    end_m: tuple[float, float, float]
    width_m: float
    thickness_m: float
    resistivity_ohm_m: float
    round_wire: bool = False

    @cached_property
    def length_m(self):
        return float(np.linalg.norm(np.subtract(self.end_m, self.start_m)))

    @cached_property
    def area_m2(self):
        return math.pi*(self.width_m/2)**2 if self.round_wire else self.width_m*self.thickness_m


class UnionFind:
    def __init__(self):
        self.parent = {}

    def find(self, value):
        self.parent.setdefault(value, value)
        if self.parent[value] != value:
            self.parent[value] = self.find(self.parent[value])
        return self.parent[value]

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


@dataclass
class Mesh:
    filaments: list[Filament]
    lumped: list[CircuitBranch]
    source: str
    sink: str
    nodes: int
    diagnostics: list[str]


def wire_points(design, wire, wire_index=0, segments=None):
    a = np.asarray(design.endpoint(wire.source)[0], dtype=float)
    b = np.asarray(design.endpoint(wire.target)[0], dtype=float)
    if not isinstance(wire, BondWire):
        return np.asarray([a, *wire.waypoints_mm, b], dtype=float)
    n = segments or wire.segments
    planar = b[:2]-a[:2]
    norm = np.linalg.norm(planar)
    perpendicular = np.array([-planar[1], planar[0]])/norm if norm > 1e-12 else np.array([1.0, 0.0])
    shift = (wire_index-(wire.count-1)/2)*wire.pitch_mm
    t = np.linspace(0, 1, n+1)
    points = a[None, :]*(1-t[:, None])+b[None, :]*t[:, None]
    # Separate landing positions inside each finite equipotential pin/pad.
    # Sharing a circuit node does not mean sharing the physical wire volume.
    points[:, :2] += perpendicular[None, :]*shift
    points[:, 2] += 4*t*(1-t)*wire.loop_height_mm
    return points


def _cuts(regions, axis, contacts, step):
    boundaries, uniform, centers, pad_edges = set(), set(), set(), set()
    for r in regions:
        start, length = r.rect_mm[axis], r.rect_mm[axis+2]
        boundaries.update((start,start+length))
        uniform.update(np.linspace(start, start+length, max(1, math.ceil(length/step))+1))
    for point, pad in contacts:
        for offset in (0, -pad[axis]/2, pad[axis]/2):
            val = point[axis]+offset
            if any(r.rect_mm[axis]-1e-8 <= val <= r.rect_mm[axis]+r.rect_mm[axis+2]+1e-8 for r in regions):
                (centers if offset == 0 else pad_edges).add(val)
    # Do not generate nanometre-long filaments when a regular grid line happens
    # to be almost coincident with a pad edge. True copper boundaries always
    # survive; near-equivalent interior sampling locations are coalesced.
    tolerance=min(step*.02,min((pad[axis]*.1 for _,pad in contacts),default=.05),.05)
    values=sorted({round(float(v),9) for v in boundaries})
    for priority in (centers,pad_edges,uniform):
        for value in sorted(priority):
            value=round(float(value),9)
            i=bisect_left(values,value)
            neighbors=values[max(0,i-1):i+1]
            if not neighbors or min(abs(value-other) for other in neighbors)>tolerance:
                insort(values,value)
    return values


def _dual(values, index):
    return (values[index] if index == 0 else (values[index-1]+values[index])/2,
            values[index] if index == len(values)-1 else (values[index]+values[index+1])/2)


def _width(regions, along, low, high, direction):
    intervals = []
    for region in regions:
        rect = region.rect_mm
        if rect[direction]-1e-9 <= along <= rect[direction]+rect[direction+2]+1e-9:
            lo, hi = max(low, rect[1-direction]), min(high, rect[1-direction]+rect[3-direction])
            if hi > lo+1e-10:
                intervals.append((lo, hi))
    total, end = 0.0, -math.inf
    for lo, hi in sorted(intervals):
        total += max(0, hi-max(lo, end))
        end = max(end, hi)
    return total


def build_mesh(design: Design, settings: MeshSettings) -> Mesh:
    check = validate_layout(design)
    if not check.valid:
        raise DesignError("Invalid layout: "+"; ".join(check.issues))
    uf, filaments, lumped = UnionFind(), [], []
    contacts = []
    for terminal in design.terminals:
        contacts.append((terminal.id, *design.endpoint(terminal.id)))
    for c in design.components:
        for p in c.pins:
            name = c.id+"."+p.id
            contacts.append((name, *design.endpoint(name)))
    groups = defaultdict(list)
    for r in design.regions:
        groups[(r.layer, r.net)].append(r)
    for group_index, ((layer_id, net), regions) in enumerate(sorted(groups.items())):
        layer = design.layer_map[layer_id]
        ids = {r.id for r in regions}
        group_contacts = [(ref, point, region, pad) for ref, point, region, pad in contacts if region in ids]
        xs = _cuts(regions, 0, [(p, pad) for _, p, _, pad in group_contacts], settings.cell_mm)
        ys = _cuts(regions, 1, [(p, pad) for _, p, _, pad in group_contacts], settings.cell_mm)
        nz = settings.thickness_cells
        dz = layer.thickness_mm/nz
        zs = [layer.z_mm+(i+0.5)*dz for i in range(nz)]
        nodes = {}
        for i, x in enumerate(xs):
            for j, y in enumerate(ys):
                if any(contains(r.rect_mm, x, y) for r in regions):
                    for k, z in enumerate(zs):
                        nodes[(i,j,k)] = (f"g{group_index}:{i}:{j}:{k}", (x,y,z))
        def add(node_a, node_b, width, thick):
            a, b = node_a[0], node_b[0]
            if min(width, thick) <= 1e-10:
                return
            filaments.append(Filament(f"mesh_{len(filaments)}", a, b,
                tuple(v*1e-3 for v in node_a[1]), tuple(v*1e-3 for v in node_b[1]),
                width*1e-3, thick*1e-3, layer.resistivity_ohm_m))
        for (i,j,k), node in nodes.items():
            x, y, z = node[1]
            for direction, delta in [(0, (1,0,0)), (1, (0,1,0))]:
                target = (i+delta[0], j+delta[1], k)
                if target not in nodes:
                    continue
                other = nodes[target]
                mid = (node[1][direction]+other[1][direction])/2
                perpendicular = ys if direction == 0 else xs
                idx = j if direction == 0 else i
                lo, hi = _dual(perpendicular, idx)
                width = _width(regions, mid, lo, hi, direction)
                if width > 1e-9:
                    add(node, other, width, dz)
            if (i,j,k+1) in nodes:
                dx = _dual(xs, i); dy = _dual(ys, j)
                # Cuts include all rectangle boundaries; this dual cell can be
                # clipped at an island boundary. Preserve its occupied area.
                area = sum(max(0,min(dx[1],r.rect_mm[0]+r.rect_mm[2])-max(dx[0],r.rect_mm[0]))*
                           max(0,min(dy[1],r.rect_mm[1]+r.rect_mm[3])-max(dy[0],r.rect_mm[1])) for r in regions)
                if area > 1e-12:
                    add(node, nodes[(i,j,k+1)], math.sqrt(area), math.sqrt(area))
        for ref, point, region_id, pad in group_contacts:
            contact_node = "contact:"+ref
            touched = []
            rect = design.region_map[region_id].rect_mm
            for (i,j,k), (node_id, xyz) in nodes.items():
                if (abs(xyz[0]-point[0]) <= pad[0]/2+1e-8 and
                    abs(xyz[1]-point[1]) <= pad[1]/2+1e-8 and contains(rect, *xyz[:2])):
                    uf.union(contact_node, node_id)
                    touched.append(node_id)
            if not touched:
                raise EvaluationError(f"No conductor mesh under contact {ref}")
            endpoint = "endpoint:"+ref
            top = (point[0], point[1], layer.z_mm+layer.thickness_mm/2)
            if abs(top[2]-point[2]) < 1e-9:
                uf.union(endpoint, contact_node)
            else:
                filaments.append(Filament("contact_"+ref, contact_node, endpoint,
                    tuple(v*1e-3 for v in top), tuple(v*1e-3 for v in point),
                    pad[0]*1e-3, pad[1]*1e-3, layer.resistivity_ohm_m))
    for wire in (*design.bond_wires, *design.paths):
        for index in range(wire.count if isinstance(wire, BondWire) else 1):
            points = wire_points(design, wire, index, settings.wire_segments)
            length = sum(float(np.linalg.norm(b-a)) for a,b in zip(points, points[1:]))
            if isinstance(wire, BondWire) and wire.max_length_mm is not None and length > wire.max_length_mm+1e-8:
                raise EvaluationError(f"{wire.id}: wire length {length:g} mm exceeds max_length_mm")
            ids = ["endpoint:"+wire.source, *[f"wire:{wire.id}:{index}:{i}" for i in range(1,len(points)-1)], "endpoint:"+wire.target]
            for i, (a,b) in enumerate(zip(points, points[1:])):
                if np.linalg.norm(b-a) < 1e-9:
                    uf.union(ids[i], ids[i+1])
                    continue
                filaments.append(Filament(f"{wire.id}:{index}:{i}", ids[i], ids[i+1],
                    tuple(a*1e-3), tuple(b*1e-3), wire.diameter_mm*1e-3, wire.diameter_mm*1e-3,
                    wire.resistivity_ohm_m, True))
    for c in design.components:
        state = design.loop.device_states.get(c.id, "off")
        for i, connection in enumerate(c.connections):
            if state in connection.states:
                a, b = ("endpoint:"+c.id+"."+pin for pin in connection.pins)
                if connection.resistance_ohm == 0 and connection.inductance_h == 0:
                    uf.union(a, b)
                else:
                    lumped.append(CircuitBranch(f"device:{c.id}:{i}", a, b,
                                                connection.resistance_ohm, connection.inductance_h))
    collapsed = []
    for item in filaments:
        a,b = uf.find(item.source), uf.find(item.target)
        if a != b:
            collapsed.append(Filament(item.id,a,b,item.start_m,item.end_m,item.width_m,
                                       item.thickness_m,item.resistivity_ohm_m,item.round_wire))
    lumped = [CircuitBranch(b.id,uf.find(b.source),uf.find(b.target),b.resistance_ohm,b.inductance_h)
              for b in lumped if uf.find(b.source) != uf.find(b.target)]
    if len(collapsed)+len(lumped) > settings.max_branches:
        raise EvaluationError(f"Mesh has {len(collapsed)+len(lumped)} branches, exceeding max_branches={settings.max_branches}; increase cell_mm or the explicit limit")
    nodes = {n for b in [*collapsed,*lumped] for n in (b.source,b.target)}
    return Mesh(collapsed, lumped, uf.find("endpoint:"+design.loop.source), uf.find("endpoint:"+design.loop.sink),
                len(nodes), ["Uniform-current volume filaments; finite equipotential contact pads.",
                             "Near-coincident interior grid cuts coalesced within min(2% of cell size, 10% of pad width, 0.05 mm); copper boundaries retained.",
                             "No capacitance, magnetic materials, thermal effects, or automatic skin-depth refinement.",
                             "The source/sink port closes the specified modeled return path; external fixture inductance is excluded."])
