import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { applyStoryVisual, BASE_STORY_VISUAL, buildAssembly, disposeAssembly, sanitizeStoryVisual } from './geometry.js';
import { createRogowskiSensor, disposeRogowskiSensor } from './rogowskiSensor.js';

const STORY_GROUPS = {
  semiconductor: Array.from({ length: 8 }, (_, i) => `Q${i + 1}`),
  busbar: ['BB1', 'BB2'],
  thermal: ['HS1'],
  emi: ['EMI1', 'LCM1', 'CX1', 'CX2'],
};
const STORY_LINKS = {
  semiconductor: ['busbar', 'thermal'],
  busbar: ['semiconductor', 'emi'],
  thermal: ['semiconductor'],
  emi: ['busbar', 'semiconductor'],
};
const STORY_COLORS = { semiconductor:'#537c9e', busbar:'#bd763b', thermal:'#b46b44', emi:'#8b7e3e' };
const ease = value => 1 - Math.pow(1 - THREE.MathUtils.clamp(value, 0, 1), 3);
const now = () => performance.now();
const validVector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
// These are attachment references on existing hardware.
// A camera ray resolves each reference to the part's actual opaque surface.
const ATTACHMENT_ROLES = {
  'output-voltage': { partId:'J2', local:[0,.78,-.24] },
  'output-current': { partId:'J2', local:[0,.78,.24] },
  'control-card': { partId:'CTRL1', local:[1.1,1.6,.06] },
};

