import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { components } from './data.js';

// Mesh dimensions are illustrative scene units, not a manufacturing drawing.
const mats = new Map();
function material(color,metalness=.0,roughness=.5){const key=`${color}-${metalness}-${roughness}`;if(!mats.has(key))mats.set(key,new THREE.MeshStandardMaterial({color,metalness,roughness}));return mats.get(key);}
const silver=()=>material('#bec5c9',.82,.27), gold=()=>material('#b99b56',.72,.3), black=()=>material('#252c2d',.22,.4), copper=()=>material('#d3833c',.85,.26), green=()=>material('#145e46',.1,.55);
function box(g,w,h,d,x,y,z,m,r=.025){const mesh=new THREE.Mesh(r?new RoundedBoxGeometry(w,h,d,1,r):new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;}
function cyl(g,r,h,x,y,z,m,n=32){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,h,n),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);return mesh;}
function named(mesh, name) { mesh.name = name; return mesh; }
function ring(g, outer, inner, depth, x, y, z, m) {
  // Revolving the rectangular section avoids degenerate seam triangles in
  // triangulated concentric circles, keeping washer normals valid for GLB.
  const geometry=new THREE.LatheGeometry([
    new THREE.Vector2(inner,-depth/2),new THREE.Vector2(outer,-depth/2),
    new THREE.Vector2(outer,depth/2),new THREE.Vector2(inner,depth/2),new THREE.Vector2(inner,-depth/2),
  ],32);
  geometry.rotateX(Math.PI/2);geometry.translate(0,0,depth/2);
  const mesh = new THREE.Mesh(geometry,m);
  mesh.rotation.x = -Math.PI/2; mesh.position.set(x,y-depth/2,z);
  mesh.castShadow=true; mesh.receiveShadow=true; g.add(mesh); return mesh;
}
function screw(g,x,y,z){cyl(g,.082,.045,x,y,z,silver(),12);box(g,.102,.012,.012,x,y+.027,z,black(),0);}
function textureLabel(g,text,w,h,x,y,z,color='#e4e9dc',vertical=false){const c=document.createElement('canvas');c.width=Math.max(128,text.length*48+32);c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.font='500 80px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,c.width/2,64);const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,side:THREE.DoubleSide}));if(!vertical)mesh.rotation.x=-Math.PI/2;mesh.position.set(x,y,z);g.add(mesh);return mesh;}
function boardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 1280;
  const context = canvas.getContext('2d');
  // Clean solder mask and restrained silkscreen keep the hardware legible.
  // Surface artwork does not represent electrical routing.
  context.fillStyle = '#155e48';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#73937f'; context.lineWidth = 2;
  context.strokeRect(24, 24, 2000, 1232);
  context.font = '24px monospace'; context.fillStyle = '#bdcdbd';
  context.fillText('FLUX  /  DAB-3K  /  CONCEPT', 60, 80);
  context.fillText('HV BRIDGE   Q1 — Q4', 230, 1190);
  context.fillText('LV BRIDGE   Q5 — Q8', 1100, 1190);
  context.fillText('ISOLATED DC / DC', 780, 100);
  // Printed as part of the board texture so the attribution stays with PCB1
  // in both the live assembly and the canonical GLB export.
  context.font = 'bold 30px monospace';
  context.textAlign = 'right';
  context.fillText('Created by Xinze Li', 1960, 80);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}
