"""Optional independent FastHenry comparison. No executable is bundled or required."""
from __future__ import annotations

import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import hashlib

import numpy as np

from .mesh import MeshSettings, build_mesh
from .model import DesignError, EvaluationError
from .electrical import evaluate_electrical


def export_fasthenry(design, path, *, mesh=None, cross_section_subdivisions=1):
    """Export the same conductor graph and source/sink convention in metres.

    Circular wires use equal-area square cross sections. Device links with
    zero L and R <= 10 micro-ohms are idealized; other lumped links are rejected.
    The generated sidecar explicitly records these reference-model differences.
    """
    settings=mesh or MeshSettings()
    if type(cross_section_subdivisions) is not int or cross_section_subdivisions<1:
        raise DesignError("FastHenry cross_section_subdivisions must be positive")
    geometry=build_mesh(design,settings)
    aliases={}
    lines=["* PowerSynth reduced-core independent comparison", ".units m",
           f".default nhinc={cross_section_subdivisions} nwinc={cross_section_subdivisions}"]
    for i,f in enumerate(geometry.filaments):
        names=(f"N{i}a",f"N{i}b")
        for name,node,xyz in zip(names,(f.source,f.target),(f.start_m,f.end_m)):
            lines.append(f"{name} x={xyz[0]:.12g} y={xyz[1]:.12g} z={xyz[2]:.12g}")
            aliases.setdefault(node,[]).append(name)
        if f.round_wire:
            width=thick=math.sqrt(f.area_m2)
        else:
            width,thick=f.width_m,f.thickness_m
        direction=np.subtract(f.end_m,f.start_m);direction/=np.linalg.norm(direction)
        nonzero=np.flatnonzero(np.abs(direction)>1e-10)
        if not f.round_wire and len(nonzero)==1:
            width_dir=np.eye(3)[{0:1,1:0,2:0}[int(nonzero[0])]]
        else:
            helper=np.array([0.,0.,1.]) if abs(direction[2])<.9 else np.array([1.,0.,0.])
            width_dir=np.cross(direction,helper);width_dir/=np.linalg.norm(width_dir)
        lines.append(f"E{i} {names[0]} {names[1]} w={width:.12g} h={thick:.12g} sigma={1/f.resistivity_ohm_m:.12g} wx={width_dir[0]:.12g} wy={width_dir[1]:.12g} wz={width_dir[2]:.12g}")
    for names in aliases.values():
        if len(names)>1:
            lines.append(".equiv "+" ".join(names))
    for b in geometry.lumped:
        if b.inductance_h!=0 or b.resistance_ohm>1e-5:
            raise DesignError("FastHenry export supports only nearly ideal device-state links (L=0, R<=1e-5 ohm)")
        if b.source not in aliases or b.target not in aliases:
            raise EvaluationError("Device link does not connect modeled conductors")
        lines.append(f".equiv {aliases[b.source][0]} {aliases[b.target][0]}")
    if geometry.source not in aliases or geometry.sink not in aliases:
        raise EvaluationError("FastHenry port has no conducting path")
    lines.extend([f".external {aliases[geometry.source][0]} {aliases[geometry.sink][0]}",
                  f".freq fmin={design.loop.frequency_hz:.12g} fmax={design.loop.frequency_hz:.12g} ndec=1", ".end"])
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text("\n".join(lines)+"\n",encoding="ascii")
    metadata={"frequency_hz":design.loop.frequency_hz,"mesh":settings.__dict__,
              "cross_section_subdivisions":cross_section_subdivisions,
              "differences":["Round wires represented by equal-area square bars.",
                             "Near-ideal device links replaced by ideal equivalences.",
                             "FastHenry may subdivide each cross section independently."]}
    path.with_suffix(path.suffix+".json").write_text(json.dumps(metadata,indent=2)+"\n",encoding="utf8")
    return path


def compare_fasthenry(design, executable, *, mesh=None, timeout_s=180, cross_section_subdivisions=1):
    executable=Path(executable).resolve()
    if not executable.is_file():
        raise DesignError(f"FastHenry executable not found: {executable}")
    predicted=evaluate_electrical(design,mesh=mesh)
    with tempfile.TemporaryDirectory(prefix="powersynth-fh-") as temp:
        folder=Path(temp)
        inp=export_fasthenry(design,folder/"design.inp",mesh=mesh,cross_section_subdivisions=cross_section_subdivisions)
        try:
            # Dense direct solves provide a deterministic reference for these
            # modest examples, avoiding the legacy binary's multipole-refinement
            # failures on short/wide filaments.
            process=subprocess.run([str(executable),str(inp),"-s","ludecomp","-m","direct","-a","off"],
                                   cwd=folder,capture_output=True,text=True,timeout=timeout_s)
        except (OSError,subprocess.TimeoutExpired) as exc:
            raise EvaluationError(f"FastHenry execution failed: {exc}") from exc
        if process.returncode:
            raise EvaluationError(f"FastHenry failed ({process.returncode}): {process.stderr[-2000:]} {process.stdout[-2000:]}")
        outputs=list(folder.glob("Zc*"))
        if not outputs:
            raise EvaluationError("FastHenry produced no impedance matrix")
        text=outputs[0].read_text(encoding="utf8",errors="replace")
        # FastHenry single-port rows use 'real +imagj'; accept exponent signs.
        number=r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?"
        matches=re.findall(r"("+number+r")\s+([+-]?\s*"+number+r")\s*[jJiI]",text)
        if len(matches)!=1:
            raise EvaluationError(f"Expected one FastHenry port result, got {len(matches)}: {text[-1500:]}")
        real,imag=(float(v.replace(" ","").replace("D","e").replace("d","e")) for v in matches[0])
        reference_L=imag/(2*math.pi*design.loop.frequency_hz)
        if reference_L<=0:
            raise EvaluationError("FastHenry returned nonpositive loop inductance")
        return {"powersynth":predicted.to_dict(),"fasthenry":{"resistance_ohm":real,"inductance_h":reference_L,
                    "impedance_real_ohm":real,"impedance_imag_ohm":imag},
                "reference_executable_sha256":hashlib.sha256(executable.read_bytes()).hexdigest(),
                "reference_input_sha256":hashlib.sha256(inp.read_bytes()).hexdigest(),
                "reference_solver_options":["-s","ludecomp","-m","direct","-a","off"],
                "relative_inductance_difference":abs(predicted.inductance_h-reference_L)/reference_L,
                "reference_model":json.loads(inp.with_suffix(".inp.json").read_text()),
                "note":"Comparison of these two model configurations is not hardware validation."}
