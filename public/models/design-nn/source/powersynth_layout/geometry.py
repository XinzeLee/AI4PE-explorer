"""Independent geometric checks and upstream hierarchical corner-stitch adapter."""
from __future__ import annotations

from dataclasses import dataclass, replace
from itertools import combinations
import math
import threading

from .model import Design, DesignError, Layout, load_design
from ._vendor import corner_stitch as cs

TOL = 1e-7
_CS_LOCK = threading.RLock()


def contains(rect, x, y, tolerance=TOL):
    a, b, w, h = rect
    return a - tolerance <= x <= a + w + tolerance and b - tolerance <= y <= b + h + tolerance


def enclosure(outer, inner):
    x, y, w, h = outer
    a, b, u, v = inner
    return min(a-x, b-y, x+w-a-u, y+h-b-v)


def gap(a, b):
    x, y, w, h = a
    u, v, s, t = b
    return max(u-x-w, x-u-s, 0.0), max(v-y-h, y-v-t, 0.0)


def spacing(d: Design, a, b):
    values = d.rules.net_clearance_mm
    return max(d.rules.clearance_mm, values.get(a.net+"|"+b.net, 0), values.get(b.net+"|"+a.net, 0))


def _segment_hits_box(a, b, low, high):
    """Conservative capsule/box check after expanding a box by wire radius."""
    first, last = 0.0, 1.0
    for p, q, lo, hi in zip(a, b, low, high):
        delta = q-p
        if abs(delta) < 1e-12:
            if p < lo or p > hi:
                return False
        else:
            u,v = sorted(((lo-p)/delta,(hi-p)/delta))
            first, last = max(first,u), min(last,v)
            if first > last:
                return False
    return True


@dataclass(frozen=True)
class ValidationResult:
    valid: bool
    issues: tuple[str, ...]


def validate_layout(layout: Layout | Design, reference: Design | None = None) -> ValidationResult:
    d = layout.design if isinstance(layout, Layout) else layout
    try:
        load_design(d)
    except DesignError as exc:
        return ValidationResult(False, (str(exc),))
    issues = []
    board = (0, 0, *d.board_mm)
    for r in d.regions:
        border = d.rules.edge_clearance_mm if d.layer_map[r.layer].patterned else 0.0
        if enclosure(board, r.rect_mm) < border - TOL:
            issues.append(f"{r.id}: board-edge clearance")
        for dim, minimum in zip(r.rect_mm[2:], r.min_size_mm):
            if dim < max(minimum, d.rules.min_trace_width_mm) - TOL:
                issues.append(f"{r.id}: minimum trace dimension")
    for a, b in combinations(d.regions, 2):
        if a.layer != b.layer:
            continue
        ax, ay, aw, ah = a.rect_mm
        bx, by, bw, bh = b.rect_mm
        overlap_x = min(ax+aw, bx+bw) - max(ax, bx)
        overlap_y = min(ay+ah, by+bh) - max(ay, by)
        if overlap_x > TOL and overlap_y > TOL:
            issues.append(f"{a.id}/{b.id}: overlapping copper rectangles; split their union first")
        if a.net != b.net and math.hypot(*gap(a.rect_mm, b.rect_mm)) < spacing(d, a, b) - TOL:
            issues.append(f"{a.id}/{b.id}: copper clearance")
    for c in d.components:
        if enclosure(d.region_map[c.parent].rect_mm, c.rect_mm) < d.rules.enclosure_mm - TOL:
            issues.append(f"{c.id}: parent enclosure")
    for a, b in combinations(d.components, 2):
        if d.region_map[a.parent].layer != d.region_map[b.parent].layer:
            continue
        if math.hypot(*gap(a.rect_mm, b.rect_mm)) < d.rules.component_spacing_mm - TOL:
            issues.append(f"{a.id}/{b.id}: component spacing")
    refs = [t.id for t in d.terminals] + [c.id+"."+p.id for c in d.components for p in c.pins]
    for ref in refs:
        point, region, pad = d.endpoint(ref)
        if region:
            rect = d.region_map[region].rect_mm
            x, y, _ = point
            if enclosure(rect, (x-pad[0]/2, y-pad[1]/2, *pad)) < -TOL:
                issues.append(f"{ref}: contact pad is outside {region}")
    from .mesh import wire_points
    for wire in (*d.bond_wires, *d.paths):
        if hasattr(wire,"planar_axis"):
            a,_,_ = d.endpoint(wire.source)
            b,_,_ = d.endpoint(wire.target)
            dx,dy = abs(a[0]-b[0]),abs(a[1]-b[1])
            if dx > TOL and dy > TOL:
                issues.append(f"{wire.id}: bond wire violates Manhattan alignment (tilted in plan view)")
            elif max(dx,dy) <= TOL:
                issues.append(f"{wire.id}: bond wire requires a nonzero planar span")
            elif wire.planar_axis == "x" and dy > TOL or wire.planar_axis == "y" and dx > TOL:
                issues.append(f"{wire.id}: bond wire is not aligned with planar_axis={wire.planar_axis}")
        allowed = {d.endpoint(ref)[1] for ref in (wire.source,wire.target)} - {None}
        allowed_nets = {d.region_map[name].net for name in allowed}
        radius = wire.diameter_mm/2
        for index in range(getattr(wire,"count",1)):
            points = wire_points(d,wire,index)
            if getattr(wire,"max_length_mm",None) is not None:
                length = sum(math.dist(a,b) for a,b in zip(points,points[1:]))
                if length > wire.max_length_mm+TOL:
                    issues.append(f"{wire.id}: maximum bond-wire length")
            for r in d.regions:
                if r.id in allowed or r.net in allowed_nets:
                    continue
                x,y,w,h = r.rect_mm
                layer = d.layer_map[r.layer]
                low=(x-radius,y-radius,layer.z_mm-radius)
                high=(x+w+radius,y+h+radius,layer.z_mm+layer.thickness_mm+radius)
                if any(_segment_hits_box(a,b,low,high) for a,b in zip(points,points[1:])):
                    issues.append(f"{wire.id}: conductor intersects foreign copper {r.id}")
    if reference is not None:
        for name in ("layers", "terminals", "bond_wires", "paths", "loop", "rules"):
            if getattr(d, name) != getattr(reference, name):
                issues.append(f"{name}: evaluation conditions or connectivity changed")
        if set(d.region_map) != set(reference.region_map):
            issues.append("Region IDs changed")
        for a in reference.regions:
            b = d.region_map.get(a.id)
            if b is None:
                continue
            if a.net != b.net or a.layer != b.layer:
                issues.append(f"{a.id}: net or layer changed")
            if replace(b, rect_mm=a.rect_mm) != a:
                issues.append(f"{a.id}: region specification changed")
            if a.fixed and any(abs(x-y) > TOL for x, y in zip(a.rect_mm, b.rect_mm)):
                issues.append(f"{a.id}: fixed geometry moved")
        comps = {c.id: c for c in d.components}
        if set(comps) != {c.id for c in reference.components}:
            issues.append("Component IDs changed")
        for old in reference.components:
            new = comps.get(old.id)
            if new is None or new.parent != old.parent or tuple(new.rect_mm[2:]) != tuple(old.rect_mm[2:]):
                issues.append(f"{old.id}: footprint or parent changed")
            elif old.fixed and any(abs(x-y) > TOL for x, y in zip(old.rect_mm, new.rect_mm)):
                issues.append(f"{old.id}: fixed component moved")
            if new is not None and replace(new, rect_mm=old.rect_mm) != old:
                issues.append(f"{old.id}: component or electrical specification changed")
        # Shared copper edges and ordering encode the input routing topology.
        for a, b in combinations(reference.regions, 2):
            if a.layer != b.layer or a.net != b.net:
                continue
            oa, ob = a.rect_mm, b.rect_mm
            if max(gap(oa, ob)) <= TOL:
                na, nb = d.region_map[a.id].rect_mm, d.region_map[b.id].rect_mm
                if max(gap(na, nb)) > TOL:
                    issues.append(f"{a.id}/{b.id}: copper connection broken")
        for axis in (0, 1):
            mapping = {0.0: [0.0], reference.board_mm[axis]: [d.board_mm[axis]]}
            new_objects = {item.id: item for item in (*d.regions, *d.components)}
            for old in (*reference.regions, *reference.components):
                new = new_objects.get(old.id)
                if new is None:
                    continue
                for end in (False, True):
                    old_value = round(old.rect_mm[axis]+(old.rect_mm[axis+2] if end else 0), 9)
                    new_value = new.rect_mm[axis]+(new.rect_mm[axis+2] if end else 0)
                    mapping.setdefault(old_value, []).append(new_value)
            values = sorted(mapping.items())
            if any(max(v)-min(v)>TOL for _,v in values) or any(b[1][0] <= a[1][0]+TOL for a,b in zip(values,values[1:])):
                issues.append(f"{'Horizontal' if axis == 0 else 'Vertical'} coordinate topology changed")
    return ValidationResult(not issues, tuple(issues))


