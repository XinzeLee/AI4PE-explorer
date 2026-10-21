import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildAssembly, disposeAssembly } from './geometry';

export class ConverterScene {
  constructor(host, onSelect, onReady, onError) {
    this.host=host;this.onSelect=onSelect;this.hidden=new Set();this.extracted=new Set();this.explosion=0;this.selected='T1';this.isolated=null;this.running=true;this.aiHighlights=new Map();this.highlightedIds=[];this.highlightColor='#397ca4';
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color('#f4f5f2');
    this.camera=new THREE.PerspectiveCamera(34,1,.1,150);this.camera.position.set(10.8,9.4,13.9);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.95;host.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','Interactive 3D power converter. Drag to orbit, scroll to zoom. Components can also be selected from the Assembly panel.');this.renderer.domElement.setAttribute('role','img');
    this.pmrem=new THREE.PMREMGenerator(this.renderer);const room=new RoomEnvironment();this.environment=this.pmrem.fromScene(room,.04);this.scene.environment=this.environment.texture;room.dispose();
    this.scene.add(new THREE.HemisphereLight('#ffffff','#9ea69d',1.3));const light=new THREE.DirectionalLight('#fff9ed',3.3);light.position.set(-4,11,7);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-13;light.shadow.camera.right=13;light.shadow.camera.top=13;light.shadow.camera.bottom=-13;light.shadow.camera.far=40;light.shadow.normalBias=.035;light.shadow.bias=-.0002;light.shadow.radius=4;this.scene.add(light);const fill=new THREE.DirectionalLight('#e4efff',1.5);fill.position.set(8,5,-6);this.scene.add(fill);
    const assembly=buildAssembly();this.root=assembly.root;this.parts=assembly.parts;this.scene.add(this.root);
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.ShadowMaterial({opacity:.1}));this.floor.rotation.x=-Math.PI/2;this.floor.position.y=-1.58;this.floor.receiveShadow=true;this.scene.add(this.floor);
    this.selection=new THREE.Box3Helper(new THREE.Box3(),new THREE.Color('#138676'));this.selection.material.transparent=true;this.selection.material.opacity=.48;this.scene.add(this.selection);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(.75,.65,0);this.controls.enableDamping=true;this.controls.dampingFactor=.075;this.controls.minDistance=7;this.controls.maxDistance=42;this.controls.maxPolarAngle=Math.PI*.49;this.controls.autoRotateSpeed=.7;this.controls.enablePan=true;this.controls.update();
    this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.down=null;this.onDown=e=>{this.down=[e.clientX,e.clientY];this.cameraTween=null;};this.onUp=e=>{if(!this.down||Math.hypot(e.clientX-this.down[0],e.clientY-this.down[1])>6)return;const hit=this.pick(e);if(hit)this.onSelect(hit);};this.onMove=e=>{this.renderer.domElement.style.cursor=this.pick(e)?'pointer':'grab';};this.renderer.domElement.addEventListener('pointerdown',this.onDown);this.renderer.domElement.addEventListener('pointerup',this.onUp);this.renderer.domElement.addEventListener('pointermove',this.onMove);this.onContextLost=e=>{e.preventDefault();onError('The 3D context was interrupted. Reload the page to restore the viewer.');};this.renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);this.resize();this.animate();onReady();
  }
  pick(e){const r=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const visible=[...this.parts.values()].filter(p=>p.group.visible).map(p=>p.group);const hit=this.ray.intersectObjects(visible,true)[0];let obj=hit?.object;while(obj&&!obj.userData.componentId)obj=obj.parent;return obj?.userData.componentId;}
  resize(){const{width,height}=this.host.getBoundingClientRect();this.camera.aspect=width/Math.max(height,1);this.camera.updateProjectionMatrix();this.renderer.setSize(width,height);const mobile=width<700;if(!this.didInitialFit||this.wasMobile!==mobile||Math.abs((this.previousAspect||this.camera.aspect)-this.camera.aspect)>.15){this.preset(this.view||'iso',false);this.didInitialFit=true;this.wasMobile=mobile;}this.previousAspect=this.camera.aspect;}
  update(state){const previousExplosion=this.explosion;Object.assign(this,state);if((previousExplosion>.4)!==(this.explosion>.4))this.preset(this.view||'iso');for(const[id,p]of this.parts)p.group.visible=!this.hidden.has(id)&&(!this.isolated||id===this.isolated);this.controls.autoRotate=this.rotate;this.updateAIHighlights();}
  updateAIHighlights(){
    const ids=new Set(this.highlightedIds||[]);
    for(const[id,helper]of this.aiHighlights){
      if(!ids.has(id)){this.scene.remove(helper);helper.geometry.dispose();helper.material.dispose();this.aiHighlights.delete(id);}
    }
    for(const id of ids){
      if(!this.parts.has(id))continue;
      let helper=this.aiHighlights.get(id);
      if(!helper){helper=new THREE.Box3Helper(new THREE.Box3(),new THREE.Color(this.highlightColor));helper.name=`AI target ${id}`;helper.material.transparent=true;helper.material.opacity=.8;this.scene.add(helper);this.aiHighlights.set(id,helper);}
      helper.material.color.set(this.highlightColor||'#397ca4');
    }
    this.host.dataset.aiTargets=[...this.aiHighlights.keys()].join(' ');
  }
  focusParts(ids){
    const bounds=new THREE.Box3();
    for(const id of ids||[]){const p=this.parts.get(id);if(p)bounds.union(new THREE.Box3().setFromObject(p.group));}
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3());
    const size=bounds.getSize(new THREE.Vector3());
    const vertical=this.camera.fov*Math.PI/180;
    const distance=Math.max(size.y/2/Math.tan(vertical/2),size.x/2/(Math.tan(vertical/2)*this.camera.aspect),size.z)*1.55;
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();
    this.cameraTween={target:center,position:center.clone().add(direction.multiplyScalar(Math.min(40,Math.max(7,distance))))};
  }
  preset(name,animate=true){this.view=name;const mobile=this.host.clientWidth<700;const e=this.explosion>.4?1.55:1;let v={iso:[10.8,9.4,13.9],top:[.01,19.5,.01],front:[0,4,20],side:[20,5,0]}[name]||[10.8,9.4,13.9];let factor=(mobile?1.32:1.08*Math.max(1,1.52/this.camera.aspect))*e;const target=new THREE.Vector3(mobile?0:(this.explosion>.4?.6:1.65),this.explosion>.4?1.0:.1,0);const pos=new THREE.Vector3(...v).multiplyScalar(factor);if(animate){this.cameraTween={position:pos,target};}else{this.camera.position.copy(pos);this.controls.target.copy(target);this.controls.update();}}
  focus(){const p=this.parts.get(this.selected);if(!p)return;const bounds=new THREE.Box3().setFromObject(p.group);const center=bounds.getCenter(new THREE.Vector3());const size=bounds.getSize(new THREE.Vector3()).length();const direction=this.camera.position.clone().sub(this.controls.target).normalize();this.cameraTween={target:center,position:center.clone().add(direction.multiplyScalar(Math.max(size*1.8,7)))};}
  animate=()=>{if(!this.running)return;this.frame=requestAnimationFrame(this.animate);for(const[id,p]of this.parts){const target=p.home.clone().addScaledVector(p.offset,this.explosion);if(this.extracted.has(id))target.add(new THREE.Vector3(p.offset.x*.65,2.8,p.offset.z*.65));p.group.position.lerp(target,window.matchMedia('(prefers-reduced-motion: reduce)').matches?1:.11);}if(this.cameraTween){this.camera.position.lerp(this.cameraTween.position,.08);this.controls.target.lerp(this.cameraTween.target,.08);if(this.camera.position.distanceTo(this.cameraTween.position)<.008)this.cameraTween=null;}this.controls.update();const active=this.parts.get(this.selected);for(const[id,helper]of this.aiHighlights){const p=this.parts.get(id);helper.visible=!!p?.group.visible;if(helper.visible){helper.box.setFromObject(p.group);helper.box.expandByScalar(.055);}}this.selection.visible=!!active?.group.visible&&!this.isolated&&!this.aiHighlights.has(this.selected);if(this.selection.visible){this.selection.box.setFromObject(active.group);this.selection.box.expandByScalar(.04);}if(this.label&&active){const b=new THREE.Box3().setFromObject(active.group);const p=b.getCenter(new THREE.Vector3());p.y=b.max.y+.28;p.project(this.camera);this.label.style.left=`${(p.x*.5+.5)*this.host.clientWidth+this.host.offsetLeft}px`;this.label.style.top=`${(-p.y*.5+.5)*this.host.clientHeight+this.host.offsetTop}px`;this.label.style.display=active.group.visible&&p.z<1?'block':'none';}this.renderer.render(this.scene,this.camera);};
  async exportModel(){const{GLTFExporter}=await import('three/addons/exporters/GLTFExporter.js');const clone=this.root.clone(true);clone.traverse(o=>{if(o.userData.componentId){o.position.copy(this.parts.get(o.userData.componentId).home);o.visible=true;}});return new GLTFExporter().parseAsync(clone,{binary:true,onlyVisible:false});}
  dispose(){this.running=false;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.onDown);this.renderer.domElement.removeEventListener('pointerup',this.onUp);this.renderer.domElement.removeEventListener('pointermove',this.onMove);this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);for(const helper of this.aiHighlights.values()){helper.geometry.dispose();helper.material.dispose();}this.aiHighlights.clear();disposeAssembly(this.root);this.floor.geometry.dispose();this.floor.material.dispose();this.selection.geometry.dispose();this.selection.material.dispose();this.environment.dispose();this.pmrem.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
