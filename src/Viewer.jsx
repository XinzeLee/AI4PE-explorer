import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { ConverterScene } from './scene';
import { byId } from './data';
export const Viewer=forwardRef(function Viewer({selected,explosion,hidden,extracted,isolated,rotate,labels,onSelect,highlightedIds,highlightColor},ref){
 const host=useRef(null),scene=useRef(null),label=useRef(null),select=useRef(onSelect);select.current=onSelect;const[status,setStatus]=useState('loading');const[error,setError]=useState('');
 useEffect(()=>{try{scene.current=new ConverterScene(host.current,id=>select.current(id),()=>setStatus('ready'),message=>{setError(message);setStatus('error');});scene.current.label=label.current;}catch(e){console.error(e);setError('This device could not start WebGL. Try a browser with hardware acceleration enabled. You can still explore every part in the Assembly panel.');setStatus('error');}return()=>scene.current?.dispose();},[]);
 useEffect(()=>{scene.current?.update({selected,explosion,hidden,extracted,isolated,rotate,highlightedIds,highlightColor});},[selected,explosion,hidden,extracted,isolated,rotate,highlightedIds,highlightColor]);
 useImperativeHandle(ref,()=>({preset:(name)=>scene.current?.preset(name),focus:()=>scene.current?.focus(),focusParts:(ids)=>scene.current?.focusParts(ids),exportModel:()=>{if(!scene.current)throw new Error('3D viewer is unavailable.');return scene.current.exportModel();}}),[]);
 return <><div ref={host} className="webgl-host" data-ready={status}/><div ref={label} className={`model-label ${labels?'':'invisible'}`} aria-hidden="true"><span/>{byId[selected].name}</div>{status==='loading'&&<div className="viewer-message">Preparing the assembly…</div>}{status==='error'&&<div className="viewer-message error-message"><strong>3D viewer unavailable</strong><p>{error}</p><button onClick={()=>window.location.reload()}>Reload viewer</button></div>}</>;
});
