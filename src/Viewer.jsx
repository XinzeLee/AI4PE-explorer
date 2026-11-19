import { useEffect, useLayoutEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { ConverterScene } from './scene';
import { byId } from './data';
export const Viewer=forwardRef(function Viewer({selected,explosion,hidden,extracted,isolated,rotate,labels,onSelect,highlightedIds,highlightColor,storyPreview=null,designGroups=null,onProjectedAnchors,assessmentActive=false,suspended=false},ref){
 const host=useRef(null),scene=useRef(null),label=useRef(null),select=useRef(onSelect),project=useRef(onProjectedAnchors);select.current=onSelect;project.current=onProjectedAnchors;const[status,setStatus]=useState('loading');const[error,setError]=useState('');
 // A shared lab URL does not need to construct the hardware until its first return.
 // Once created, the scene is retained through every subsequent lab visit.
 useEffect(()=>{if(suspended||scene.current)return;try{scene.current=new ConverterScene(host.current,id=>select.current(id),()=>setStatus('ready'),message=>{setError(message);setStatus('error');});scene.current.label=label.current;scene.current.onProjectedAnchors=anchors=>project.current?.(anchors);}catch(e){console.error(e);setError('This device could not start WebGL. Try a browser with hardware acceleration enabled. You can still explore every part in the Assembly panel.');setStatus('error');}},[suspended]);
 useEffect(()=>()=>scene.current?.dispose(),[]);
 useEffect(()=>{scene.current?.update({selected,explosion,hidden,extracted,isolated,rotate,highlightedIds,highlightColor,storyPreview,designGroups,assessmentActive});},[selected,explosion,hidden,extracted,isolated,rotate,highlightedIds,highlightColor,storyPreview,designGroups,assessmentActive,status]);
 useLayoutEffect(()=>{scene.current?.setSuspended(suspended);},[suspended,status]);
 useImperativeHandle(ref,()=>({preset:(name)=>scene.current?.preset(name),focus:()=>scene.current?.focus(),focusParts:(ids)=>scene.current?.focusParts(ids),captureView:()=>scene.current?.captureView(),restoreView:(snapshot)=>scene.current?.restoreView(snapshot)}),[]);
 return <><div ref={host} className="webgl-host" data-ready={status} data-suspended={String(suspended)}/><div ref={label} className={`model-label ${labels?'':'invisible'}`} aria-hidden="true"><span/>{byId[selected].name}</div>{status==='loading'&&<div className="viewer-message">Preparing the assembly…</div>}{status==='error'&&<div className="viewer-message error-message"><strong>3D viewer unavailable</strong><p>{error}</p><button onClick={()=>window.location.reload()}>Reload viewer</button></div>}</>;
});
