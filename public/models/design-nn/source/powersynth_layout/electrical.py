"""PEEC assembly using PowerSynth self/mutual equations and explicit SI units."""
from __future__ import annotations

from dataclasses import asdict, dataclass
import math
import time

import numpy as np
import networkx as nx

from ._vendor.self_inductance import self_ind_py
from ._vendor.mutual_inductance import mutual_between_bars
from .mesh import Filament, MeshSettings, build_mesh
from .model import Design, DesignError, EvaluationError, Layout
from .solver import CircuitBranch, solve_network

MU0 = 4e-7*math.pi


@dataclass(frozen=True)
class ElectricalResult:
    loop_name: str
    frequency_hz: float
    inductance_h: float
    resistance_ohm: float
    impedance_real_ohm: float
    impedance_imag_ohm: float
    branch_count: int
    node_count: int
    relative_residual: float
    mesh: MeshSettings
    elapsed_s: float
    diagnostics: tuple[str, ...]

    def to_dict(self):
        result = asdict(self)
        result["inductance_nh"] = self.inductance_h*1e9
        result["resistance_mohm"] = self.resistance_ohm*1e3
        return result


def _axis(filament):
    delta = np.subtract(filament.end_m, filament.start_m)
    axes = np.flatnonzero(np.abs(delta) > 1e-14)
    return int(axes[0]) if len(axes) == 1 else None


def self_inductance(filament: Filament) -> float:
    length = filament.length_m
    if filament.round_wire:
        radius = filament.width_m/2
        # Finite straight round conductor, including low-frequency internal L.
        value = MU0/(2*math.pi)*(length*math.asinh(length/radius)-math.hypot(length,radius)+radius)
        value += MU0*length/(8*math.pi)
    else:
        value = float(self_ind_py(filament.width_m, length, filament.thickness_m))
    if not math.isfinite(value) or value <= 0:
        raise EvaluationError(f"Invalid self inductance for {filament.id}")
    return value


def _quadrature(filament, order):
    a,b = np.asarray(filament.start_m), np.asarray(filament.end_m)
    direction = (b-a)/filament.length_m
    axis = _axis(filament)
    if not filament.round_wire and axis is not None:
        cross = {0:(1,2), 1:(0,2), 2:(0,1)}[axis]
        u,v = np.eye(3)[cross[0]], np.eye(3)[cross[1]]
        cross_points = [u*sw*filament.width_m/(2*math.sqrt(3))+v*st*filament.thickness_m/(2*math.sqrt(3))
                        for sw in (-1,1) for st in (-1,1)]
    else:
        helper = np.array([0.,0.,1.]) if abs(direction[2]) < 0.9 else np.array([1.,0.,0.])
        u = np.cross(direction,helper); u /= np.linalg.norm(u)
        v = np.cross(direction,u)
        radius = filament.width_m/(2*math.sqrt(2))
        cross_points = [u*radius,-u*radius,v*radius,-v*radius]
    t, weights = np.polynomial.legendre.leggauss(order)
    centers = a[None,:]+((t+1)/2)[:,None]*(b-a)[None,:]
    points = (centers[:,None,:]+np.asarray(cross_points)[None,:,:]).reshape(-1,3)
    weights = np.repeat(weights/2/len(cross_points),len(cross_points))
    return points, weights, direction


def _numerical_mutual(a,b,qa,qb):
    pa,wa,da = qa; pb,wb,db = qb
    dot = float(da@db)
    if abs(dot) < 1e-12:
        return 0.0
    distances = np.linalg.norm(pa[:,None,:]-pb[None,:,:],axis=2)
    if np.min(distances) < 1e-14:
        raise EvaluationError(f"Coincident conductor volumes: {a.id}/{b.id}")
    return 1e-7*a.length_m*b.length_m*dot*float(np.sum(wa[:,None]*wb[None,:]/distances))


def _parallel_mutual(a,b,axis):
    width_axis,thick_axis = {0:(1,2),1:(0,2),2:(0,1)}[axis]
    alo=np.minimum(a.start_m,a.end_m); blo=np.minimum(b.start_m,b.end_m)
    E=(blo[width_axis]-b.width_m/2)-(alo[width_axis]-a.width_m/2)
    p=(blo[thick_axis]-b.thickness_m/2)-(alo[thick_axis]-a.thickness_m/2)
    params=np.array([a.width_m,a.length_m,a.thickness_m,b.width_m,b.length_m,b.thickness_m,
                     blo[axis]-alo[axis],p,E])*1e6
    sign=np.sign(a.end_m[axis]-a.start_m[axis])*np.sign(b.end_m[axis]-b.start_m[axis])
    # Upstream expects micrometres and returns nanohenries.
    return float(mutual_between_bars(params))*1e-9*sign


