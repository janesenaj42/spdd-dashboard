/**
 * Bookmarks: the pages a reader starred, as viewer hrefs ("#/d/<path>", "#/f/DEMO-101", "#/", or
 * "/raw?path=" for a screen). Kept in this browser's localStorage, per origin, so the viewer still
 * writes no repository file and each developer keeps their own list.
 */
const KEY = 'spdd-viewer.bookmarks';

export function list() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Call fn when another tab of the viewer changes the bookmarks. */
export const onChange = (fn) => window.addEventListener('storage', (e) => e.key === KEY && fn());

/** Star or unstar href. Returns the new state, or null when the browser refuses storage. */
export function toggle(href) {
  const items = list();
  const on = !items.includes(href);
  try {
    localStorage.setItem(KEY, JSON.stringify(on ? [...items, href] : items.filter((x) => x !== href)));
    return on;
  } catch {
    return null;
  }
}

/** The bookmark key for a location hash: drops ?a=&q= and normalises the path's encoding. */
export function hrefOf(hash) {
  const p = hash.split('?')[0];
  const m = p.match(/^#\/([ds])\/(.+)$/);
  if (m) return `#/${m[1]}/${encodeURIComponent(decodeURIComponent(m[2]))}`;
  return p === '' || p === '#' ? '#/' : p;
}
