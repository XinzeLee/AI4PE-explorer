const PAGE_MODES = new Set(['overview', 'path', 'ai', 'design', 'control', 'maintenance']);
const validMode = mode => PAGE_MODES.has(mode) ? mode : 'overview';

/** Build a site-local path for either root hosting or a Vite project base. */
export function sitePath(path = '', base = import.meta.env?.BASE_URL || '/') {
  const directory = String(base).replace(/^\/+|\/+$/g, '');
  const prefix = directory ? `/${directory}/` : '/';
  return prefix + String(path).replace(/^\/+/, '');
}

export const LAB_URL = sitePath('?mode=control&lab=modulation-nn');
export const RUL_LAB_URL = sitePath('?mode=maintenance&lab=rul-nn');
export const DESIGN_LAB_URL = sitePath('?mode=design&lab=geometry-nn');
const LAB_MODES = { 'modulation-nn': 'control', 'rul-nn': 'maintenance', 'geometry-nn': 'design' };

/** Read only supported page states and the lab belonging to that story. */
export function readPageRoute(search = '') {
  const params = new URLSearchParams(search);
  const mode = validMode(params.get('mode'));
  const requestedLab = params.get('lab');
  const labId = LAB_MODES[requestedLab] === mode ? requestedLab : null;
  return { mode, lab: labId !== null, labId };
}

/** Keep unrelated query parameters and the fragment while routing at the site's base. */
export function pageUrl(mode, lab = false, currentHref = 'http://localhost/', base = import.meta.env?.BASE_URL || '/') {
  const url = new URL(currentHref, 'http://localhost/');
  const nextMode = validMode(mode);
  if (nextMode === 'overview') url.searchParams.delete('mode');
  else url.searchParams.set('mode', nextMode);
  // Boolean true keeps its original meaning for callers of the Control helper.
  const labId = lab === true ? 'modulation-nn' : lab;
  if (LAB_MODES[labId] === nextMode) url.searchParams.set('lab', labId);
  else url.searchParams.delete('lab');
  return `${sitePath('', base)}${url.search}${url.hash}`;
}