function buildMain(g) {
  const outline = new THREE.Shape();
  outline.moveTo(-5.65,-3.5); outline.lineTo(5.65,-3.5); outline.lineTo(5.65,3.5); outline.lineTo(-5.65,3.5); outline.closePath();
  for(const x of[-5.35,5.35])for(const z of[-3.2,3.2]) {
    const hole = new THREE.Path(); hole.absarc(x,-z,.087,0,Math.PI*2,true); outline.holes.push(hole);
  }
  // Drill the authored through-hole footprints at the actual pin locations.
  const drill=(x,z,r)=>{const hole=new THREE.Path();hole.absarc(x,-z,r,0,Math.PI*2,true);outline.holes.push(hole);};
  for(const p of components) {
    const [x,,z]=p.position;
    if(p.type==='mosfet')for(const dx of[-.17,0,.17])drill(x+dx,z-.725,.037);
    if(p.type==='capacitor')for(const dx of[-.16,.16])drill(x+dx,z,.035);
    if(p.type==='transformer')for(const dx of[-1.12,1.12])for(const dz of[-.98,.98])drill(x+dx,z+dz,.043);
    if(p.type==='inductor')for(const dx of[-.43,.43])drill(x+dx,z+.20,.041);
    if(p.type==='driver')for(let i=0;i<5;i++)drill(x-.4+i*.2,z+.3,.034);
    if(p.type==='control')for(let i=0;i<20;i++)drill(x-1.3+i*.137,z+.13,.034);
    if(p.type==='terminal')for(const dz of[-.24,.24])drill(x,z+dz,.066);
  }
  const substrate = named(new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:.13,bevelEnabled:false,curveSegments:20}),green()),'Drilled FR4 substrate');
  substrate.rotation.x=-Math.PI/2; substrate.position.y=-.065; substrate.castShadow=true; substrate.receiveShadow=true; g.add(substrate);
  const surfaceGeometry = new THREE.ShapeGeometry(outline,20), coordinates=surfaceGeometry.attributes.position;
  const uv = new Float32Array(coordinates.count*2);
  for(let i=0;i<coordinates.count;i++){uv[i*2]=(coordinates.getX(i)+5.65)/11.3;uv[i*2+1]=(coordinates.getY(i)+3.5)/7;}
  surfaceGeometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const surface=named(new THREE.Mesh(surfaceGeometry,new THREE.MeshStandardMaterial({map:boardTexture(),roughness:.65,metalness:.12})),'Clean solder mask and silkscreen');
  surface.rotation.x=-Math.PI/2; surface.position.y=.069; surface.receiveShadow=true; g.add(surface);
  for(const x of[-5.35,5.35])for(const z of[-3.2,3.2]) {
    named(ring(g,.14,.087,.018,x,.082,z,gold()),'Plated mounting annulus');
    screw(g,x,.104,z);
    named(ring(g,.10,.045,.35,x,-.24,z,gold()),'Board mounting standoff');
    named(cyl(g,.036,.49,x,-.12,z,silver(),12),'Mounting screw shank');
  }
}
function previewNode(node, role) {
  node.userData.previewRole = role;
  node.userData.previewBasePosition = node.position.toArray();
  node.userData.previewBaseScale = node.scale.toArray();
  return node;
}
function buildSink(g) {
  const plate=new THREE.Shape();plate.moveTo(-5.825,-3.725);plate.lineTo(5.825,-3.725);plate.lineTo(5.825,3.725);plate.lineTo(-5.825,3.725);plate.closePath();
  for(const x of[-5.65,5.65])for(const z of[-3.35,3.35]){const bore=new THREE.Path();bore.absarc(x,-z,.065,0,Math.PI*2,true);plate.holes.push(bore);}
  const baseplate=named(new THREE.Mesh(new THREE.ExtrudeGeometry(plate,{depth:.24,bevelEnabled:false,curveSegments:20}),silver()),'Drilled aluminum baseplate');
  baseplate.rotation.x=-Math.PI/2;baseplate.position.y=.16;baseplate.castShadow=true;baseplate.receiveShadow=true;g.add(baseplate);
  // The fin tops stay joined to the baseplate as their depth changes.
  const fins = new THREE.Group(); fins.name = 'Anchored heatsink fins'; fins.position.y = .2;
  previewNode(fins, 'fins'); g.add(fins);
  for(let i=0;i<31;i++)box(fins,.105,1.04,7.28,-5.5+i*.367,-.52,0,silver(),.015);
  named(box(g,10,.24,.58,0,.28,3.96,silver(),.025),'Front thermal shelf');
  for(const [side,x] of [['HV',-2.525],['LV',2.525]]) {
    named(box(g,4.25,.8,.2,x,1.62,3.68,silver(),.008),`${side} mounting rail`);
  }
  // Columns leave a passage beneath the upper rails for the bent device leads.
  for(const x of[-4.65,-2.5,-.4,.4,2.5,4.65])named(box(g,.13,.84,.2,x,.81,3.68,silver(),.005),'Thermal rail support');
  // Mounting ears are tied to the fixed baseplate, independent of fin depth.
  for(const x of[-5.65,5.65])for(const z of[-3.35,3.35]) {
    const tab=new THREE.Shape();tab.moveTo(-.3,-.325);tab.lineTo(.3,-.325);tab.lineTo(.3,.325);tab.lineTo(-.3,.325);tab.closePath();
    const bore=new THREE.Path();bore.absarc(0,0,.065,0,Math.PI*2,true);tab.holes.push(bore);
    const ear=named(new THREE.Mesh(new THREE.ExtrudeGeometry(tab,{depth:.15,bevelEnabled:false,curveSegments:20}),silver()),'Baseplate mounting ear');
    ear.rotation.x=-Math.PI/2;ear.position.set(x,.105,z);ear.castShadow=true;ear.receiveShadow=true;g.add(ear);
    named(ring(g,.13,.065,.035,x,.4175,z,black()),'Mounting ear washer');
  }
}
function buildBusbar(g, p) {
  const conductor=new THREE.Group();conductor.name='HV busbar conductor';g.add(conductor);previewNode(conductor,'busbar');
  box(conductor,.22,.06,2.7,0,0,.2,copper(),.012);
  // Small plated connection pads illustrate a close HV+/HV− pair, not wiring.
  for(const z of[-1,1.35])box(conductor,.29,.025,.28,0,.037,z,gold(),.018);
  for(const z of[-1,1.35])named(cyl(g,.065,.065,0,-.0625,z,material('#e6e4da',.05,.65),16),'Busbar insulating support');
  const label=textureLabel(conductor,p.polarity,.62,.14,0,.052,.2,'#4c3822');label.rotation.z=Math.PI/2;
}
function buildMosfet(parent,p) {
  const g=new THREE.Group();g.name='Insulated semiconductor mounting assembly';parent.add(g);previewNode(g,'device');
  named(box(g,.68,.64,.22,0,.5,0,black(),.035),'Semiconductor package');
  for(const [name,w,h,d,z,r,m] of [
    ['Drain heat-spreader tab',.55,.77,.06,-.17,.08,silver()],
    ['Electrical isolation pad',.58,.8,.03,-.20,.08,material('#e1d9c5',.02,.72)],
  ]) {
    const shape=new THREE.Shape();shape.moveTo(-w/2,.64-h/2);shape.lineTo(w/2,.64-h/2);shape.lineTo(w/2,.64+h/2);shape.lineTo(-w/2,.64+h/2);shape.closePath();
    const bore=new THREE.Path();bore.absarc(0,.92,r,0,Math.PI*2,true);shape.holes.push(bore);
    const mesh=named(new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:d,bevelEnabled:false,curveSegments:16}),m),name);
    mesh.position.z=z;mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
  }
  const bushing = named(ring(g,.078,.038,.10,0,0,0,material('#e1d9c5',.02,.72)),'Insulating shoulder bushing');
  bushing.rotation.set(0,0,0); bushing.position.set(0,.92,-.21);
  const flange=named(ring(g,.095,.038,.025,0,0,0,material('#e1d9c5',.02,.72)),'Insulating bushing flange');flange.rotation.set(0,0,0);flange.position.set(0,.92,-.11);
  const clamp=named(cyl(g,.035,.16,0,.92,-.15,silver(),12),'Insulated clamp screw');clamp.rotation.x=Math.PI/2;
  const head=named(cyl(g,.061,.025,0,.92,-.0725,silver(),12),'Clamp screw head');head.rotation.x=Math.PI/2;
  for(const x of[-.17,0,.17]) {
    named(box(parent,.045,.17,.045,x,.105,.04,silver(),.004),'Terminal lead');
    named(box(parent,.045,.045,.81,x,.02,-.3425,silver(),.004),'Terminal lead');
    named(box(parent,.045,.26,.045,x,-.10,-.725,silver(),.004),'Terminal lead');
    named(box(parent,.10,.015,.15,x,-.0775,-.725,silver(),.004),'Soldered lead land');
  }
  textureLabel(g,p.side==='HV'?'SiC':'MOS',.40,.11,0,.58,.112,'#c3c9c5',true);
  textureLabel(g,p.id,.30,.10,0,.42,.112,'#c3c9c5',true);
}
function buildCap(g,p) {
  const r=p.tall?.48:.44,h=p.tall?1.65:1.38;
  const can=new THREE.Group();can.name='Seated capacitor can';can.position.y=-.2;g.add(can);
  named(cyl(can,r,h,0,h/2+.1,0,material('#1a3156',.25,.37)),'Capacitor sleeve');
  named(cyl(can,r*.94,.035,0,h+.12,0,silver()),'Scored aluminum vent');
  ring(can,r*.99,r*.91,.045,0,h+.125,0,black());
  named(cyl(can,r*1.015,.05,0,.12,0,black()),'Seated capacitor gasket');
  for(const angle of[-Math.PI/4,Math.PI/4]){const vent=box(can,r*1.5,.005,.014,0,h+.14,0,material('#5c6c7a',.5,.4),0);vent.rotation.y=angle;}
  // A narrow sleeve stripe denotes the negative side without invented ratings.
  const stripe=new THREE.Mesh(new THREE.CylinderGeometry(r+.002,r+.002,h*.8,12,1,true,0,.24),material('#bac8d5',.15,.55));
  stripe.position.y=h/2+.1;can.add(stripe);
  for(const x of[-.16,.16]) {
    named(cyl(g,.026,.16,x,-.16,0,silver(),12),'Capacitor lead');
    named(ring(g,.065,.03,.012,x,-.099,0,silver()),'Capacitor solder fillet');
  }
  textureLabel(can,p.id,.4,.14,0,.82,r+.003,'#dce6ef',true);
  textureLabel(can,'DC LINK',.55,.12,0,.62,r+.004,'#b4c5d8',true);
}
function buildTransformer(g) {
  const ferrite = material('#303637', .1, .52);
  const bobbin = material('#a86b38', .1, .57);
  const secondaryCopper = material('#e8b36e', .77, .3);
  const namedBox = (name, ...args) => { const mesh = box(g, ...args); mesh.name = name; return mesh; };
  const wire = (name, points, radius, wireMaterial) => {
    const path = new THREE.CurvePath();
    for (let i=1; i<points.length; i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i-1]), new THREE.Vector3(...points[i])));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path, points.length*12, radius, 8, false), wireMaterial);
    mesh.name = name; mesh.castShadow = true; g.add(mesh); return mesh;
  };
  // A centered EE core passes through an insulating sleeve. The two winding
  // sections sit between bobbin flanges, inside the two open core windows.
  namedBox('T1 ferrite lower yoke', 2.4,.2,1.42,0,.25,0,ferrite,.025);
  namedBox('T1 ferrite upper yoke', 2.4,.22,1.42,0,1.88,0,ferrite,.025);
  namedBox('T1 ferrite center leg', .52,1.42,.62,0,1.06,0,ferrite,.015);
  for (const x of [-1.06,1.06]) namedBox(`T1 ferrite outer leg ${x<0?'primary':'secondary'}`, .28,1.42,1.42,x,1.06,0,ferrite,.02);
  for (const x of [-.335,.335]) namedBox('T1 bobbin sleeve side', .06,1.4,.84,x,1.06,0,bobbin,.008);
  for (const z of [-.39,.39]) namedBox('T1 bobbin sleeve face', .61,1.4,.06,0,1.06,z,bobbin,.008);
  for (const y of [.43,1.06,1.67]) namedBox('T1 insulating bobbin flange', 1.72,.07,1.32,0,y,0,bobbin,.025);
  const section = (name, turns, lowerY, height, radius, startAngle, wireMaterial) => {
    const points = [];
    for (let i=0; i<=turns*48; i++) {
      const progress = i/(turns*48), angle = startAngle+progress*turns*Math.PI*2;
      points.push(new THREE.Vector3(.7*Math.cos(angle), lowerY+progress*height, .56*Math.sin(angle)));
    }
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), turns*64, radius, 8, false), wireMaterial);
    mesh.name = name; mesh.castShadow = true; g.add(mesh);
  };
  section('T1 primary winding',12,.5,.48,.016,Math.PI,copper());
  section('T1 secondary winding',6,1.16,.42,.025,0,secondaryCopper);
  // Each winding exits in its own pin bank. Leads go around the outer legs,
  // then through the main board; they never pass through ferrite or FR-4.
  for (const [side, bank, levels, wireMaterial] of [[-1,'primary',[.5,.98],copper()],[1,'secondary',[1.16,1.58],secondaryCopper]]) {
    for (let i=0; i<2; i++) {
      const z = i===0?.98:-.98;
      wire(`T1 ${bank} lead ${i+1}`, [[side*.7,levels[i],0],[side*.82,levels[i],Math.sign(z)*.8],[side*1.12,.19,z]], bank==='primary'?.022:.03,wireMaterial);
      const pin = cyl(g,.034,.34,side*1.12,.02,z,gold(),12); pin.name = `T1 ${bank} board pin ${i+1}`;
      namedBox(`T1 ${bank} terminal foot ${i+1}`, .22,.19,.25,side*1.12,-.005,z,bobbin,.02);
    }
  }
  for (const x of [-1.24,1.24]) {
    namedBox('T1 retaining clip', .07,1.92,.1,x,1.09,.53,silver(),.012);
    namedBox('T1 retaining clip top', .2,.055,.1,x*.94,2.0175,.53,silver(),.01);
  }
  textureLabel(g,'T1  /  ISOLATED HF',1.7,.14,0,1.997,.1);
}
function buildToroid(g,big=false) {
  const r = big?.49:.4, t = big?.19:.16;
  const baseBottom = big?-.05:.008, baseTop = baseBottom+.14;
  const centerY = r+t+baseTop;
  const core = new THREE.Mesh(new THREE.TorusGeometry(r,t,16,64),material('#39413c',.08,.58));
  core.name = big?'L1 toroidal core':'LCM1 shared toroidal core'; core.position.y = centerY; core.castShadow = true; g.add(core);
  const base = box(g,big?1.48:1.24,.14,.6,0,baseBottom+.07,0,black(),.025);
  base.name = big?'L1 insulating cradle':'LCM1 insulating cradle';
  if (big) for (const x of [-.55,.55]) {
    const foot = box(g,.2,.065,.44,x,-.0825,0,black(),.015); foot.name = 'L1 PCB support foot';
  }
  const secondCopper = material('#edb36e',.8,.3);
  const sectors = big?[{name:'L1 winding',start:0,end:Math.PI*2,count:30,wireMaterial:copper()}]:[
    {name:'LCM1 winding A',start:-Math.PI/2+.19,end:Math.PI/2-.19,count:13,wireMaterial:copper()},
    {name:'LCM1 winding B',start:Math.PI/2+.19,end:Math.PI*1.5-.19,count:13,wireMaterial:secondCopper},
  ];
  const wireRadius = big?.023:.021, windingRadius = t+.035, turnArc = Math.PI*2-.16;
  const lead = (name, points, wireMaterial, radius=.026) => {
    const path = new THREE.CurvePath();
    for (let i=1;i<points.length;i++) path.add(new THREE.LineCurve3(new THREE.Vector3(...points[i-1]),new THREE.Vector3(...points[i])));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(path,48,radius,8,false),wireMaterial); mesh.name = name; mesh.castShadow = true; g.add(mesh);
  };
  const terminals = [];
  for (const sector of sectors) {
    let firstStart, previousEnd;
    for (let i=0; i<sector.count; i++) {
      const a = sector.start+(sector.end-sector.start)*(big?i/sector.count:i/(sector.count-1));
      const turn = new THREE.Mesh(new THREE.TorusGeometry(windingRadius,wireRadius,8,32,turnArc),sector.wireMaterial);
      // A turn lies in a radial/axial plane. Its normal follows the tangent
      // of the core centerline. A small axial-face gap lets successive turns
      // join into a continuous winding instead of separate closed rings.
      const radial = new THREE.Vector3(Math.cos(a),Math.sin(a),0);
      const tangent = new THREE.Vector3(-Math.sin(a),Math.cos(a),0);
      turn.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0,0,1),radial,tangent));
      turn.position.set(Math.cos(a)*r,centerY+Math.sin(a)*r,0);
      turn.name = `${sector.name} turn ${i+1}`; turn.userData.windingAngle = a; turn.castShadow = true; g.add(turn);
      const start = new THREE.Vector3(windingRadius,0,0).applyQuaternion(turn.quaternion).add(turn.position);
      const end = new THREE.Vector3(windingRadius*Math.cos(turnArc),windingRadius*Math.sin(turnArc),0).applyQuaternion(turn.quaternion).add(turn.position);
      if (previousEnd) lead(`${sector.name} inter-turn connection ${i}`, [previousEnd.toArray(),start.toArray()],sector.wireMaterial,wireRadius);
      else firstStart = start;
      previousEnd = end;
    }
    terminals.push({ start:firstStart, end:previousEnd, wireMaterial:sector.wireMaterial });
  }
  const pins = big?[[-.43,.2,terminals[0].start,terminals[0].wireMaterial],[.43,.2,terminals[0].end,terminals[0].wireMaterial]]:[
    [.43,-.2,terminals[0].start,terminals[0].wireMaterial],[.43,.2,terminals[0].end,terminals[0].wireMaterial],
    [-.43,-.2,terminals[1].start,terminals[1].wireMaterial],[-.43,.2,terminals[1].end,terminals[1].wireMaterial],
  ];
  const pinBottom = big?-.15:-.085;
  for (let i=0;i<pins.length;i++) {
    const [x,z,endpoint,wireMaterial] = pins[i];
    lead(`${big?'L1':'LCM1'} winding board lead ${i+1}`, [endpoint.toArray(),[endpoint.x,endpoint.y,.27],[x,baseTop-.035,.27],[x,baseTop-.035,z]],wireMaterial);
    const pin = cyl(g,.032,baseTop-.03-pinBottom,x,(baseTop-.03+pinBottom)/2,z,gold(),12);
    pin.name = `${big?'L1':'LCM1'} board pin ${i+1}`;
  }
}
function buildDriver(g) {
  named(box(g,1.05,.08,.78,0,.17,0,material('#4f9984',.2,.5)),'Gate driver PCB');
  for(const x of[-.27,.27]) {
    named(box(g,.29,.09,.28,x,.26,0,black()),'Gate driver IC');
    for(let i=0;i<4;i++)for(const z of[-.18,.18])box(g,.028,.025,.11,x-.11+i*.07,.237,z,silver(),.001);
    named(box(g,.13,.07,.10,x,.25,.25,material('#c4ae7f'),.005),'Local decoupling capacitor');
  }
  named(box(g,.90,.12,.13,0,.055,.30,black(),.01),'Driver header housing');
  for(let i=0;i<5;i++)named(box(g,.04,.50,.04,-.4+i*.2,-.03,.30,gold(),.002),'Driver header pin');
  for(const x of[-.43,.43]) {
    named(cyl(g,.055,.235,x,.0125,-.27,material('#e6e4da',.05,.65),16),'Driver mounting post');
    screw(g,x,.24,-.27);
  }
}
function buildControl(g) {
  const board=new THREE.Shape();board.moveTo(-1.7,.18);board.lineTo(1.7,.18);board.lineTo(1.7,1.68);board.lineTo(-1.7,1.68);board.closePath();
  for(const x of[-1.5,1.5])for(const y of[.36,1.5]){const bore=new THREE.Path();bore.absarc(x,y,.035,0,Math.PI*2,true);board.holes.push(bore);}
  const pcb=named(new THREE.Mesh(new THREE.ExtrudeGeometry(board,{depth:.1,bevelEnabled:false,curveSegments:16}),material('#147b68',.12,.5)),'Control card PCB');pcb.position.z=-.05;pcb.castShadow=true;pcb.receiveShadow=true;g.add(pcb);
  box(g,.68,.68,.08,0,.95,.09,black());
  for(let i=0;i<12;i++)for(const side of[-1,1]){box(g,.018,.04,.04,-.3+i*.055,.95+side*.37,.1,silver(),.001);box(g,.04,.018,.04,side*.37,.65+i*.055,.1,silver(),.001);}
  for(let i=0;i<18;i++){const x=-1.5+(i%9)*.37,y=.43+Math.floor(i/9)*.95;box(g,.16,.08,.10,x,y,.1,black(),.005);box(g,.07,.03,.11,x+.12,y,.1,material('#c4ae7f'),.002);}
  named(box(g,2.8,.2,.3,0,.17,0,black()),'Card edge connector');
  named(box(g,2.9,.25,.34,0,-.04,0,material('#323d3b',.12,.45)),'Board-mounted control socket');
  for(let i=0;i<20;i++)named(box(g,.035,.53,.04,-1.3+i*.137,-.085,.13,gold(),.002),'Control connector pin');
  for(const x of[-1.5,1.5]) {
    named(box(g,.14,.35,.30,x,.01,0,material('#e6e4da',.05,.65),.02),'Control card retaining support');
    for(const y of[.36,1.5]){const annulus=ring(g,.065,.035,.025,0,0,0,gold());annulus.rotation.set(0,0,0);annulus.position.set(x,y,.05);}
  }
  textureLabel(g,'FLUX / DIGITAL CONTROL',2.7,.14,0,1.66,.058,'#d9eddd',true);
}
function buildTerminal(g,p) {
  const outline=new THREE.Shape();outline.moveTo(-.465,.105);outline.lineTo(.465,.105);outline.lineTo(.465,.735);outline.lineTo(-.465,.735);outline.closePath();
  for(const z of[-.24,.24]){const entry=new THREE.Path();entry.absarc(z,.35,.115,0,Math.PI*2,true);outline.holes.push(entry);}
  const housing=named(new THREE.Mesh(new THREE.ExtrudeGeometry(outline,{depth:.75,bevelEnabled:false,curveSegments:20}),material('#8ebc7f',.10,.55)),'Bored two-pole terminal housing');
  housing.rotation.y=Math.PI/2;housing.position.x=-.375;housing.castShadow=true;housing.receiveShadow=true;g.add(housing);
  const side=p.id==='J1'?-1:1;
  for(const z of[-.35,.35])named(box(g,.65,.21,.13,0,0,z,material('#8ebc7f',.10,.55),.015),'Terminal seating foot');
  for(const z of[-.24,.24]) {
    screw(g,0,.75,z);
    const barrel=named(ring(g,.114,.085,.19,0,0,0,gold()),'Wire-entry barrel');
    barrel.rotation.set(0,Math.PI/2,0);barrel.position.set(side>0?.20:-.39,.35,z);
    named(box(g,.08,.40,.08,0,-.055,z,gold(),.005),'Terminal pin');
    named(ring(g,.08,.045,.014,0,-.099,z,silver()),'Terminal solder fillet');
  }
}
export function buildAssembly() {
  const root = new THREE.Group(); root.name = 'FLUX_DAB_3kW_concept';
  root.userData = {description:'Conceptual educational 400 V / 48 V dual active bridge. Not manufacturing CAD.',units:'illustrative scene units'};
  const parts = new Map();
  for(const p of components) {
    const group = new THREE.Group(); group.name = `${p.id} — ${p.name}`;
    group.userData = {componentId:p.id,category:p.category,description:p.description};
    group.position.fromArray(p.position);
    // Part roots retain their immutable homes. Candidate geometry affects only
    // this inner visual group, so separation, picking and GLB roots stay stable.
    const visual = new THREE.Group(); visual.name = `${p.id} visual`;
    group.add(visual);
    switch(p.type) {
      case 'mainboard': buildMain(visual); break;
      case 'heatsink': buildSink(visual); break;
      case 'mosfet': buildMosfet(visual,p); break;
      case 'capacitor': buildCap(visual,p); break;
      case 'transformer': buildTransformer(visual); break;
      case 'inductor': buildToroid(visual,true); break;
      case 'choke': buildToroid(visual); break;
      case 'driver': buildDriver(visual); break;
      case 'control': buildControl(visual); break;
      case 'busbar': buildBusbar(visual,p); break;
      case 'emiBoard':
        {
          const shape=new THREE.Shape();shape.moveTo(-.59,-1.8);shape.lineTo(.59,-1.8);shape.lineTo(.59,1.8);shape.lineTo(-.59,1.8);shape.closePath();
          const bore=(x,z,r)=>{const hole=new THREE.Path();hole.absarc(x,-z,r,0,Math.PI*2,true);shape.holes.push(hole);};
          for(const z of[-1.7,1.7])bore(0,z,.045);
          for(const x of[-.43,.43])for(const z of[-.3,.1])bore(x,z,.041);
          for(const z of[-1.51,-1.19,1.09,1.41])bore(0,z,.035);
          const board=named(new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.075,bevelEnabled:false,curveSegments:16}),material('#376c50')),'Drilled EMI filter PCB');
          board.rotation.x=-Math.PI/2;board.position.y=-.0175;board.castShadow=true;board.receiveShadow=true;visual.add(board);
        }
        for(const z of[-1.7,1.7]){screw(visual,0,.08,z);named(cyl(visual,.065,.04,0,-.0375,z,material('#e6e4da',.05,.65),16),'Filter board spacer');}
        break;
      case 'film':
        box(visual,.82,.8,.49,0,.5,0,material('#e8bf45',.15,.38),.07);
        for(const z of[-.16,.16]){named(cyl(visual,.025,.24,0,.01,z,silver(),12),'Film capacitor lead');named(ring(visual,.05,.03,.0925,0,.05375,z,material('#c1b29a',.05,.6)),'Film capacitor seating collar');}
        textureLabel(visual,p.id,.5,.16,0,.52,.248,'#79682c',true);
        break;
      case 'terminal': buildTerminal(visual,p); break;
    }
    if(['EMI1','LCM1','CX1','CX2'].includes(p.id)) {
      previewNode(visual,'filter');
      // Hold the right-hand edge fixed; larger filter candidates grow toward
      // the outside of the board, never toward the isolation region or busbars.
      visual.userData.filterAnchorX = .6;
      // Scale the whole filter cluster about its connector-side edge. Growing
      // the board toward negative z keeps it clear of the HV input terminal;
      // translating the inner parts keeps every candidate on that board.
      visual.userData.filterAnchorZ = 1.4 - p.position[2];
    }
    const previewNodes = []; visual.traverse(node => {if(node.userData.previewRole)previewNodes.push(node);});
    root.add(group);
    parts.set(p.id,{group,visual,previewNodes,data:p,home:new THREE.Vector3(...p.position),offset:new THREE.Vector3(...p.explode)});
  }
  // Curved wire junctions can accumulate floating-point normal lengths.
  // Keep rendering and exported shading consistent before either consumes them.
  root.traverse(node=>{if(node.isMesh&&node.geometry?.hasAttribute('normal'))node.geometry.normalizeNormals();});
  return {root,parts};
}

