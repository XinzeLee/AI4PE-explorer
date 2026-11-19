"""PowerSynth's NSGA-II controller with a reduced constraint-graph decoder.

The retained upstream driver uses DEAP's mu+lambda elitism, blend crossover,
Gaussian mutation, and nondominated sorting. The fixed-floorplan decoder is a
new adapter: bounded design-string targets project onto the two feasible
coordinate-cut polytopes. Electrical evaluations are never replaced by proxies.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass
import hashlib
import json
import random
import threading

import numpy as np
from scipy.optimize import linprog
from scipy.sparse import coo_matrix,csr_matrix,hstack,vstack

from .model import Design,DesignError,EvaluationError,Layout
from .placement import AxisGraph,_reconstruct
from .geometry import validate_layout,build_corner_stitch
from .electrical import ElectricalResult,evaluate_electrical
from .mesh import MeshSettings

_NSGA_LOCK=threading.Lock()


def design_fingerprint(design):
    # Input integers and reconstructed floats describe the same geometry.
    def canonical(value):
        if isinstance(value,dict):return {k:canonical(v) for k,v in value.items()}
        if isinstance(value,(tuple,list)):return [canonical(v) for v in value]
        if isinstance(value,(int,float)) and not isinstance(value,bool):return float(value)
        return value
    return hashlib.sha256(json.dumps(canonical(design.to_dict()),sort_keys=True,separators=(",",":")).encode()).hexdigest()


def nondominated_indices(values):
    """Indices minimizing every objective; equal objective vectors are retained."""
    if len(values)==0:return []
    data=np.asarray(values,dtype=float)
    if data.ndim!=2 or data.shape[1]<2 or not np.all(np.isfinite(data)):
        raise DesignError("Pareto objectives must be a finite matrix with at least two columns")
    return [i for i,row in enumerate(data) if not np.any(np.all(data<=row,axis=1)&np.any(data<row,axis=1))]


class CutDesignSpace:
    """Fixed-substrate, topology-preserving bounded design-string representation."""
    def __init__(self,design:Design):
        check=validate_layout(design)
        if not check.valid:raise DesignError("Invalid base layout: "+"; ".join(check.issues))
        self.design=design
        self.corner_stitch=build_corner_stitch(design).summary()
        self.graphs=[AxisGraph(design,axis) for axis in (0,1)]
        self.axes=[]
        for axis,graph in enumerate(self.graphs):
            extent=design.board_mm[axis];n=len(graph.cuts)
            lower=np.zeros(n);upper=np.zeros(n)
            for i in range(n):
                obj=np.zeros(n);obj[i]=1
                lower[i]=graph.solve(extent=extent,objective=obj)[i]
                upper[i]=graph.solve(extent=extent,objective=-obj)[i]
            free=np.flatnonzero(upper-lower>1e-7)
            rows=[];cols=[];data=[];bound=[]
            for row,edge in enumerate(graph.edges):
                rows.extend((row,row));cols.extend((edge.source,edge.target));data.extend((1,-1));bound.append(-edge.minimum_mm)
            matrix=coo_matrix((data,(rows,cols)),shape=(len(bound),n)).tocsr()
            k=len(free)
            selector=csr_matrix((np.ones(k),(np.arange(k),free)),shape=(k,n))
            ident=csr_matrix(np.eye(k))
            constraints=vstack((hstack((matrix,csr_matrix((len(bound),k)))),hstack((selector,-ident)),hstack((-selector,-ident))),format="csr")
            fixed=dict(graph.fixed);fixed[graph.end]=extent
            bounds=[(fixed[i],fixed[i]) if i in fixed else (float(lower[i]),float(upper[i])) for i in range(n)]+[(0,None)]*k
            objective=np.r_[np.zeros(n),1/np.maximum(upper[free]-lower[free],.001)]
            self.axes.append((lower,upper,free,constraints,np.asarray(bound),bounds,objective))
        self.n_variables=sum(len(a[2]) for a in self.axes)
        if not self.n_variables:raise DesignError("No movable coordinate cuts; release die placement and patterned copper first")

    def encode(self,design):
        if design.board_mm!=self.design.board_mm:raise DesignError("A seed design must use the base substrate")
        genes=[]
        for axis,(graph,values) in enumerate(zip(self.graphs,self.axes)):
            lower,upper,free,*_=values
            mapping={0.:0.,self.design.board_mm[axis]:design.board_mm[axis]}
            for a,b in zip((*self.design.regions,*self.design.components),(*design.regions,*design.components)):
                for old,new in ((a.rect_mm[axis],b.rect_mm[axis]),(a.rect_mm[axis]+a.rect_mm[axis+2],b.rect_mm[axis]+b.rect_mm[axis+2])):
                    key=round(old,9)
                    if key in mapping and abs(mapping[key]-new)>1e-6:raise DesignError("Seed does not preserve shared coordinate cuts")
                    mapping[key]=new
            coords=np.array([mapping[round(c,9)] for c in graph.cuts])
            genes.extend(np.clip((coords[free]-lower[free])/(upper[free]-lower[free]),0,1))
        return list(map(float,genes))

    def decode(self,genes):
        genes=np.asarray(genes,dtype=float)
        if genes.shape!=(self.n_variables,) or not np.all(np.isfinite(genes)):
            raise DesignError("Invalid bounded design string")
        if np.any(genes<0) or np.any(genes>1):raise DesignError("Design-string values must be within [0,1]")
        vectors=[];offset=0
        for graph,values in zip(self.graphs,self.axes):
            lower,upper,free,constraints,bound,bounds,objective=values
            k=len(free);target=lower[free]+genes[offset:offset+k]*(upper[free]-lower[free]);offset+=k
            result=linprog(objective,A_ub=constraints,b_ub=np.r_[bound,target,-target],bounds=bounds,method="highs")
            if not result.success:raise DesignError("Constraint-graph decode failed: "+result.message)
            vectors.append(np.round(result.x[:len(graph.cuts)],3))
        candidate=_reconstruct(self.design,*self.graphs,*vectors)
        check=validate_layout(candidate,reference=self.design)
        if not check.valid:raise DesignError("Decoded layout rejected: "+"; ".join(check.issues))
        return candidate


@dataclass(frozen=True)
class ParetoPoint:
    layout:Layout
    electrical:ElectricalResult
    copper_area_mm2:float

    def objectives(self,secondary="resistance"):
        return (self.electrical.inductance_h,self.electrical.resistance_ohm if secondary=="resistance" else self.copper_area_mm2)

    def to_dict(self):
        return {"id":self.layout.id,"design":self.layout.design.to_dict(),"mode":self.layout.mode,
                "electrical":self.electrical.to_dict(),"copper_area_mm2":self.copper_area_mm2,"constraint_check":{"valid":True,"issues":[]}}


@dataclass(frozen=True)
class ParetoResult:
    points:tuple[ParetoPoint,...]
    failures:tuple[dict,...]
    settings:dict

    @property
    def front(self):
        indices=nondominated_indices([p.objectives(self.settings["secondary"]) for p in self.points])
        return tuple(self.points[i] for i in indices)

    def to_dict(self):
        return {"algorithm":"PowerSynth NSGAII_Optimizer / DEAP eaMuPlusLambda",
                "upstream_revision":"88af2fff2467f2e01db1d0ffc6c8c420968d65fc",
                "decoder":"Reduced two-axis constraint graph, bounded targets with normalized L1 feasible projection",
                "settings":self.settings,"front_ids":[p.layout.id for p in self.front],
                "points":[p.to_dict() for p in self.points],"failures":list(self.failures)}


def optimize_pareto(design:Design,*,population_size=12,generations=3,seed=37,secondary="resistance",
                    mesh=None,seed_layouts=(),batch_evaluator=None,checkpoint=None):
    """Run the extracted upstream NSGA-II; return every distinct evaluated layout.

    ``batch_evaluator(layouts)`` may evaluate in parallel and must return an
    ElectricalResult or Exception for each layout, in input order. Invalid
    geometries/evaluations are recorded and cannot enter the returned front.
    """
    if type(population_size)!=int or population_size<4:raise DesignError("population_size must be an integer >=4")
    if type(generations)!=int or generations<1:raise DesignError("generations must be a positive integer")
    if type(seed)!=int or seed<0:raise DesignError("seed must be a nonnegative integer")
    if secondary not in {"resistance","copper_area"}:raise DesignError("secondary must be resistance or copper_area")
    try:
        from ._vendor.nsga2 import DesignVar,NSGAII_Optimizer
    except ImportError as exc:
        raise DesignError("NSGA-II requires the optional dependency: pip install powersynth-layout[optimization]") from exc
    space=CutDesignSpace(design);mesh=mesh or MeshSettings()
    settings={"population_size":population_size,"generations":generations,"seed":seed,"secondary":secondary,
              "crossover_probability":.8,"mutation_probability":.2,"blend_alpha":1.5,"gaussian_sigma":3,
              "per_gene_mutation_probability":.3,"offspring_per_generation":2*population_size,
              "design_variables":space.n_variables,"corner_stitch":space.corner_stitch}
    points=[];failures=[];known={};genomes={};batch_number=0
    seeds=[Layout("initial",design),*seed_layouts]
    seed_ids={design_fingerprint(p.design):p.id for p in reversed(seeds)}
    def default_batch(layouts):
        outputs=[]
        for layout in layouts:
            try:outputs.append(evaluate_electrical(layout,mesh=mesh))
            except (DesignError,EvaluationError) as exc:outputs.append(exc)
        return outputs
    evaluator=batch_evaluator or default_batch
    def evaluate_batch(_function,individuals):
        nonlocal batch_number
        individuals=list(individuals);pending={};keys=[]
        for individual in individuals:
            gene=tuple(individual)
            if gene in genomes:
                keys.append(genomes[gene]);continue
            try:
                candidate=space.decode(individual);key=design_fingerprint(candidate)
                if key not in known and key not in pending:
                    pending[key]=Layout(seed_ids.get(key,f"nsga_{len(known)+len(pending):04d}"),candidate,"nsga2",seed)
            except DesignError as exc:
                key=None;failures.append({"stage":"geometry","generation":batch_number,"diagnostic":str(exc),"genome":list(individual)})
            genomes[gene]=key;keys.append(key)
        outputs=list(evaluator(list(pending.values()))) if pending else []
        if len(outputs)!=len(pending):raise EvaluationError("Batch evaluator returned the wrong number of results")
        for (key,layout),output in zip(pending.items(),outputs):
            if isinstance(output,Exception):
                known[key]=None;failures.append({"id":layout.id,"stage":"electrical","generation":batch_number,"diagnostic":str(output)})
            else:
                if not isinstance(output,ElectricalResult) or not np.all(np.isfinite([output.inductance_h,output.resistance_ohm])) or output.inductance_h<=0 or output.resistance_ohm<0:
                    raise EvaluationError("Batch evaluator returned invalid electrical metrics")
                point=ParetoPoint(layout,output,sum(r.rect_mm[2]*r.rect_mm[3] for r in layout.design.regions if layout.design.layer_map[r.layer].patterned))
                points.append(point);known[key]=point
        if not any(p.layout.id=="initial" for p in points):raise EvaluationError("Cannot establish a valid Pareto baseline")
        if checkpoint:checkpoint(ParetoResult(tuple(points),tuple(failures),dict(settings)),batch_number)
        batch_number+=1
        # A finite penalty is internal only; failures have no exported score.
        return [known[k].objectives(secondary) if k is not None and known.get(k) is not None else (1e100,1e100) for k in keys]
    # Upstream seeds Python and legacy NumPy globals. Preserve the caller state.
    with _NSGA_LOCK:
        py_state=random.getstate();np_state=np.random.get_state()
        try:
            budget=population_size*(1+2*generations)
            optimizer=NSGAII_Optimizer([DesignVar((0.,1.),(0.,1.)) for _ in range(space.n_variables)],lambda _:None,2,seed,budget,generations,.8,.2)
            for individual,layout in zip(optimizer.population,seeds):individual[:]=array('d',space.encode(layout.design))
            optimizer.toolbox.register("map",evaluate_batch)
            optimizer.run()
        finally:
            random.setstate(py_state);np.random.set_state(np_state)
    return ParetoResult(tuple(points),tuple(failures),settings)
