"""Public design types. Geometry is in mm; electrical quantities use SI units."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
import json
import math
from pathlib import Path
from typing import Any, Mapping


class DesignError(ValueError):
    """Invalid input, infeasible geometry, or an undefined electrical problem."""


class EvaluationError(RuntimeError):
    """A layout could not be evaluated numerically."""


@dataclass(frozen=True)
class Layer:
    id: str
    z_mm: float
    thickness_mm: float
    resistivity_ohm_m: float = 1.724e-8
    patterned: bool = True


@dataclass(frozen=True)
class Region:
    id: str
    net: str
    layer: str
    rect_mm: tuple[float, float, float, float]
    min_size_mm: tuple[float, float] = (1.0, 1.0)
    fixed: bool = False


@dataclass(frozen=True)
class Pin:
    id: str
    offset_mm: tuple[float, float, float]
    contact_region: str | None = None
    pad_mm: tuple[float, float] = (0.5, 0.5)


@dataclass(frozen=True)
class DeviceLink:
    pins: tuple[str, str]
    states: tuple[str, ...] = ("on",)
    resistance_ohm: float = 1e-6
    inductance_h: float = 0.0


@dataclass(frozen=True)
class Component:
    id: str
    parent: str
    rect_mm: tuple[float, float, float, float]
    height_mm: float
    pins: tuple[Pin, ...]
    connections: tuple[DeviceLink, ...] = ()
    fixed: bool = False
    kind: str = "die"


@dataclass(frozen=True)
class Terminal:
    id: str
    region: str | None = None
    uv: tuple[float, float] = (0.5, 0.5)
    pad_mm: tuple[float, float] = (0.5, 0.5)
    position_mm: tuple[float, float, float] | None = None
    align_to: str | None = None
    align_axis: str | None = None


@dataclass(frozen=True)
class BondWire:
    id: str
    source: str
    target: str
    diameter_mm: float
    loop_height_mm: float
    count: int = 1
    pitch_mm: float = 0.4
    segments: int = 4
    resistivity_ohm_m: float = 2.82e-8
    max_length_mm: float | None = None
    planar_axis: str = "auto"


@dataclass(frozen=True)
class PathConductor:
    """Explicit external return/lead geometry; endpoints follow their anchors."""
    id: str
    source: str
    target: str
    diameter_mm: float
    waypoints_mm: tuple[tuple[float, float, float], ...] = ()
    resistivity_ohm_m: float = 1.724e-8


@dataclass(frozen=True)
class Rules:
    clearance_mm: float = 1.0
    enclosure_mm: float = 0.5
    edge_clearance_mm: float = 0.5
    min_trace_width_mm: float = 1.0
    component_spacing_mm: float = 0.5
    net_clearance_mm: Mapping[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class Loop:
    source: str
    sink: str
    frequency_hz: float
    device_states: Mapping[str, str] = field(default_factory=dict)
    name: str = "power_loop"


@dataclass(frozen=True)
class Design:
    name: str
    board_mm: tuple[float, float]
    layers: tuple[Layer, ...]
    regions: tuple[Region, ...]
    components: tuple[Component, ...]
    terminals: tuple[Terminal, ...]
    bond_wires: tuple[BondWire, ...]
    loop: Loop
    rules: Rules = field(default_factory=Rules)
    paths: tuple[PathConductor, ...] = ()
    schema_version: int = 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def layer_map(self) -> dict[str, Layer]:
        return {item.id: item for item in self.layers}

    @property
    def region_map(self) -> dict[str, Region]:
        return {item.id: item for item in self.regions}

    def endpoint(self, ref: str) -> tuple[tuple[float, float, float], str | None, tuple[float, float]]:
        for term in self.terminals:
            if term.id == ref:
                if term.region is None:
                    return tuple(term.position_mm), None, term.pad_mm
                region = self.region_map[term.region]
                layer = self.layer_map[region.layer]
                x, y, w, h = region.rect_mm
                point = [x + w * term.uv[0], y + h * term.uv[1], layer.z_mm + layer.thickness_mm / 2]
                if term.align_to is not None:
                    # Only device-pin anchors are supported, so alignment cannot
                    # introduce terminal-to-terminal dependency cycles.
                    anchor_component, separator, anchor_pin = term.align_to.partition(".")
                    component = next((c for c in self.components if c.id == anchor_component), None)
                    if not separator or component is None or not any(p.id == anchor_pin for p in component.pins):
                        raise DesignError(f"{term.id}: align_to must name a component pin")
                    anchor, _, _ = self.endpoint(term.align_to)
                    index = 0 if term.align_axis == "x" else 1
                    point[index] = anchor[index]
                return tuple(point), term.region, term.pad_mm
        comp_id, _, pin_id = ref.partition(".")
        for comp in self.components:
            if comp.id == comp_id:
                for pin in comp.pins:
                    if pin.id == pin_id:
                        region = self.region_map[comp.parent]
                        layer = self.layer_map[region.layer]
                        return (comp.rect_mm[0] + pin.offset_mm[0],
                                comp.rect_mm[1] + pin.offset_mm[1],
                                layer.z_mm + layer.thickness_mm + pin.offset_mm[2]), pin.contact_region, pin.pad_mm
        raise DesignError(f"Unknown endpoint {ref!r}")


@dataclass(frozen=True)
class Layout:
    id: str
    design: Design
    mode: str = "initial"
    seed: int | None = None
    diagnostics: tuple[str, ...] = ()


def _construct(cls, value: Mapping[str, Any]):
    try:
        value = dict(value)
        for key in ("board_mm", "rect_mm", "min_size_mm", "offset_mm", "pad_mm", "uv",
                    "position_mm", "pins", "states", "waypoints_mm"):
            if key in value and value[key] is not None and isinstance(value[key], (list, tuple)):
                value[key] = tuple(tuple(point) for point in value[key]) if key == "waypoints_mm" else tuple(value[key])
        return cls(**value)
    except (TypeError, ValueError) as exc:
        raise DesignError(f"Invalid {cls.__name__}: {exc}") from exc


def load_design(source: str | Path | Mapping[str, Any] | Design) -> Design:
    """Read a schema-v1 JSON design or a mapping. Geometry is checked separately."""
    if isinstance(source, Design):
        design = source
    else:
        try:
            raw = dict(source) if isinstance(source, Mapping) else json.loads(Path(source).read_text(encoding="utf-8-sig"))
            components = []
            for item in raw.get("components", []):
                item = dict(item)
                item["pins"] = tuple(_construct(Pin, pin) for pin in item.get("pins", []))
                item["connections"] = tuple(_construct(DeviceLink, link) for link in item.get("connections", []))
                components.append(_construct(Component, item))
            for key, cls in [("layers", Layer), ("regions", Region), ("terminals", Terminal),
                             ("bond_wires", BondWire), ("paths", PathConductor)]:
                raw[key] = tuple(_construct(cls, item) for item in raw.get(key, []))
            raw["components"] = tuple(components)
            raw["rules"] = _construct(Rules, raw.get("rules", {}))
            raw["loop"] = _construct(Loop, raw["loop"])
            design = _construct(Design, raw)
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
            raise DesignError(f"Cannot load design: {exc}") from exc
    _validate_structure(design)
    return design


def _number(value: float, description: str, positive: bool = False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise DesignError(f"{description} must be a finite number")
    if positive and value <= 0:
        raise DesignError(f"{description} must be positive")


def _vector(value, size: int, description: str, positive: bool = False):
    if not isinstance(value, (tuple, list)) or len(value) != size:
        raise DesignError(f"{description} requires {size} values")
    for number in value:
        _number(number, description, positive)


def _unique(items, description):
    ids = [item.id for item in items]
    if any(not isinstance(name, str) or not name or "." in name for name in ids) or len(set(ids)) != len(ids):
        raise DesignError(f"{description} must have unique, nonempty IDs without dots")


def _validate_structure(d: Design):
    if not isinstance(d.name, str) or not d.name:
        raise DesignError("Design name must be a nonempty string")
    if d.schema_version != 1:
        raise DesignError("Only schema_version 1 is supported")
    _vector(d.board_mm, 2, "board_mm", True)
    _number(d.loop.frequency_hz, "loop.frequency_hz", True)
    if sum(layer.patterned for layer in d.layers) != 1:
        raise DesignError("Exactly one patterned conductor layer is supported")
    for items, name in [(d.layers, "Layers"), (d.regions, "Regions"), (d.components, "Components"),
                        (d.terminals, "Terminals"), (d.bond_wires, "Bond wires"), (d.paths, "Paths")]:
        _unique(items, name)
    if not d.regions:
        raise DesignError("At least one copper region is required")
    _unique((*d.regions, *d.components), "Geometric objects")
    if not isinstance(d.loop.device_states, Mapping) or not isinstance(d.rules.net_clearance_mm, Mapping):
        raise DesignError("device_states and net_clearance_mm must be mappings")
    if any(not isinstance(value, str) for value in d.loop.device_states.values()):
        raise DesignError("Device state values must be strings")
    for layer in d.layers:
        if type(layer.patterned) is not bool:
            raise DesignError("Layer patterned must be a boolean")
        _number(layer.z_mm, f"{layer.id}.z_mm")
        _number(layer.thickness_mm, f"{layer.id}.thickness_mm", True)
        _number(layer.resistivity_ohm_m, f"{layer.id}.resistivity_ohm_m", True)
    for r in d.regions:
        _vector(r.rect_mm, 4, f"{r.id}.rect_mm")
        _vector(r.min_size_mm, 2, f"{r.id}.min_size_mm", True)
        if r.layer not in d.layer_map or not isinstance(r.net, str) or not r.net or min(r.rect_mm[2:]) <= 0:
            raise DesignError(f"Invalid layer, net, or size for region {r.id}")
        if type(r.fixed) is not bool:
            raise DesignError("Region fixed must be a boolean")
        if not d.layer_map[r.layer].patterned and not r.fixed:
            raise DesignError(f"Passive-layer region {r.id} must be fixed")
    for c in d.components:
        if type(c.fixed) is not bool:
            raise DesignError("Component fixed must be a boolean")
        _vector(c.rect_mm, 4, f"{c.id}.rect_mm")
        _number(c.height_mm, f"{c.id}.height_mm", True)
        if c.parent not in d.region_map or min(c.rect_mm[2:]) <= 0:
            raise DesignError(f"Invalid parent or footprint for component {c.id}")
        _unique(c.pins, f"Pins in {c.id}")
        pins = {p.id for p in c.pins}
        for p in c.pins:
            _vector(p.offset_mm, 3, f"{c.id}.{p.id}.offset_mm")
            _vector(p.pad_mm, 2, f"{c.id}.{p.id}.pad_mm", True)
            if not (0 <= p.offset_mm[0] <= c.rect_mm[2] and 0 <= p.offset_mm[1] <= c.rect_mm[3]
                    and 0 <= p.offset_mm[2] <= c.height_mm):
                raise DesignError(f"Pin {c.id}.{p.id} lies outside its component")
            if p.contact_region is not None and p.contact_region not in d.region_map:
                raise DesignError(f"Unknown contact region for {c.id}.{p.id}")
        if c.connections and c.id not in d.loop.device_states:
            raise DesignError(f"Specify a device state for {c.id}")
        known_states = {state for link in c.connections for state in link.states} | {"off"}
        if c.id in d.loop.device_states and d.loop.device_states[c.id] not in known_states:
            raise DesignError(f"Unknown device state for {c.id}: {d.loop.device_states[c.id]!r}")
        for link in c.connections:
            if len(link.pins) != 2 or not set(link.pins) <= pins or not link.states:
                raise DesignError(f"Invalid device connection in {c.id}")
            for val in (link.resistance_ohm, link.inductance_h):
                _number(val, f"{c.id} connection")
                if val < 0:
                    raise DesignError("Device R and L must be nonnegative")
    if not set(d.loop.device_states) <= {c.id for c in d.components}:
        raise DesignError("Device states reference an unknown component")
    for t in d.terminals:
        _vector(t.pad_mm, 2, f"{t.id}.pad_mm", True)
        if (t.align_to is None) != (t.align_axis is None) or t.align_axis not in (None,"x","y"):
            raise DesignError(f"{t.id}: specify both align_to and align_axis ('x' or 'y')")
        if t.align_to is not None and (not isinstance(t.align_to,str) or t.region is None):
            raise DesignError(f"{t.id}: aligned terminals require a copper region and a pin reference")
        if t.region is None:
            _vector(t.position_mm, 3, f"{t.id}.position_mm")
        else:
            if t.region not in d.region_map or t.position_mm is not None:
                raise DesignError(f"Invalid terminal anchor for {t.id}")
            _vector(t.uv, 2, f"{t.id}.uv")
            if any(v < 0 or v > 1 for v in t.uv):
                raise DesignError(f"Terminal {t.id} has uv outside [0,1]")
            d.endpoint(t.id)
    for endpoint in (d.loop.source, d.loop.sink):
        d.endpoint(endpoint)
    if d.loop.source == d.loop.sink:
        raise DesignError("Loop source and sink must differ")
    for wire in (*d.bond_wires, *d.paths):
        d.endpoint(wire.source)
        d.endpoint(wire.target)
        _number(wire.diameter_mm, f"{wire.id}.diameter_mm", True)
        _number(wire.resistivity_ohm_m, f"{wire.id}.resistivity_ohm_m", True)
        if wire.source == wire.target:
            raise DesignError(f"{wire.id} endpoints must differ")
        if isinstance(wire, BondWire):
            if wire.planar_axis not in ("auto","x","y"):
                raise DesignError(f"{wire.id}: planar_axis must be auto, x, or y")
            _number(wire.loop_height_mm, f"{wire.id}.loop_height_mm")
            if wire.loop_height_mm < 0 or type(wire.count) is not int or wire.count < 1 or type(wire.segments) is not int or wire.segments < 2:
                raise DesignError(f"Invalid bond-wire parameters for {wire.id}")
            _number(wire.pitch_mm, f"{wire.id}.pitch_mm", True)
            if wire.count > 1 and wire.pitch_mm < wire.diameter_mm:
                raise DesignError(f"Parallel wires in {wire.id} overlap")
            if wire.count > 1:
                a, _, pad_a = d.endpoint(wire.source)
                b, _, pad_b = d.endpoint(wire.target)
                dx, dy = b[0]-a[0], b[1]-a[1]
                norm = math.hypot(dx, dy)
                ux, uy = (-dy/norm, dx/norm) if norm > 1e-12 else (1., 0.)
                span = (wire.count-1)*wire.pitch_mm
                for pad in (pad_a, pad_b):
                    if abs(ux)*span+wire.diameter_mm > pad[0]+1e-8 or abs(uy)*span+wire.diameter_mm > pad[1]+1e-8:
                        raise DesignError(f"Parallel wires in {wire.id} do not fit their landing pads")
            if wire.max_length_mm is not None:
                _number(wire.max_length_mm, f"{wire.id}.max_length_mm", True)
        else:
            for pt in wire.waypoints_mm:
                _vector(pt, 3, f"{wire.id} waypoint")
    for key in ("clearance_mm", "enclosure_mm", "edge_clearance_mm", "min_trace_width_mm", "component_spacing_mm"):
        value = getattr(d.rules, key)
        _number(value, f"rules.{key}")
        if value < 0:
            raise DesignError(f"rules.{key} cannot be negative")
    for key, val in d.rules.net_clearance_mm.items():
        if not isinstance(key, str) or len(key.split("|")) != 2:
            raise DesignError("net_clearance_mm keys use 'net1|net2'")
        _number(val, "net clearance")
        if val < 0:
            raise DesignError("Net clearance cannot be negative")
    # The retained upstream plane uses integer micrometres. Keeping difference
    # bounds on the same lattice makes rounding a convex LP solution safe.
    planar = [*d.board_mm]
    for item in (*d.regions, *d.components):
        planar.extend(item.rect_mm)
    for region in d.regions:
        planar.extend(region.min_size_mm)
    planar.extend(getattr(d.rules, key) for key in ("clearance_mm", "enclosure_mm", "edge_clearance_mm",
                                                   "min_trace_width_mm", "component_spacing_mm"))
    planar.extend(d.rules.net_clearance_mm.values())
    if any(abs(value*1000-round(value*1000))>1e-6 for value in planar):
        raise DesignError("Planar dimensions and rules must lie on the 0.001 mm (1 micrometre) layout grid")
