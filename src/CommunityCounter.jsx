import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { getCounter, likeExplorer, setCounterVisible, subscribeCounter } from './communityCounter.js';
import './community-counter.css';

export function CommunityCounter() {
  const [state, setState] = useState(getCounter);
  const root = useRef(null);
  useEffect(() => {
    const unsubscribe = subscribeCounter(() => setState(getCounter()));
    setState(getCounter());
    if (!('IntersectionObserver' in window)) { setCounterVisible(true); return () => { setCounterVisible(false); unsubscribe(); }; }
    const observer = new IntersectionObserver(entries => setCounterVisible(entries.some(entry => entry.isIntersecting)));
    observer.observe(root.current);
    return () => { observer.disconnect(); setCounterVisible(false); unsubscribe(); };
  }, []);
  const status = state.pending ? 'Your like is saved on this device and will sync when connected.' : state.counts ? (state.live ? 'Live counts' : 'Saved counts; counter unavailable') : 'Counts unavailable';
  return <span className="community-counter" ref={root} aria-label="Explorer community">
    <span className="community-visits" title={status}>{state.counts ? `${state.counts.visits.toLocaleString()} visits${state.live ? '' : ' (saved)'}` : 'Visits unavailable'}</span>
    <button type="button" className="community-like" aria-pressed={state.liked} disabled={state.liked || state.busy} onClick={likeExplorer} aria-label={state.liked ? 'You liked this explorer' : 'Like this explorer'} title={state.pending ? status : undefined}><Heart size={13} fill={state.liked ? 'currentColor' : 'none'} aria-hidden="true" />{state.liked ? 'Liked' : 'Like'}</button>
    <span className="community-likes" title={status}>{state.counts ? `${state.counts.likes.toLocaleString()} likes${state.live ? '' : ' (saved)'}` : 'Likes unavailable'}</span>
    <span className="community-status" role="status">{status}</span>
  </span>;
}