// Only inner transforms change. Materials are shared and are never mutated.
export const BASE_STORY_VISUAL = Object.freeze({deviceScale:1,busbarWidth:1,busbarThickness:1,sinkFinDepth:1,filterScale:1,edgeSpeed:1});
export function sanitizeStoryVisual(visual = {}) {
  return Object.fromEntries(Object.entries(BASE_STORY_VISUAL).map(([key, fallback]) => [key, Number.isFinite(visual[key]) ? THREE.MathUtils.clamp(visual[key],.6,1.4) : fallback]));
}
export function applyStoryVisual(parts, visual = BASE_STORY_VISUAL) {
  const values = sanitizeStoryVisual(visual);
  for(const part of parts.values()) for(const node of part.previewNodes) {
    node.position.fromArray(node.userData.previewBasePosition);
    node.scale.fromArray(node.userData.previewBaseScale);
    switch(node.userData.previewRole) {
      case 'device': node.scale.x *= values.deviceScale; break;
      case 'busbar': node.scale.x *= values.busbarWidth; node.scale.y *= values.busbarThickness; node.position.y += .03*(values.busbarThickness-1); break;
      case 'fins': node.scale.y *= values.sinkFinDepth; break;
      case 'filter':
        node.scale.x *= values.filterScale; node.scale.z *= values.filterScale;
        node.position.x += node.userData.filterAnchorX * (1 - values.filterScale);
        node.position.z += node.userData.filterAnchorZ * (1 - values.filterScale);
        break;
    }
  }
}
export function resetStoryVisual(root) {
  root.traverse(node => {
    if(node.userData.previewBasePosition)node.position.fromArray(node.userData.previewBasePosition);
    if(node.userData.previewBaseScale)node.scale.fromArray(node.userData.previewBaseScale);
  });
}
// The exporter and CPU tests use this same preparation path. Live preview
// transforms, hidden/extracted state and scene annotations cannot enter it.
export function cloneCanonicalAssembly(root, parts) {
  const clone = root.clone(true);
  resetStoryVisual(clone);
  clone.traverse(node => {
    if(node.userData.componentId) {
      node.position.copy(parts.get(node.userData.componentId).home);
      node.visible = true;
    }
    for(const key of ['previewRole','previewBasePosition','previewBaseScale','filterAnchorX','filterAnchorZ'])delete node.userData[key];
  });
  return clone;
}
export function disposeAssembly(root){const geometries=new Set(),materials=new Set(),textures=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:[o.material]))if(m){materials.add(m);if(m.map)textures.add(m.map);}});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());mats.clear();}
