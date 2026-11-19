"""SI-unit PEEC branch/nodal solver with signed mutual inductance.

The extracted legacy MNA implementation is kept in _vendor for regression and
comparison. Production evaluations use this explicit matrix interface so no
device, source, frequency, or result state can leak between evaluations.
"""
from __future__ import annotations

from dataclasses import dataclass
import warnings

import networkx as nx
import numpy as np
from scipy.linalg import LinAlgWarning, solve

from .model import DesignError, EvaluationError


@dataclass(frozen=True)
class CircuitBranch:
    id: str
    source: str
    target: str
    resistance_ohm: float
    inductance_h: float


@dataclass(frozen=True)
class NetworkResult:
    impedance_ohm: complex
    inductance_h: float
    resistance_ohm: float
    currents_a: np.ndarray
    relative_residual: float


def solve_network(branches: list[CircuitBranch], source: str, sink: str, frequency_hz: float,
                  inductance_matrix_h: np.ndarray | None = None) -> NetworkResult:
    if isinstance(frequency_hz,bool) or not np.isfinite(frequency_hz) or frequency_hz <= 0:
        raise DesignError("frequency_hz must be positive and finite")
    if source == sink:
        raise EvaluationError("Loop terminals are shorted by an ideal connection")
    if not branches:
        raise EvaluationError("There are no conducting branches")
    ids = [b.id for b in branches]
    if len(set(ids)) != len(ids):
        raise DesignError("Circuit branch IDs must be unique")
    resistance = np.asarray([b.resistance_ohm for b in branches], dtype=float)
    if not np.isfinite(resistance).all() or np.any(resistance < 0):
        raise DesignError("Branch resistances must be finite and nonnegative")
    graph = nx.Graph()
    graph.add_edges_from((b.source, b.target) for b in branches)
    if source not in graph or sink not in graph or not nx.has_path(graph, source, sink):
        raise EvaluationError(f"Disconnected loop: no conducting path from {source} to {sink}")
    # Floating conductors can carry induced loop currents. Retain them, choosing
    # one voltage reference per connected component rather than deleting them.
    grounds = set()
    for component in nx.connected_components(graph):
        grounds.add(sink if sink in component else sorted(component)[0])
    nodes = sorted(set(graph)-grounds)
    node_id = {node: i for i, node in enumerate(nodes)}
    n, m = len(nodes), len(branches)
    incidence = np.zeros((n, m))
    for k, branch in enumerate(branches):
        if branch.source in node_id:
            incidence[node_id[branch.source], k] += 1
        if branch.target in node_id:
            incidence[node_id[branch.target], k] -= 1
    inductance = np.diag([b.inductance_h for b in branches]) if inductance_matrix_h is None else np.asarray(inductance_matrix_h, dtype=float)
    if inductance.shape != (m, m) or not np.isfinite(inductance).all():
        raise DesignError("Inductance matrix must be finite and match the branches")
    if np.any(np.diag(inductance) < 0) or not np.allclose(inductance, inductance.T, rtol=1e-10, atol=1e-18):
        raise DesignError("Inductance matrix must be symmetric with nonnegative diagonal")
    omega = 2*np.pi*frequency_hz
    impedance = np.diag(resistance) + 1j*omega*inductance
    scale = max(float(np.median(np.abs(np.diag(impedance)))), 1e-9)
    matrix = np.block([[impedance/scale, -incidence.T], [incidence, np.zeros((n, n))]])
    rhs = np.zeros(m+n, dtype=complex)
    rhs[m+node_id[source]] = 1.0
    if sink in node_id:
        rhs[m+node_id[sink]] -= 1.0
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", LinAlgWarning)
            solution = solve(matrix, rhs, assume_a="gen", check_finite=False)
    except (np.linalg.LinAlgError, LinAlgWarning, ValueError) as exc:
        raise EvaluationError(f"Singular or ill-conditioned PEEC system: {exc}") from exc
    residual = float(np.linalg.norm(matrix@solution-rhs)/max(np.linalg.norm(rhs), 1))
    if not np.isfinite(solution).all() or residual > 1e-7:
        raise EvaluationError(f"PEEC solve failed its residual check ({residual:g})")
    voltage = solution[m:]*scale
    z = complex(voltage[node_id[source]] - (voltage[node_id[sink]] if sink in node_id else 0))
    L = z.imag/omega
    if z.real < -1e-10 or L < -1e-14:
        raise EvaluationError(f"Nonpassive loop result: Z={z}; refine the mesh/model")
    return NetworkResult(z, max(L, 0.0), max(z.real, 0.0), solution[:m], residual)