export class ConverterScene {
  constructor(host, onSelect, onReady, onError) {
    this.host=host; this.onSelect=onSelect; this.hidden=new Set(); this.extracted=new Set();
    this.explosion=0; this.selected='T1'; this.isolated=null; this.running=true; this.suspended=false;
    this.aiHighlights=new Map(); this.highlightedIds=[]; this.highlightColor='#397ca4';
    this.storyPreview=null; this.storyVisual={...BASE_STORY_VISUAL}; this.storyLinks=[];
    this.designGroups=[]; this.designActive=false; this.anchorRay=new THREE.Raycaster(); this.anchorProjectionDirty=true;
    this.assessmentActive=false; this.assessmentOutline=null;
    this.motionQuery=window.matchMedia('(prefers-reduced-motion: reduce)');
    this.scene=new THREE.Scene(); this.scene.background=new THREE.Color('#f4f5f2');
    this.camera=new THREE.PerspectiveCamera(34,1,.1,150); this.camera.position.set(10.8,9.4,13.9);
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2)); this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap; this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.95; host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D power converter. Drag to orbit, scroll to zoom. Components can also be selected from the Assembly panel.');
    this.renderer.domElement.setAttribute('role','img');
    this.pmrem=new THREE.PMREMGenerator(this.renderer); const room=new RoomEnvironment();
    this.environment=this.pmrem.fromScene(room,.04); this.scene.environment=this.environment.texture; room.dispose();
    this.scene.add(new THREE.HemisphereLight('#ffffff','#9ea69d',1.3));
    const light=new THREE.DirectionalLight('#fff9ed',3.3); light.position.set(-4,11,7); light.castShadow=true;
    light.shadow.mapSize.set(2048,2048); light.shadow.camera.left=-13; light.shadow.camera.right=13;
    light.shadow.camera.top=13; light.shadow.camera.bottom=-13; light.shadow.camera.far=40;
    light.shadow.normalBias=.035; light.shadow.bias=-.0002; light.shadow.radius=4; this.scene.add(light);
    const fill=new THREE.DirectionalLight('#e4efff',1.5); fill.position.set(8,5,-6); this.scene.add(fill);
    const assembly=buildAssembly(); this.root=assembly.root; this.parts=assembly.parts; this.scene.add(this.root);
    // Kept outside root so story-only sensing hardware is not exported as one
    // of the canonical assembly's named and separable components.
    this.currentSensor=createRogowskiSensor(); this.currentSensor.visible=false; this.scene.add(this.currentSensor);
    this.floor=new THREE.Mesh(new THREE.PlaneGeometry(150,150),new THREE.ShadowMaterial({opacity:.1}));
    this.floor.rotation.x=-Math.PI/2; this.floor.position.y=-1.7; this.floor.receiveShadow=true; this.scene.add(this.floor);
    this.selection=new THREE.Box3Helper(new THREE.Box3(),new THREE.Color('#138676'));
    this.selection.material.transparent=true; this.selection.material.opacity=.48; this.scene.add(this.selection);
    // Preview annotations belong to the scene, never to the canonical assembly.
    this.storyAnnotations=new THREE.Group(); this.storyAnnotations.name='Transient design coupling annotations'; this.scene.add(this.storyAnnotations);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement); this.controls.target.set(.75,.65,0);
    this.controls.enableDamping=!this.motionQuery.matches; this.controls.dampingFactor=.075;
    this.controls.minDistance=7; this.controls.maxDistance=42; this.controls.maxPolarAngle=Math.PI*.49;
    this.controls.autoRotateSpeed=.7; this.controls.enablePan=true; this.controls.update();
    this.ray=new THREE.Raycaster(); this.pointer=new THREE.Vector2(); this.down=null;
    this.onDown=event=>{if(this.suspended)return;this.down=[event.clientX,event.clientY];this.cameraTween=null;this.restoredView=null;};
    this.onUp=event=>{if(this.suspended||!this.down||Math.hypot(event.clientX-this.down[0],event.clientY-this.down[1])>6)return;const hit=this.pick(event);if(hit)this.onSelect(hit);};
    this.onMove=event=>{if(this.suspended)return;this.renderer.domElement.style.cursor=this.pick(event)?'pointer':'grab';};
    this.renderer.domElement.addEventListener('pointerdown',this.onDown); this.renderer.domElement.addEventListener('pointerup',this.onUp);
    this.renderer.domElement.addEventListener('pointermove',this.onMove);
    this.onContextLost=event=>{event.preventDefault();onError('The 3D context was interrupted. Reload the page to restore the viewer.');};
    this.renderer.domElement.addEventListener('webglcontextlost',this.onContextLost);
    this.resizeObserver=new ResizeObserver(()=>this.resize()); this.resizeObserver.observe(host); this.resize(); this.animate(); onReady();
  }

  pick(event) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.ray.setFromCamera(this.pointer,this.camera);
    const visible=[...this.parts.values()].filter(part=>part.group.visible).map(part=>part.group);
    let object=this.ray.intersectObjects(visible,true)[0]?.object;
    while(object&&!object.userData.componentId)object=object.parent;
    return object?.userData.componentId;
  }

  resize() {
    if(this.suspended)return;
    this.anchorProjectionDirty=true;
    const {width,height}=this.host.getBoundingClientRect();
    if(width<1||height<1)return;
    this.camera.aspect=Math.max(width,1)/Math.max(height,1); this.camera.updateProjectionMatrix();
    this.renderer.setSize(Math.max(width,1),Math.max(height,1));
    const mobile=width<700;
    const needsFit=!this.didInitialFit||this.wasMobile!==mobile||Math.abs((this.previousAspect||this.camera.aspect)-this.camera.aspect)>.15;
    if(this.restoredView&&now()<this.restoredView.until) {
      this.applyCapturedView(this.restoredView.snapshot);
    } else if(needsFit) this.preset(this.view||'iso',false);
    this.didInitialFit=true; this.wasMobile=mobile; this.previousAspect=this.camera.aspect;
  }

  setSuspended(suspended) {
    if(this.suspended===suspended)return;
    this.suspended=suspended;
    this.host.dataset.suspended=String(suspended);
    this.controls.enabled=!suspended;
    this.down=null;
    if(suspended) {
      this.suspendedAt=now();
      this.suspendedView=this.captureView();
      cancelAnimationFrame(this.frame);
    } else {
      const elapsed=now()-(this.suspendedAt??now());
      for(const part of this.parts.values())if(part.positionTween)part.positionTween.start+=elapsed;
      if(this.previewTween)this.previewTween.start+=elapsed;
      // Keep inspection framing when the hidden workspace becomes measurable.
      this.restoreView(this.suspendedView);
      this.resize();
      this.anchorProjectionDirty=true;
      this.animate();
    }
  }

  update(state) {
    this.anchorProjectionDirty=true;
    const previousExplosion=this.explosion;
    const previousStory=this.storyPreview;
    const previousDesign=this.designActive;
    Object.assign(this,state);
    this.designGroups=Array.isArray(this.designGroups)?this.designGroups:[];
    this.designActive=this.designGroups.length>0;
    const groupsKey=JSON.stringify(this.designGroups.map(group=>[group.id,group.partIds,group.anchorId,group.attachmentRole,group.attachmentLocal]));
    const groupsChanged=groupsKey!==this.designGroupsKey;
    this.designGroupsKey=groupsKey;
    // A newly mounted overview needs a fresh map even if a quick mode switch
    // returns to exactly the coordinates emitted before the intervening frame.
    if(groupsChanged)this.projectedSignature=undefined;
    this.host.dataset.designGroups=this.designGroups.map(group=>group.id).join(' ');
    this.controls.maxDistance=this.storyPreview||this.designActive?110:42;
    const nextVisual=sanitizeStoryVisual(this.storyPreview?.visual);
    const storyKey=this.storyPreview ? JSON.stringify([this.storyPreview.candidateId,this.storyPreview.groupId,this.storyPreview.transitionKey,nextVisual]) : '';
    if(storyKey!==this.storyKey) {
      this.storyKey=storyKey; this.storyPulseStart=now();
      this.previewTween={from:{...this.storyVisual},to:nextVisual,start:now(),duration:this.motionQuery.matches?0:720};
      if(this.storyPreview?.groupId!==previousStory?.groupId||!this.storyPreview!==!previousStory)this.rebuildStoryLinks();
      if(this.storyPreview&&!previousStory) {this.restoredView=null;this.preset(this.view||'iso');}
    }
    if(this.designActive&&(!previousDesign||groupsChanged)) {this.restoredView=null;this.preset('iso');}
    this.host.dataset.storyCandidate=this.storyPreview?.candidateId||'';
    this.host.dataset.storyGroup=STORY_GROUPS[this.storyPreview?.groupId]?this.storyPreview.groupId:'';
    for(const [id,part] of this.parts) {
      part.group.visible=!this.hidden.has(id)&&(!this.isolated||id===this.isolated);
      const target=part.home.clone().addScaledVector(part.offset,this.explosion);
      if(this.extracted.has(id))target.add(new THREE.Vector3(part.offset.x*.65,2.8,part.offset.z*.65));
      if(!part.positionTween?.to.equals(target)&&!part.group.position.equals(target))part.positionTween={from:part.group.position.clone(),to:target,start:now(),duration:this.motionQuery.matches?0:720};
    }
    if(this.currentSensor) {
      this.currentSensor.visible=this.designGroups.some(group=>group.attachmentRole==='output-current')&&!!this.parts.get('J2')?.group.visible;
      this.host.dataset.rogowskiSensor=this.currentSensor.visible?'visible':'hidden';
    }
    const restoring=this.restoredView&&!this.storyPreview&&!this.designActive&&now()<this.restoredView.until;
    if((previousExplosion>.4)!==(this.explosion>.4)&&!restoring)this.preset(this.view||'iso');
    this.controls.autoRotate=!!this.rotate&&!this.storyPreview&&!this.designActive&&!this.motionQuery.matches;
    this.updateAIHighlights();
    this.updateAssessmentOutline();
  }

  updateAssessmentOutline() {
    const active=!!this.assessmentActive;
    const flag=active?'true':'false';
    if(this.host.dataset.assessmentActive!==flag)this.host.dataset.assessmentActive=flag;
    if(active&&!this.assessmentOutline) {
      const outline=new THREE.Box3Helper(new THREE.Box3(),new THREE.Color('#b58b40'));
      outline.name='Whole-converter maintenance assessment outline';
      outline.material.transparent=true; outline.material.opacity=.28;
      this.scene.add(outline); this.assessmentOutline=outline;
    }
    if(this.assessmentOutline) {
      this.assessmentOutline.visible=active;
      if(active) {
        this.root.updateMatrixWorld(true);
        this.assessmentOutline.box.setFromObject(this.root);
        this.assessmentOutline.box.expandByScalar(.12);
      }
    }
  }

  disposeAssessmentOutline() {
    if(!this.assessmentOutline)return;
    this.scene.remove(this.assessmentOutline);
    this.assessmentOutline.geometry.dispose(); this.assessmentOutline.material.dispose();
    this.assessmentOutline=null;
  }

  updateAIHighlights() {
    const ids=new Set(this.highlightedIds||[]);
    const colors=new Map();
    // A terminal can carry several conceptual signal markers. Its one outline
    // follows the first group; each marker's independent color stays in UI.
    for(const group of this.designGroups||[])for(const id of group.partIds||[])if(!colors.has(id))colors.set(id,group.color);
    for(const [id,helper] of this.aiHighlights) if(!ids.has(id)) {
      this.scene.remove(helper); helper.geometry.dispose(); helper.material.dispose(); this.aiHighlights.delete(id);
    }
    for(const id of ids) {
      if(!this.parts.has(id))continue;
      let helper=this.aiHighlights.get(id);
      if(!helper) {
        helper=new THREE.Box3Helper(new THREE.Box3(),new THREE.Color(this.highlightColor||'#397ca4'));
        helper.name=`AI target ${id}`; helper.material.transparent=true; helper.material.opacity=.8;
        this.scene.add(helper); this.aiHighlights.set(id,helper);
      }
      helper.material.color.set(colors.get(id)||this.highlightColor||'#397ca4');
    }
    this.host.dataset.aiTargets=[...this.aiHighlights.keys()].join(' ');
    this.host.dataset.highlightColors=JSON.stringify(Object.fromEntries([...this.aiHighlights].map(([id,helper])=>[id,`#${helper.material.color.getHexString()}`])));
    this.host.dataset.highlightGroupColors=JSON.stringify(Object.fromEntries((this.designGroups||[]).map(group=>[group.id,`#${new THREE.Color(group.color||this.highlightColor||'#397ca4').getHexString()}`])));
  }

  transitionCamera(position,target,animate=true) {
    if(!animate||this.motionQuery.matches) {
      this.clearControlMotion();
      this.cameraTween=null; this.camera.position.copy(position); this.controls.target.copy(target);
      const rotate=this.controls.autoRotate; this.controls.autoRotate=false; this.controls.update(); this.controls.autoRotate=rotate;
      return;
    }
    this.clearControlMotion();
    this.cameraTween={fromPosition:this.camera.position.clone(),fromTarget:this.controls.target.clone(),position,target,start:now(),duration:650};
  }

  clearControlMotion() {
    const damping=this.controls.enableDamping,rotate=this.controls.autoRotate;
    this.controls.enableDamping=false; this.controls.autoRotate=false;
    this.controls.update();
    this.controls.enableDamping=damping; this.controls.autoRotate=rotate;
  }

  captureView() {
    return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),view:this.view||'iso'};
  }

  applyCapturedView(snapshot) {
    this.clearControlMotion();
    this.view=snapshot.view||'iso'; this.cameraTween=null;
    this.camera.position.fromArray(snapshot.position); this.controls.target.fromArray(snapshot.target);
    const rotate=this.controls.autoRotate; this.controls.autoRotate=false; this.controls.update(); this.controls.autoRotate=rotate;
  }

  restoreView(snapshot) {
    if(!snapshot||!validVector(snapshot.position)||!validVector(snapshot.target))return;
    this.restoredView={snapshot:{position:[...snapshot.position],target:[...snapshot.target],view:snapshot.view||'iso'},until:now()+1100};
    // ResizeObserver can fire after the story panel unmounts. Preserve this exact
    // snapshot through that layout change instead of replacing it with a preset.
    this.applyCapturedView(this.restoredView.snapshot);
  }

  focusParts(ids) {
    const bounds=new THREE.Box3();
    for(const id of ids||[]) {const part=this.parts.get(id);if(part)bounds.union(new THREE.Box3().setFromObject(part.group));}
    if(bounds.isEmpty())return;
    const center=bounds.getCenter(new THREE.Vector3()); const size=bounds.getSize(new THREE.Vector3());
    const vertical=this.camera.fov*Math.PI/180;
    const distance=Math.max(size.y/2/Math.tan(vertical/2),size.x/2/(Math.tan(vertical/2)*this.camera.aspect),size.z)*1.55;
    const direction=this.camera.position.clone().sub(this.controls.target).normalize();
    this.restoredView=null;
    this.transitionCamera(center.clone().add(direction.multiplyScalar(Math.min(65,Math.max(7,distance)))),center);
  }

  preset(name,animate=true) {
    this.view=name; this.restoredView=null;
    const mobile=this.host.clientWidth<700; const exploded=this.explosion>.4;
    const vector={iso:[10.8,9.4,13.9],top:[.01,19.5,.01],front:[0,4,20],side:[20,5,0]}[name]||[10.8,9.4,13.9];
    // Design overviews and legacy previews frame the full assembly around x=0.
    const centered=!!this.storyPreview||this.designActive;
    const aspectFactor=centered?Math.max(1,1.35/Math.max(.28,this.camera.aspect)):(mobile?1.32:1.08*Math.max(1,1.52/this.camera.aspect));
    let factor=aspectFactor*(exploded?1.55:1);
    const target=centered?new THREE.Vector3(0,0,0):new THREE.Vector3(mobile?0:(exploded?.6:1.65),exploded?1:.1,0);
    if(name==='top') {
      const bounds=new THREE.Box3().setFromObject(this.root),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
      const tangent=Math.tan(THREE.MathUtils.degToRad(this.camera.fov)/2);
      const horizontal=(size.x/2+Math.abs(center.x-target.x))/(tangent*Math.max(.28,this.camera.aspect));
      const vertical=(size.z/2+Math.abs(center.z-target.z))/tangent;
      factor=Math.max(factor,(Math.max(horizontal,vertical)*1.12+bounds.max.y)/19.5);
    }
    const position=new THREE.Vector3(...vector).multiplyScalar(factor);
    // A top camera must share its target's X. An offset here rolls the long
    // board axis vertically when looking almost parallel to world-up.
    if(name==='top'){position.x=target.x;position.z=target.z+.01;}
    this.transitionCamera(position,target,animate);
  }

  focus() {this.focusParts([this.selected]);}

  designAttachment(partId,group={}) {
    const part=this.parts.get(partId);
    if(!part?.group.visible)return null;
    if(group.attachmentRole==='output-current'&&this.currentSensor?.visible) {
      return this.currentSensor.localToWorld(new THREE.Vector3(...this.currentSensor.userData.anchorLocal));
    }
    const role=ATTACHMENT_ROLES[group.attachmentRole];
    // Rear mounting screws remain exposed above the raised device rail.
    const local=validVector(group.attachmentLocal)?group.attachmentLocal:role?.partId===partId?role.local:
      part.data.type==='driver'?[this.camera.position.x>=part.group.position.x?.43:-.43,.27,-.27]:null;
    let reference;
    if(local)reference=part.group.localToWorld(new THREE.Vector3(...local));
    else {
      let geometry=part.group;
      // Attach the cooling leader to exposed outer fins, not the heatsink's
      // center below the PCB. The near-side corner stays useful while orbiting.
      if(partId==='HS1') {
        const fins=part.previewNodes.find(node=>node.userData.previewRole==='fins');
        if(fins?.children.length)geometry=fins.children[this.camera.position.x>=part.group.position.x?fins.children.length-1:0];
      }
      const bounds=new THREE.Box3().setFromObject(geometry);
      if(bounds.isEmpty())return null;
      reference=bounds.getCenter(new THREE.Vector3());
      if(partId==='HS1') {
        reference.y=THREE.MathUtils.lerp(bounds.min.y,bounds.max.y,.55);
        reference.z=this.camera.position.z>=part.group.position.z?bounds.max.z-.012:bounds.min.z+.012;
      } else reference.y=THREE.MathUtils.lerp(bounds.min.y,bounds.max.y,.84);
    }
    const cameraPoint=reference.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if(cameraPoint.z>=-this.camera.near)return null;
    this.anchorRay.set(this.camera.position,reference.clone().sub(this.camera.position).normalize());
    this.anchorRay.near=0; this.anchorRay.far=Infinity;
    // A ray to this part's actual triangles gives a physical attachment surface.
    return this.anchorRay.intersectObject(part.group,true).find(hit=>!hit.object.material?.transparent)?.point.clone()||null;
  }

  projectDesignAnchors() {
    const anchors={};
    for(const group of this.designGroups||[]) {
      const partId=group.anchorId||group.partIds?.[0]||'';
      const point=this.designAttachment(partId,group);
      let u=.5,v=.5,visible=false;
      if(point) {
        const projected=point.clone().project(this.camera);
        u=(projected.x+1)/2; v=(1-projected.y)/2;
        const cameraPoint=point.clone().applyMatrix4(this.camera.matrixWorldInverse);
        visible=Number.isFinite(u)&&Number.isFinite(v)&&cameraPoint.z<-this.camera.near&&projected.z>=-1&&projected.z<=1&&u>=0&&u<=1&&v>=0&&v<=1;
        if(visible) {
          const distance=this.camera.position.distanceTo(point);
          this.anchorRay.set(this.camera.position,point.clone().sub(this.camera.position).normalize());
          this.anchorRay.near=0; this.anchorRay.far=Math.max(0,distance-.002);
          const groups=[...this.parts.values()].filter(part=>part.group.visible).map(part=>part.group);
          let occluder=this.anchorRay.intersectObjects(groups,true).find(hit=>!hit.object.material?.transparent)?.object;
          while(occluder&&!occluder.userData.componentId)occluder=occluder.parent;
          visible=!occluder||occluder.userData.componentId===partId;
        }
      }
      anchors[group.id]={u:Number.isFinite(u)?Number(u.toFixed(4)):.5,v:Number.isFinite(v)?Number(v.toFixed(4)):.5,visible,partId};
    }
    const signature=JSON.stringify(anchors);
    if(signature!==this.projectedSignature) {
      this.projectedSignature=signature;
      this.onProjectedAnchors?.(anchors);
    }
    return anchors;
  }

  clearStoryLinks() {
    const geometries=new Set(),materials=new Set();
    this.storyAnnotations.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
    geometries.forEach(geometry=>geometry.dispose()); materials.forEach(material=>material.dispose());
    this.storyAnnotations.clear(); this.storyLinks=[];
  }

  rebuildStoryLinks() {
    this.clearStoryLinks();
    const groupId=this.storyPreview?.groupId;
    if(!STORY_GROUPS[groupId])return;
    const color=STORY_COLORS[groupId];
    for(const target of STORY_LINKS[groupId]) {
      const geometry=new THREE.BufferGeometry().setFromPoints(Array.from({length:33},()=>new THREE.Vector3()));
      const material=new THREE.LineDashedMaterial({color,transparent:true,opacity:.65,dashSize:.19,gapSize:.12,depthWrite:false});
      const line=new THREE.Line(geometry,material); line.name=`Conceptual ${groupId} to ${target} coupling`; line.frustumCulled=false;
      const arrow=new THREE.Mesh(new THREE.ConeGeometry(.085,.28,12),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.8,depthWrite:false}));
      arrow.name='Coupling direction'; this.storyAnnotations.add(line,arrow); this.storyLinks.push({source:groupId,target,line,arrow});
    }
  }

  groupAnchor(id) {
    const bounds=new THREE.Box3();
    for(const partId of STORY_GROUPS[id]||[]) {
      const part=this.parts.get(partId); if(part?.group.visible)bounds.union(new THREE.Box3().setFromObject(part.group));
    }
    if(bounds.isEmpty())return null;
    const center=bounds.getCenter(new THREE.Vector3()); center.y=bounds.max.y+.15; return center;
  }

  updateStoryLinks(time) {
    const anchors=new Map();
    const getAnchor=id=>{if(!anchors.has(id))anchors.set(id,this.groupAnchor(id));return anchors.get(id);};
    const pulse=this.storyPreview&&!this.motionQuery.matches?Math.max(0,1-(time-this.storyPulseStart)/850):0;
    for(const link of this.storyLinks) {
      const start=getAnchor(link.source),end=getAnchor(link.target);
      link.line.visible=link.arrow.visible=!!(start&&end);
      if(!start||!end)continue;
      const middle=start.clone().lerp(end,.5); middle.y+=.65+Math.min(1,start.distanceTo(end)*.12);
      const curve=new THREE.QuadraticBezierCurve3(start,middle,end);
      const position=link.line.geometry.attributes.position;
      for(let i=0;i<position.count;i++) {const point=curve.getPoint(i/(position.count-1));position.setXYZ(i,point.x,point.y,point.z);}
      position.needsUpdate=true; link.line.computeLineDistances();
      link.line.material.opacity=.56+pulse*.25; link.line.material.dashSize=.19*this.storyVisual.edgeSpeed;
      link.arrow.material.opacity=.75+pulse*.2;
      link.arrow.position.copy(curve.getPoint(.86));
      link.arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),curve.getTangent(.86).normalize());
    }
  }

  animate=()=> {
    if(!this.running||this.suspended)return;
    this.frame=requestAnimationFrame(this.animate); const time=now(); const reduced=this.motionQuery.matches;
    let geometryChanged=false;
    const cameraMoving=!!this.cameraTween;
    this.controls.enableDamping=!reduced;
    this.controls.autoRotate=!!this.rotate&&!this.storyPreview&&!this.designActive&&!reduced;
    for(const part of this.parts.values()) if(part.positionTween) {
      geometryChanged=true;
      const tween=part.positionTween; const progress=reduced||!tween.duration?1:THREE.MathUtils.clamp((time-tween.start)/tween.duration,0,1);
      part.group.position.lerpVectors(tween.from,tween.to,ease(progress)); if(progress===1)part.positionTween=null;
    }
    if(this.previewTween) {
      geometryChanged=true;
      const tween=this.previewTween; const progress=reduced||!tween.duration?1:THREE.MathUtils.clamp((time-tween.start)/tween.duration,0,1);
      for(const key of Object.keys(BASE_STORY_VISUAL))this.storyVisual[key]=THREE.MathUtils.lerp(tween.from[key],tween.to[key],ease(progress));
      applyStoryVisual(this.parts,this.storyVisual);
      this.host.dataset.storyTransition=progress===1?'settled':'running'; if(progress===1)this.previewTween=null;
    }
    if(this.cameraTween) {
      const tween=this.cameraTween; const progress=reduced?1:THREE.MathUtils.clamp((time-tween.start)/tween.duration,0,1);
      this.camera.position.lerpVectors(tween.fromPosition,tween.position,ease(progress));
      this.controls.target.lerpVectors(tween.fromTarget,tween.target,ease(progress)); if(progress===1)this.cameraTween=null;
    }
    const controlsChanged=this.controls.update();
    this.root.updateMatrixWorld(true); this.camera.updateMatrixWorld();
    const terminal=this.parts.get('J2');
    if(this.currentSensor.visible&&terminal) {
      terminal.group.getWorldPosition(this.currentSensor.position);
      terminal.group.getWorldQuaternion(this.currentSensor.quaternion);
      this.currentSensor.updateMatrixWorld(true);
    }
    if(geometryChanged&&this.assessmentActive)this.updateAssessmentOutline();
    if(this.anchorProjectionDirty||controlsChanged||geometryChanged||cameraMoving) {
      this.projectDesignAnchors(); this.anchorProjectionDirty=false;
    }
    const active=this.parts.get(this.selected);
    const pulse=this.storyPreview&&!reduced?Math.max(0,1-(time-this.storyPulseStart)/850):0;
    for(const [id,helper] of this.aiHighlights) {
      const part=this.parts.get(id); helper.visible=!!part?.group.visible;
      helper.material.opacity=.72+pulse*.25;
      if(helper.visible) {helper.box.setFromObject(part.group);helper.box.expandByScalar(.055+pulse*.025);}
    }
    this.updateStoryLinks(time);
    this.selection.visible=!!active?.group.visible&&!this.isolated&&!this.aiHighlights.has(this.selected);
    if(this.selection.visible) {this.selection.box.setFromObject(active.group);this.selection.box.expandByScalar(.04);}
    if(this.label&&active) {
      const bounds=new THREE.Box3().setFromObject(active.group); const point=bounds.getCenter(new THREE.Vector3());
      point.y=bounds.max.y+.28; point.project(this.camera);
      this.label.style.left=`${(point.x*.5+.5)*this.host.clientWidth+this.host.offsetLeft}px`;
      this.label.style.top=`${(-point.y*.5+.5)*this.host.clientHeight+this.host.offsetTop}px`;
      this.label.style.display=active.group.visible&&point.z<1?'block':'none';
    }
    this.renderer.render(this.scene,this.camera);
  };

  dispose() {
    this.running=false; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown',this.onDown); this.renderer.domElement.removeEventListener('pointerup',this.onUp);
    this.renderer.domElement.removeEventListener('pointermove',this.onMove); this.renderer.domElement.removeEventListener('webglcontextlost',this.onContextLost);
    for(const helper of this.aiHighlights.values()) {helper.geometry.dispose();helper.material.dispose();}
    this.aiHighlights.clear(); this.clearStoryLinks(); disposeAssembly(this.root); this.scene.remove(this.currentSensor); disposeRogowskiSensor(this.currentSensor); this.floor.geometry.dispose(); this.floor.material.dispose();
    this.disposeAssessmentOutline();
    this.selection.geometry.dispose(); this.selection.material.dispose(); this.environment.dispose(); this.pmrem.dispose(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
