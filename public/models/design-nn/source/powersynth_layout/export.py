"""Portable JSON, SVG, and review-report exports without a GUI dependency."""
from __future__ import annotations

from html import escape
import json
from pathlib import Path

from .model import Design, Layout
from .mesh import wire_points


def write_json(path, value):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,allow_nan=False)+"\n",encoding="utf8")


def layout_svg(layout: Design | Layout):
    d=layout.design if isinstance(layout,Layout) else layout
    wire_paths=[]
    coords=[(0.,0.),tuple(d.board_mm)]
    for wire in (*d.bond_wires,*d.paths):
        for i in range(getattr(wire,"count",1)):
            pts=wire_points(d,wire,i)
            coords.extend(tuple(pt[:2]) for pt in pts)
            wire_paths.append((wire,pts))
    coords=[(x,d.board_mm[1]-y) for x,y in coords]
    x0=min(p[0] for p in coords)-2; y0=min(p[1] for p in coords)-2
    w=max(p[0] for p in coords)-x0+2; h=max(p[1] for p in coords)-y0+2
    colors=["#e6a85c","#6eb0c9","#b19cd8","#85be95","#d88282"]
    nets={n:colors[i%len(colors)] for i,n in enumerate(sorted({r.net for r in d.regions}))}
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}" role="img" aria-label="{escape(d.name,quote=True)}">',
         '<style>text{font-family:Arial,sans-serif;fill:#182333} .name{font-size:1px} .small{font-size:.75px}</style>',
         f'<g transform="translate(0,{d.board_mm[1]}) scale(1,-1)">',
         f'<rect width="{d.board_mm[0]}" height="{d.board_mm[1]}" fill="#f6f5ef" stroke="#657383" stroke-width=".15"/>']
    for region in d.regions:
        if not d.layer_map[region.layer].patterned:
            continue  # A backside plane is not visible in the top view.
        x,y,rw,rh=region.rect_mm
        out.append(f'<rect x="{x}" y="{y}" width="{rw}" height="{rh}" fill="{nets[region.net]}" stroke="#776248" stroke-width=".1"/>')
    for c in d.components:
        x,y,cw,ch=c.rect_mm
        out.append(f'<rect x="{x}" y="{y}" width="{cw}" height="{ch}" fill="#37475a" stroke="#fff" stroke-width=".12"/>')
        if c.kind == "die":
            for pin in c.pins:
                if pin.contact_region is not None:
                    continue
                px=x+pin.offset_mm[0]-pin.pad_mm[0]/2
                py=y+pin.offset_mm[1]-pin.pad_mm[1]/2
                fill="#dce7f4" if pin.id in ("G","Gate") else "#739dbe"
                out.append(f'<rect x="{px}" y="{py}" width="{pin.pad_mm[0]}" height="{pin.pad_mm[1]}" fill="{fill}" stroke="#dae2ea" stroke-width=".05"/>')
    for wire,points in wire_paths:
        seq=" ".join(f"{pt[0]},{pt[1]}" for pt in points)
        color="#856332" if hasattr(wire,"loop_height_mm") else "#53708f"
        out.append(f'<polyline points="{seq}" fill="none" stroke="{color}" stroke-width="{max(.12,wire.diameter_mm)}" opacity=".8"/>')
    out.append('</g>')
    for r in d.regions:
        if not d.layer_map[r.layer].patterned:
            continue
        x,y,rw,rh=r.rect_mm
        out.append(f'<text x="{x+.4}" y="{d.board_mm[1]-y-rh+1.2}" class="name">{escape(r.id)} ({escape(r.net)})</text>')
    for c in d.components:
        out.append(f'<text x="{c.rect_mm[0]+.3}" y="{d.board_mm[1]-c.rect_mm[1]-c.rect_mm[3]/2}" class="name" style="fill:white">{escape(c.id)}</text>')
    for name,color in [(d.loop.source,"#b91c1c"),(d.loop.sink,"#1d4ed8")]:
        point,_,_=d.endpoint(name)
        x,y=point[0],d.board_mm[1]-point[1]
        out.append(f'<circle cx="{x}" cy="{y}" r=".4" fill="{color}"/><text x="{x+.5}" y="{y}" class="small">{escape(name)}</text>')
    out.append('</svg>')
    return "\n".join(out)


def write_svg(path, layout):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(layout_svg(layout),encoding="utf8")


def write_ranking_report(path, result):
    rows="".join(f'<tr><td>{escape(r.layout.id)}</td><td>{r.electrical.inductance_h*1e9:.5f}</td><td>{r.electrical.resistance_ohm*1e3:.5f}</td><td>{r.layout.design.board_mm[0]:g} × {r.layout.design.board_mm[1]:g}</td></tr>' for r in result.ranked)
    html=f'''<!doctype html><html lang="en"><meta charset="utf-8"><title>PowerSynth layout comparison</title>
<style>body{{font:16px system-ui;max-width:1100px;margin:32px auto;padding:0 20px;color:#24354a;background:#fafaf8}}h1{{font-size:28px}}.plots{{display:grid;grid-template-columns:1fr 1fr;gap:24px}}svg{{width:100%;height:420px}}table{{border-collapse:collapse;width:100%}}td,th{{text-align:left;padding:10px;border-bottom:1px solid #ccc}}@media(max-width:700px){{.plots{{grid-template-columns:1fr}}}}</style>
<h1>Loop inductance comparison</h1><p>Baseline: {result.baseline.electrical.inductance_h*1e9:.5f} nH. Best: {result.best.electrical.inductance_h*1e9:.5f} nH. Modelled reduction: {result.improvement_fraction:.1%}.</p>
<p>Frequency: {result.best.electrical.frequency_hz:g} Hz. These are PEEC model predictions. Physical accuracy has not been certified.</p>
<div class="plots"><section><h2>Initial layout</h2>{layout_svg(result.baseline.layout)}</section><section><h2>Best candidate</h2>{layout_svg(result.best.layout)}</section></div>
<table><thead><tr><th>Candidate</th><th>Inductance (nH)</th><th>Resistance (mΩ)</th><th>Floorplan (mm)</th></tr></thead><tbody>{rows}</tbody></table>
<h2>Model assumptions</h2><ul>{''.join('<li>'+escape(note)+'</li>' for note in result.best.electrical.diagnostics)}</ul>
<p>Rejected candidates: {len(result.failures)}. Full settings, diagnostics, and geometry are in ranking.json.</p></html>'''
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(html,encoding="utf8")
