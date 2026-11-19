"""Reduced PowerSynth single-layer layout and electrical-ranking package."""
from .model import Design, DesignError, EvaluationError, Layout, load_design
from .placement import generate_candidates, prepare_optimization
from .electrical import ElectricalResult, evaluate_electrical, check_mesh_convergence
from .api import RankingResult, rank_layouts
from .mesh import MeshSettings
from .geometry import validate_layout, build_corner_stitch
from .pareto import optimize_pareto, ParetoResult, nondominated_indices

__all__=["Design","DesignError","EvaluationError","Layout","load_design","generate_candidates",
         "ElectricalResult","evaluate_electrical","rank_layouts","RankingResult","MeshSettings",
         "validate_layout","build_corner_stitch","check_mesh_convergence","prepare_optimization",
         "optimize_pareto","ParetoResult","nondominated_indices"]
