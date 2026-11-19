"""Candidate ranking with an always-included, electrically evaluated baseline."""
from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Iterable

from .electrical import ElectricalResult, evaluate_electrical
from .geometry import validate_layout
from .mesh import MeshSettings
from .model import Design, DesignError, EvaluationError, Layout, load_design
from .placement import generate_candidates


@dataclass(frozen=True)
class RankedLayout:
    layout: Layout
    electrical: ElectricalResult

    def to_dict(self):
        return {"id":self.layout.id,"mode":self.layout.mode,"seed":self.layout.seed,
                "design":self.layout.design.to_dict(),"electrical":self.electrical.to_dict(),
                "constraint_check":{"valid":True,"issues":[]},"diagnostics":list(self.layout.diagnostics)}


@dataclass(frozen=True)
class RankingResult:
    ranked: tuple[RankedLayout,...]
    failures: tuple[dict,...]
    baseline: RankedLayout

    @property
    def best(self):
        return self.ranked[0]

    @property
    def improvement_fraction(self):
        initial=self.baseline.electrical.inductance_h
        return (initial-self.best.electrical.inductance_h)/initial if initial>0 else 0.0

    def to_dict(self):
        return {"schema_version":1,"objective":"minimize loop inductance_h",
                "baseline_id":self.baseline.layout.id,"best_id":self.best.layout.id,
                "improvement_fraction":self.improvement_fraction,
                "ranked":[r.to_dict() for r in self.ranked],"failures":list(self.failures)}


def rank_layouts(design: Design, candidates: Iterable[Layout] = (), *, mesh: MeshSettings | None = None) -> RankingResult:
    """Rank by L, then R, then ID. Invalid candidates never receive a numeric score."""
    baseline=Layout("initial",design)
    items=[baseline]
    ids={"initial"}
    for candidate in candidates:
        if candidate.id == "initial" and candidate.design.to_dict() == design.to_dict():
            continue
        if candidate.id in ids:
            raise DesignError(f"Duplicate candidate ID {candidate.id}")
        ids.add(candidate.id)
        items.append(candidate)
    ranked=[]; failures=[]; initial=None
    for candidate in items:
        check=validate_layout(candidate,reference=design)
        if not check.valid:
            failures.append({"id":candidate.id,"stage":"geometry","diagnostics":list(check.issues)})
            continue
        try:
            result=evaluate_electrical(candidate,mesh=mesh)
            item=RankedLayout(candidate,result)
            ranked.append(item)
            if candidate.id == "initial":
                initial=item
        except (DesignError,EvaluationError) as exc:
            failures.append({"id":candidate.id,"stage":"electrical","diagnostics":[str(exc)]})
    if initial is None:
        reasons=next((f["diagnostics"] for f in failures if f["id"]=="initial"),["unknown error"])
        raise EvaluationError("Cannot establish an electrical baseline: "+"; ".join(reasons))
    ranked.sort(key=lambda r:(r.electrical.inductance_h,r.electrical.resistance_ohm,
                              0 if r.layout.id=="initial" else 1,r.layout.id))
    return RankingResult(tuple(ranked),tuple(failures),initial)
