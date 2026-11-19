from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

from . import (load_design,generate_candidates,evaluate_electrical,rank_layouts,
               validate_layout,build_corner_stitch,MeshSettings,check_mesh_convergence,DesignError,EvaluationError)
from .export import write_json,write_svg,write_ranking_report
from .fasthenry import export_fasthenry,compare_fasthenry
from .placement import prepare_optimization


def parser():
    p=argparse.ArgumentParser(description="Constrained DBC module layouts and PEEC loop ranking")
    sub=p.add_subparsers(dest="command",required=True)
    for name in ["validate","generate","evaluate","optimize","convergence","export-fasthenry","compare-fasthenry"]:
        cmd=sub.add_parser(name);cmd.add_argument("design",type=Path)
        if name in {"generate","optimize"}:
            cmd.add_argument("--mode",choices=["minimum","variable","fixed"],default="fixed")
            cmd.add_argument("--count",type=int,default=10)
            cmd.add_argument("--seed",type=int,default=0)
            cmd.add_argument("--floorplan-mm",type=float,nargs=2,metavar=("WIDTH","HEIGHT"))
            cmd.add_argument("--unlock-dies-and-copper",action="store_true",
                             help="Release die placement and patterned copper; keep leads, passive conductors, and measurement fixtures fixed")
        if name not in {"validate","generate"}:
            cmd.add_argument("--mesh-mm",type=float,default=4)
            cmd.add_argument("--thickness-cells",type=int,default=1)
            cmd.add_argument("--wire-segments",type=int)
            cmd.add_argument("--quadrature-order",type=int,default=6)
            cmd.add_argument("--max-branches",type=int,default=1400)
        if name=="convergence":
            cmd.add_argument("--sizes-mm",type=float,nargs="+",default=[6,4,3])
            cmd.add_argument("--tolerance",type=float,default=.02)
        if name in {"evaluate","optimize","generate","convergence","export-fasthenry","compare-fasthenry"}:
            cmd.add_argument("--out",type=Path,default=Path("results"))
        if name=="evaluate":cmd.add_argument("--frequency-hz",type=float)
        if name in {"export-fasthenry","compare-fasthenry"}:
            cmd.add_argument("--cross-section-subdivisions",type=int,default=1)
        if name=="compare-fasthenry":
            cmd.add_argument("--executable",type=Path,required=True)
            cmd.add_argument("--timeout-s",type=float,default=180)
    return p


def main(argv=None):
    args=parser().parse_args(argv)
    try:
        design=load_design(args.design)
        if getattr(args,"unlock_dies_and_copper",False):
            design=prepare_optimization(design)
        if args.command=="validate":
            check=validate_layout(design)
            data={"valid":check.valid,"issues":check.issues}
            if check.valid:data["corner_stitch"]=build_corner_stitch(design).summary()
            print(json.dumps(data,indent=2));return 0 if check.valid else 2
        args.out.mkdir(parents=True,exist_ok=True)
        if args.command in {"generate","optimize"}:
            candidates=generate_candidates(design,mode=args.mode,count=args.count,seed=args.seed,floorplan_mm=args.floorplan_mm)
            if args.command=="generate":
                for layout in candidates:
                    write_json(args.out/(layout.id+".json"),layout.design.to_dict())
                    write_svg(args.out/(layout.id+".svg"),layout)
                print(f"Wrote {len(candidates)} layouts, including the baseline, to {args.out.resolve()}")
                return 0
        mesh=MeshSettings(args.mesh_mm,args.thickness_cells,args.quadrature_order,args.max_branches,args.wire_segments)
        if args.command=="evaluate":
            result=evaluate_electrical(design,mesh=mesh,frequency_hz=args.frequency_hz)
            write_json(args.out/"electrical.json",result.to_dict());write_svg(args.out/"layout.svg",design)
            print(json.dumps(result.to_dict(),indent=2))
        elif args.command=="optimize":
            result=rank_layouts(design,candidates,mesh=mesh)
            write_json(args.out/"ranking.json",result.to_dict())
            write_json(args.out/"best_design.json",result.best.layout.design.to_dict())
            write_svg(args.out/"initial.svg",design);write_svg(args.out/"best.svg",result.best.layout)
            write_ranking_report(args.out/"report.html",result)
            print(f"Initial: {result.baseline.electrical.inductance_h*1e9:.5f} nH; best: {result.best.electrical.inductance_h*1e9:.5f} nH ({result.improvement_fraction:.1%} modelled reduction).")
            print(f"Report: {(args.out/'report.html').resolve()}")
        elif args.command=="convergence":
            result=check_mesh_convergence(design,args.sizes_mm,tolerance=args.tolerance,base=mesh)
            write_json(args.out/"convergence.json",result)
            print(json.dumps({k:v for k,v in result.items() if k!="evaluations"},indent=2))
            return 0 if result["converged"] else 3
        elif args.command=="export-fasthenry":
            print(export_fasthenry(design,args.out/"design.inp",mesh=mesh,cross_section_subdivisions=args.cross_section_subdivisions).resolve())
        elif args.command=="compare-fasthenry":
            result=compare_fasthenry(design,args.executable,mesh=mesh,timeout_s=args.timeout_s,cross_section_subdivisions=args.cross_section_subdivisions)
            write_json(args.out/"fasthenry_comparison.json",result)
            print(f"Inductance difference: {result['relative_inductance_difference']:.2%}")
        return 0
    except (DesignError,EvaluationError,OSError,ValueError) as exc:
        print(f"error: {exc}",file=sys.stderr)
        return 2


if __name__=="__main__":
    raise SystemExit(main())