@dataclass
class CornerPlanes:
    horizontal: object
    vertical: object

    def summary(self):
        return {"horizontal_nodes": len(self.horizontal.hNodeList),
                "vertical_nodes": len(self.vertical.vNodeList),
                "horizontal_tiles": sum(len(n.stitchList) for n in self.horizontal.hNodeList),
                "vertical_tiles": sum(len(n.stitchList) for n in self.vertical.vNodeList)}


def build_corner_stitch(design: Design) -> CornerPlanes:
    """Insert copper and nested footprints using the actual upstream H/V algorithms.

    The upstream plane uses integer micrometres. Serialization of construction
    prevents its module-level tile counters from leaking across concurrent calls.
    """
    checks = validate_layout(design)
    if not checks.valid:
        raise DesignError("; ".join(checks.issues))
    with _CS_LOCK:
        cs.HID = cs.VID = 0
        h, v = cs.Substrate((0, 0), round(design.board_mm[0]*1000),
                            round(design.board_mm[1]*1000), "EMPTY").Initialize()
        ht, vt = cs.Tree([h], None), cs.Tree(None, [v])
        parents = {}
        for i, region in enumerate(design.regions):
            if not design.layer_map[region.layer].patterned:
                continue
            x, y, w, length = (round(val*1000) for val in region.rect_mm)
            h.insert("+", x, y+length, x+w, y, f"Type_{i+1}", "+", ht, h, rotate_angle=0)
            v.insert("+", x, y+length, x+w, y, f"Type_{i+1}", "+", vt, v, rotate_angle=0)
            parents[region.id] = h.child[-1], v.child[-1]
        for i, component in enumerate(design.components):
            if component.parent not in parents:
                continue
            ph, pv = parents[component.parent]
            x, y, w, length = (round(val*1000) for val in component.rect_mm)
            kind = f"Type_{len(design.regions)+i+1}"
            ph.insert("+", x, y+length, x+w, y, kind, "+", ht, ph, rotate_angle=0)
            pv.insert("+", x, y+length, x+w, y, kind, "+", vt, pv, rotate_angle=0)
        return CornerPlanes(ht, vt)