def inductance_matrix(filaments: list[Filament], settings: MeshSettings) -> np.ndarray:
    matrix = np.diag([self_inductance(f) for f in filaments])
    axes = [_axis(f) for f in filaments]
    quadrature = [_quadrature(f,settings.quadrature_order) for f in filaments]
    for i,a in enumerate(filaments):
        for j in range(i):
            b=filaments[j]
            if not a.round_wire and not b.round_wire and axes[i] is not None and axes[j] is not None:
                if axes[i] != axes[j]:
                    continue
                value=_parallel_mutual(a,b,axes[i])
                bound=math.sqrt(matrix[i,i]*matrix[j,j])
                # Cancellation in the closed form can occur for very remote or
                # extremely thin bars; use volume quadrature for that pair.
                if not math.isfinite(value) or abs(value)>bound*1.001:
                    value=_numerical_mutual(a,b,quadrature[i],quadrature[j])
            else:
                value=_numerical_mutual(a,b,quadrature[i],quadrature[j])
            if not math.isfinite(value):
                raise EvaluationError(f"Nonfinite mutual inductance for {a.id}/{b.id}")
            matrix[i,j]=matrix[j,i]=value
    return matrix


def evaluate_electrical(layout: Layout | Design, *, mesh: MeshSettings | None = None,
                        frequency_hz: float | None = None) -> ElectricalResult:
    d=layout.design if isinstance(layout,Layout) else layout
    settings=mesh or MeshSettings()
    frequency=d.loop.frequency_hz if frequency_hz is None else frequency_hz
    if isinstance(frequency,bool) or not isinstance(frequency,(float,int)) or not math.isfinite(frequency) or frequency<=0:
        raise DesignError("frequency_hz must be positive and finite")
    started=time.perf_counter()
    geometry=build_mesh(d,settings)
    graph=nx.Graph()
    graph.add_edges_from((b.source,b.target) for b in [*geometry.filaments,*geometry.lumped])
    if geometry.source not in graph or geometry.sink not in graph or not nx.has_path(graph,geometry.source,geometry.sink):
        raise EvaluationError(f"Disconnected loop: no conducting path from {d.loop.source} to {d.loop.sink}")
    matrix=inductance_matrix(geometry.filaments,settings)
    branches=[CircuitBranch(f.id,f.source,f.target,f.resistivity_ohm_m*f.length_m/f.area_m2,matrix[i,i])
              for i,f in enumerate(geometry.filaments)]
    if geometry.lumped:
        total=len(branches)+len(geometry.lumped)
        extended=np.zeros((total,total))
        extended[:len(branches),:len(branches)]=matrix
        for i,b in enumerate(geometry.lumped,len(branches)):
            extended[i,i]=b.inductance_h
        matrix=extended
        branches.extend(geometry.lumped)
    result=solve_network(branches,geometry.source,geometry.sink,frequency,matrix)
    return ElectricalResult(d.loop.name,float(frequency),result.inductance_h,result.resistance_ohm,
        result.impedance_ohm.real,result.impedance_ohm.imag,len(branches),geometry.nodes,result.relative_residual,
        settings,time.perf_counter()-started,tuple(geometry.diagnostics))


def check_mesh_convergence(layout: Layout | Design, cell_sizes_mm=(5.0,4.0,3.0), *,
                           tolerance=0.02, base: MeshSettings | None = None):
    from dataclasses import replace
    if len(cell_sizes_mm)<2 or any(b>=a for a,b in zip(cell_sizes_mm,cell_sizes_mm[1:])):
        raise DesignError("Convergence requires at least two decreasing mesh sizes")
    if not math.isfinite(tolerance) or tolerance<=0:
        raise DesignError("Convergence tolerance must be positive")
    results=[evaluate_electrical(layout,mesh=replace(base or MeshSettings(),cell_mm=value)) for value in cell_sizes_mm]
    changes=[abs(b.inductance_h-a.inductance_h)/max(abs(b.inductance_h),1e-30) for a,b in zip(results,results[1:])]
    return {"converged":changes[-1]<=tolerance,"relative_tolerance":tolerance,
            "relative_changes":changes,"evaluations":[r.to_dict() for r in results],
            "note":"Mesh convergence is not validation of physical-model accuracy."}
