/**
 * SPDD Dashboard front end. Hash routes:
 *   #/                 Board: every feature and its documents
 *   #/f/<ID>           Feature brief: story, stages, decisions, open questions, risks, history
 *   #/d/<path>?a=&q=   Document reader; a = anchor to open, q = term to highlight
 *   #/s/<term>         Search every catalogued document
 *   #/adr              Every ADR with its status
 *   #/load             Lines and reading time per feature and per document group
 * Any of them can be bookmarked (bookmarks.js); the bookmarks head the library sidebar.
 */
import * as marks from './bookmarks.js';
import { focus as focusSource, neighbourhood, parse as parseDiagram } from './flowfilter.js';
import { esc, extractDefs, ID_RE, plain, render } from './md.js';

const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');
const pop = $('#pop');
const WPM = 230;

const S = { index: null, catalogue: new Set(), tracked: new Set(), dirs: new Set(), defs: new Map(), docFeature: new Map() };

/** Status → pill colour. The statuses are the server's STAGES `reached` values. */
const statusKind = (s) => (s === 'Reviewed' ? 'done' : 'busy');
const minutes = (words) => Math.max(1, Math.round(words / WPM));
const short = (p) =>
  p
    .split('/')
    .pop()
    .replace(/^.+?-\d{8}(?:\d{4})?-\[[^\]]+\]-/, '')
    .replace(/\.md$/, '');

const docHref = (p, anchor, q) => {
  const params = new URLSearchParams();
  if (anchor) params.set('a', anchor);
  if (q) params.set('q', q);
  const qs = params.toString();
  return `#/d/${encodeURIComponent(p)}${qs ? `?${qs}` : ''}`;
};
const featureHref = (id) => `#/f/${id}`;
const vscodeHref = (p) => `vscode://file/${S.index.rootAbs}/${p}`;
const libHref = (p) => (p.endsWith('.html') ? `/raw?path=${encodeURIComponent(p)}` : docHref(p));
/** Screens (/raw) open in a new tab; every viewer route opens in place. */
const linkTarget = (href) => (href.startsWith('/raw?') ? ' target="_blank" rel="noreferrer"' : '');
const groupOf = (p) => S.index.groups.find((g) => g.files.some((x) => x.path === p))?.name ?? '';

// ── Data ────────────────────────────────────────────────────────────────────────────────────

async function loadIndex() {
  S.index = await (await fetch('/api/index')).json();
  S.catalogue = new Set(S.index.groups.flatMap((g) => g.files.map((f) => f.path)));
  S.tracked = new Set(S.index.tracked);
  S.dirs = new Set(S.index.tracked.flatMap((t) => t.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))));
  S.docFeature = new Map();
  for (const f of S.index.features) for (const p of chainPaths(f)) S.docFeature.set(p, f.id);
  $('#repo').textContent = S.index.root;
  renderLibrary();
}

const docCache = new Map();
async function getDoc(p) {
  const r = await fetch(`/api/doc?path=${encodeURIComponent(p)}`);
  if (!r.ok) throw new Error((await r.json()).error);
  const d = await r.json();
  docCache.set(p, d);
  return d;
}

/** A feature as steps: its user story (empty when none was found), then each SPDD document folder. */
const featureSteps = (f) => [
  { label: 'Story', command: '', docs: f.story ? [f.story] : [] },
  ...S.index.stages.map((s) => ({ ...s, docs: f.stages[s.key] })),
];
const chainPaths = (f) => featureSteps(f).flatMap((s) => s.docs.map((d) => d.path));
const sumOf = (docs, field) => docs.reduce((n, d) => n + (d[field] ?? 0), 0);
const chainTotal = (f, field) => featureSteps(f).reduce((n, s) => n + sumOf(s.docs, field), 0);
const stageOf = (p) => {
  const f = S.index.features.find((x) => x.file === p);
  if (f) return 'Feature';
  return S.index.stages.find((s) => p.startsWith(`${s.dir}/`))?.label ?? '';
};

/** Definitions for a feature: every chain document, earliest stage first, first definition wins. */
async function featureDefs(f) {
  const defs = new Map();
  const docs = await Promise.all(chainPaths(f).map(getDoc));
  for (const d of docs) for (const [id, def] of extractDefs(d.text, d.path)) if (!defs.has(id)) defs.set(id, def);
  return { defs, docs };
}

// ── Linking ─────────────────────────────────────────────────────────────────────────────────

/** A path written in a document → viewer link, VS Code link, or null when nothing exists there. */
function linkPath(raw, base = '') {
  const p = raw.trim().replace(/^\.\//, '').split('#')[0].replace(/[),.;:]+$/, '');
  if (!p || p.length > 300) return null;
  const candidates = [p];
  if (base) {
    const parts = base.split('/').slice(0, -1);
    for (const seg of p.split('/')) seg === '..' ? parts.pop() : parts.push(seg);
    candidates.unshift(parts.join('/'));
  }
  for (const c of candidates) {
    if (S.catalogue.has(c)) return docHref(c);
    if (S.tracked.has(c) || S.dirs.has(c.replace(/\/$/, ''))) return vscodeHref(c.replace(/\/$/, ''));
  }
  return null;
}

function adrPath(id) {
  return S.index.adrs.find((a) => a.id === id)?.path;
}

function linkId(id) {
  if (S.index.features.some((f) => f.id === id)) return featureHref(id);
  if (id.startsWith('ADR-')) {
    const p = adrPath(id);
    return p ? docHref(p) : null;
  }
  const d = S.defs.get(id);
  return d ? docHref(d.path, d.anchor) : null;
}

// ── Popover for IDs ─────────────────────────────────────────────────────────────────────────

let popTimer;
document.addEventListener('mouseover', (e) => {
  const a = e.target.closest?.('a.idref');
  if (!a) return;
  clearTimeout(popTimer);
  popTimer = setTimeout(() => showPop(a), 180);
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest?.('a.idref') || e.target.closest?.('#pop')) {
    clearTimeout(popTimer);
    popTimer = setTimeout(() => (pop.hidden = true), 250);
  }
});
pop.addEventListener('mouseover', () => clearTimeout(popTimer));

function showPop(a) {
  const id = a.dataset.id;
  let html = '';
  const f = S.index.features.find((x) => x.id === id);
  const adr = id.startsWith('ADR-') && S.index.adrs.find((x) => x.id === id);
  const d = S.defs.get(id);
  if (f) html = `<b>${id}</b> <span class="pill ${statusKind(f.status)}">${esc(f.status)}</span><p>${esc(f.title)}</p>`;
  else if (adr) html = `<b>${id}</b> <span class="pill">${esc(adr.status)}</span><p>${esc(adr.title)}</p>`;
  else if (d) {
    const rows = d.fields.slice(0, 6).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v.length > 320 ? `${v.slice(0, 320)}…` : v)}</td></tr>`).join('');
    html = `<b>${id}</b> <span class="muted">${esc(stageOf(d.path) || short(d.path))} · ${esc(d.section)}</span><table>${rows}</table>`;
  } else return;
  pop.innerHTML = html;
  pop.hidden = false;
  const r = a.getBoundingClientRect();
  const w = Math.min(460, window.innerWidth - 24);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`;
  const below = r.bottom + 8;
  pop.style.top = `${below + pop.offsetHeight > window.innerHeight ? Math.max(8, r.top - pop.offsetHeight - 8) : below}px`;
}

// ── Library sidebar ─────────────────────────────────────────────────────────────────────────

function renderLibrary() {
  const lib = $('#lib');
  const current = decodeURIComponent(location.hash.match(/^#\/d\/([^?]+)/)?.[1] ?? '');
  lib.innerHTML =
    `<section id="marks" class="marks"></section><input id="libFilter" type="search" placeholder="Filter files">` +
    S.index.groups
      .map((g) => {
        const lines = g.files.reduce((n, f) => n + (f.lines ?? 0), 0);
        const open = g.files.some((f) => f.path === current);
        return `<details${open ? ' open' : ''}><summary>${esc(g.name)} <span class="muted">${g.files.length} · ${lines.toLocaleString()} ln</span></summary><ul>${g.files
          .map((f) => {
            const href = libHref(f.path);
            return `<li>${starButton(href)}<a href="${href}"${linkTarget(href)} title="${esc(f.path)}" class="${f.path === current ? 'current' : ''}">${esc(short(f.path))}</a><span class="muted">${f.lines ?? ''}</span></li>`;
          })
          .join('')}</ul></details>`;
      })
      .join('');
  $('#libFilter').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    for (const d of lib.querySelectorAll('details')) {
      let any = false;
      for (const li of d.querySelectorAll('li')) {
        const hit = !q || li.querySelector('a').title.toLowerCase().includes(q);
        li.hidden = !hit;
        any ||= hit;
      }
      d.hidden = !any;
      if (q) d.open = any;
    }
  });
  syncStars();
}

// ── Bookmarks ───────────────────────────────────────────────────────────────────────────────

const PAGES = {
  '#/': { label: 'Board', detail: 'Every feature and its documents' },
  '#/adr': { label: 'Decisions', detail: 'Every ADR' },
  '#/load': { label: 'Reading load', detail: 'Minutes per feature' },
};

const starButton = (href) => `<button type="button" class="star" data-star="${esc(href)}">☆</button>`;

/** A document bookmark's label: README.md and INDEX.md say nothing alone, so name them by their folder. */
const docLabel = (p) => (/^(README|INDEX)$/.test(short(p)) ? p.split('/').slice(-2).join('/').replace(/\.md$/, '') : short(p));

/** What a bookmark points at, read from the current index: label, detail, and whether it still exists. */
function describe(href) {
  if (PAGES[href]) return { ...PAGES[href], ok: true };
  const [, kind, arg] = href.match(/^#\/([dfs])\/(.+)$/) ?? href.match(/^\/(raw)\?path=(.+)$/) ?? [];
  const value = arg && decodeURIComponent(arg);
  if (kind === 'd' || kind === 'raw') return { label: docLabel(value), detail: groupOf(value) || value, title: value, ok: S.catalogue.has(value) };
  if (kind === 'f') {
    const f = S.index.features.find((x) => x.id === value);
    return { label: `${value} brief`, detail: f?.title ?? '', ok: !!f };
  }
  if (kind === 's') return { label: `Search “${value}”`, detail: 'Search', ok: true };
  return { label: href, detail: '', ok: false };
}

function markRow(href) {
  const d = describe(href);
  const link = d.ok
    ? `<a href="${esc(href)}"${linkTarget(href)} title="${esc(d.title ?? d.detail)}">${esc(d.label)}</a>`
    : `<span class="gone" title="No longer in the repository">${esc(d.label)}</span>`;
  return `<li>${link}<span class="muted">${esc(d.detail)}</span><button type="button" class="unstar" data-star="${esc(href)}" aria-label="Remove bookmark ${esc(d.label)}" title="Remove bookmark">×</button></li>`;
}

/** The quick-access panel at the head of the library. */
function renderMarks() {
  const box = $('#marks');
  if (!box) return;
  const items = marks.list();
  box.innerHTML = `<b>Bookmarks <span class="muted">${items.length || ''}</span></b>${
    items.length ? `<ul>${items.map(markRow).join('')}</ul>` : '<p class="muted">Star ☆ a page, or a file below, to keep it here. Press <kbd>b</kbd> to jump here.</p>'
  }`;
}

function paintStar(b, on) {
  const yes = on.has(b.dataset.star);
  b.setAttribute('aria-pressed', String(yes));
  b.textContent = yes ? '★' : '☆';
  b.title = yes ? 'Remove bookmark' : 'Bookmark';
}

/** Bring every star, and the bookmark list, in line with storage. */
function syncStars() {
  const on = new Set(marks.list());
  for (const b of document.querySelectorAll('button.star')) paintStar(b, on);
  renderMarks();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('button[data-star]');
  if (!b) return;
  if (marks.toggle(b.dataset.star) === null) toast('Could not save the bookmark: this browser blocks local storage.', true);
  syncStars();
});
marks.onChange(syncStars);

// ── Board ───────────────────────────────────────────────────────────────────────────────────

function stageCell(docs) {
  if (!docs.length) return '<td class="empty">·</td>';
  return `<td>${docs
    .map(
      (d) =>
        `<a class="stagechip" href="${docHref(d.path)}" title="${esc(`${d.title ?? d.path}\n${plain(d.status ?? '')}`)}">${d.version ? `v${esc(d.version)}` : '✓'}<span>${d.lines.toLocaleString()} ln</span></a>`,
    )
    .join('')}</td>`;
}

function boardView() {
  const { features, stages } = S.index;
  const tiles = [
    ['Features', features.length],
    ['Reviewed', features.filter((f) => f.status === 'Reviewed').length],
    ['In progress', features.filter((f) => f.status !== 'Reviewed').length],
    ['Stories found', features.filter((f) => f.story).length],
    ['Lines of SPDD documents', features.reduce((n, f) => n + chainTotal(f, 'lines'), 0).toLocaleString()],
  ];
  const rows = features
    .map(
      (f) => `<tr>
        <td><a href="${featureHref(f.id)}"><b>${f.id}</b></a> <span class="ftitle">${esc(f.title)}</span></td>
        <td><span class="pill ${statusKind(f.status)}">${esc(f.status)}</span></td>
        ${stageCell(f.story ? [f.story] : [])}
        ${stages.map((s) => stageCell(f.stages[s.key])).join('')}
        <td class="num">${chainTotal(f, 'lines').toLocaleString()}</td>
      </tr>`,
    )
    .join('');
  main.innerHTML = `
    <div class="pad">
      <h1>Features</h1>
      <p class="muted">Read live from <code>requirements/</code> and <code>spdd/</code>. A feature is every document whose file name carries the same slug. Click a feature for its brief, a chip for the document.</p>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="tablewrap"><table class="matrix">
        <thead><tr><th>Feature</th><th>Status</th><th>Story</th>${stages
          .map((s) => `<th title="${esc(s.command)}">${esc(s.label)}</th>`)
          .join('')}<th class="num">Lines</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

// ── Feature brief ───────────────────────────────────────────────────────────────────────────

const DIGESTS = [
  { label: 'Decisions', re: /^D-/, open: true },
  { label: 'Open questions', re: /^OQ-/, open: true },
  { label: 'Risks', re: /^RSK-/, open: true },
  { label: 'Review findings', re: /^RF-/, open: true },
  { label: 'Clarifications', re: /^CL-/ },
  { label: 'Business rules', re: /^BR-/ },
  { label: 'Functional requirements', re: /^FR-/ },
  { label: 'Non-functional requirements', re: /^NFR-/ },
  { label: 'Acceptance criteria', re: /^AC-/ },
  { label: 'Constraints and assumptions', re: /^(CON|ASM|A|DEP)-/ },
  { label: 'Canvas operations', re: /^OP-/ },
  { label: 'Tests', re: /^T-/ },
];

function summarise(def) {
  const status = def.fields.find(([k]) => /^(status|state|resolution|disposition|decision status|severity|priority|result)$/i.test(k));
  const body = def.fields.filter((x) => x !== status).slice(0, 2).map(([k, v]) => (k ? `${k}: ${v}` : v)).join(' · ');
  return { status: status?.[1], body: body.length > 260 ? `${body.slice(0, 260)}…` : body };
}

/** The command for the next stage, given the latest document as @<path>. */
const nextCommand = (command, prev) => (prev ? `${command} @${prev}` : command);

async function featureView(id) {
  const f = S.index.features.find((x) => x.id === id);
  if (!f) return notFound(`No feature ${id}`);
  main.innerHTML = '<p class="pad muted">Reading the chain…</p>';
  const { defs } = await featureDefs(f);
  S.defs = defs;
  const steps = featureSteps(f);
  // Next is the stage after the furthest one with a document: public SPDD starts at analysis.
  const reached = steps.findLastIndex((s) => s.docs.length);
  const firstMissing = reached + 1 < steps.length ? reached + 1 : -1;
  const nextCmd = firstMissing < 0 ? null : nextCommand(steps[firstMissing].command, reached >= 0 ? steps[reached].docs.at(-1).path : null);
  const words = steps.reduce((n, s) => n + s.docs.reduce((m, d) => m + (d.words ?? 0), 0), 0);
  const lines = steps.reduce((n, s) => n + s.docs.reduce((m, d) => m + d.lines, 0), 0);

  const timeline = steps
    .map((s, i) => {
      const d = s.docs;
      const body = d.length
        ? d
            .map(
              (x) => `<a class="stepdoc" href="${docHref(x.path)}">
                <div>${x.version ? `<b>v${esc(x.version)}</b> ` : ''}${x.date ? `<span class="muted">${esc(x.date)}</span>` : ''}</div>
                ${x.status ? `<div class="stepstatus">${esc(plain(x.status).slice(0, 140))}</div>` : ''}
                <div class="muted">${x.lines.toLocaleString()} lines · ${minutes(x.words ?? 0)} min</div></a>`,
            )
            .join('')
        : `<div class="muted">${i === firstMissing ? 'Next' : i < reached ? 'Skipped' : 'Not started'}</div>`;
      return `<li class="${d.length ? 'has' : i === firstMissing ? 'next' : ''}"><div class="steplabel">${esc(s.label)}</div><div class="stepcmd">${esc(s.command)}</div>${body}</li>`;
    })
    .join('');

  const digests = DIGESTS.map((g) => {
    const items = [...defs.values()].filter((d) => g.re.test(d.id));
    if (!items.length) return '';
    const rows = items
      .map((d) => {
        const s = summarise(d);
        return `<tr><td><a class="idref" data-id="${d.id}" href="${docHref(d.path, d.anchor)}">${d.id}</a></td><td>${esc(s.body)}</td><td>${s.status ? `<span class="pill">${esc(s.status.slice(0, 60))}</span>` : ''}</td><td class="muted">${esc(stageOf(d.path))}</td></tr>`;
      })
      .join('');
    return `<details class="digest"${g.open ? ' open' : ''}><summary>${g.label} <span class="muted">${items.length}</span></summary><div class="tablewrap"><table><thead><tr><th>ID</th><th>Summary</th><th>Status</th><th>Document</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join('');

  const history = historyList(f);
  main.innerHTML = `
    <div class="pad brief">
      <p class="crumbs"><a href="#/">Board</a> / ${f.id}</p>
      <h1>${f.id} <span class="pill ${statusKind(f.status)}">${esc(f.status)}</span></h1>
      <p class="lede">${esc(f.title)}</p>
      <div class="facts">
        <div><span>Story</span><p>${f.story ? `<a href="${docHref(f.story.path)}">${esc(f.story.path)}</a>` : 'Not found in requirements/'}</p></div>
        <div><span>Reading load</span><p>${lines.toLocaleString()} lines · about ${minutes(words)} min</p></div>
      </div>
      ${nextCmd ? `<div class="next"><span>Next command</span><code>${esc(nextCmd)}</code><button class="copy" data-copy="${esc(nextCmd)}">Copy</button></div>` : ''}
      <h2>Documents</h2>
      <ol class="timeline">${timeline}</ol>
      <h2>Digest</h2>
      <p class="muted">Every ID defined in the first column of a table in this feature's documents, earliest document first. Hover an ID for its definition; click to open it in place.</p>
      ${digests || '<p class="muted">No IDs defined yet.</p>'}
      <h2>History</h2>
      <p class="muted">When each document was first committed, oldest first. “Revised” is the last commit to the document.</p>
      ${history}
    </div>`;
}

/** The feature's documents in commit-date order. */
function historyList(f) {
  const events = [
    ...S.index.stages.flatMap((s) =>
      f.stages[s.key].map((d) => ({
        date: d.created ?? d.date?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
        kind: 'stage',
        label: s.label,
        html: `<a href="${docHref(d.path)}">${esc(short(d.path))}</a>${d.version ? ` <b>v${esc(d.version)}</b>` : ''}${
          d.revised && d.revised !== d.created ? ` <span class="muted">revised ${esc(d.revised)}</span>` : ''
        }${d.created ? '' : ' <span class="muted">not committed</span>'}${d.status ? `<div class="hbody">${esc(plain(d.status).slice(0, 160))}</div>` : ''}`,
      })),
    ),
  ];
  // Undated events sort last; equal dates keep document order.
  const order = events.map((e, i) => ({ e, i })).sort((a, b) => (a.e.date ?? '9').localeCompare(b.e.date ?? '9') || a.i - b.i);
  return `<ol class="history">${order
    .map(({ e }) => `<li class="h-${e.kind}"><time>${esc(e.date ?? 'no date')}</time><div><span class="hkind">${esc(e.label)}</span> ${e.html}</div></li>`)
    .join('')}</ol>`;
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('button.copy');
  if (!b) return;
  await navigator.clipboard?.writeText(b.dataset.copy);
  b.textContent = 'Copied';
  setTimeout(() => (b.textContent = 'Copy'), 1200);
});

// ── Document reader ─────────────────────────────────────────────────────────────────────────

async function docView(p, anchor, q) {
  if (!S.catalogue.has(p)) return notFound(`Not in the viewer's catalogue: ${p}`);
  main.innerHTML = '<p class="pad muted">Reading…</p>';
  const fid = S.docFeature.get(p);
  const f = fid && S.index.features.find((x) => x.id === fid);
  let d;
  if (f) {
    const r = await featureDefs(f);
    S.defs = r.defs;
    d = docCache.get(p);
  } else {
    d = await getDoc(p);
    S.defs = extractDefs(d.text, p);
  }
  const words = d.text.split(/\s+/).length;
  const lines = d.text.split('\n').length;
  const group = groupOf(p);
  const isYaml = /\.ya?ml$/.test(p);
  const r = isYaml ? { html: `<pre class="yaml"><code>${esc(d.text)}</code></pre>`, headings: [] } : render(d.text, { linkId, linkPath: (x) => linkPath(x, p) });

  const tabs = f
    ? `<nav class="tabs"><a href="${featureHref(f.id)}">${f.id} brief</a>${featureSteps(f)
        .map((s) =>
          s.docs.length
            ? s.docs.map((x) => `<a href="${docHref(x.path)}" class="${x.path === p ? 'on' : ''}">${esc(s.label)}</a>`).join('')
            : `<span class="off">${esc(s.label)}</span>`,
        )
        .join('')}</nav>`
    : '';
  const outline = r.headings
    .filter((h) => h.level >= 2 && h.level <= 3)
    .map((h) => `<a href="${docHref(p, h.id)}" class="l${h.level}">${esc(h.text)}${h.lines ? `<span>${h.lines}</span>` : ''}</a>`)
    .join('');
  main.innerHTML = `
    <div class="reader">
      <div class="readhead">
        <p class="crumbs">${esc(group)} / <span title="${esc(p)}">${esc(p)}</span></p>
        ${tabs}
        <div class="meta"><span>${lines.toLocaleString()} lines · about ${minutes(words)} min · changed ${new Date(d.modified).toLocaleString()}</span>
          <span class="actions">${r.headings.some((h) => h.level === 2) ? '<button id="fold">Collapse all</button>' : ''}<a href="${vscodeHref(p)}">Open in VS Code</a><a href="/raw?path=${encodeURIComponent(p)}" target="_blank">Raw</a></span></div>
      </div>
      <div class="readgrid">
        ${outline ? `<nav class="outline"><b>Sections <span class="muted">(lines)</span></b>${outline}</nav>` : ''}
        <article class="md">${r.html}</article>
      </div>
    </div>`;
  const fold = $('#fold');
  fold?.addEventListener('click', () => {
    const all = main.querySelectorAll('details.sec');
    const close = fold.textContent.startsWith('Collapse');
    all.forEach((x) => (x.open = !close));
    fold.textContent = close ? 'Expand all' : 'Collapse all';
  });
  await drawMermaid($('.md'));
  if (q) highlight($('.md'), q);
  if (anchor) reveal(document.getElementById(anchor));
  else if (q) reveal($('.md mark'));
  else window.scrollTo(0, 0);
}

// ── Mermaid ─────────────────────────────────────────────────────────────────────────────────

let mermaidLoad;
/** Load Mermaid once (served from node_modules/mermaid by the server). */
function loadMermaid() {
  mermaidLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/mermaid.js';
    s.onload = () => {
      const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' });
      resolve(window.mermaid);
    };
    s.onerror = () => reject(new Error('Mermaid did not load: run npm install'));
    document.head.append(s);
  });
  return mermaidLoad;
}

let diagramSeq = 0;
/** Diagrams with at least this many nodes get the focus bar (flowfilter.js). */
const FOCUS_MIN_NODES = 10;

/** Draw every Mermaid figure under root. A diagram that fails keeps its source open, with the error. */
async function drawMermaid(root) {
  const figs = [...root.querySelectorAll('figure.mermaid')];
  if (!figs.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (e) {
    for (const f of figs) f.querySelector('.mermaid-svg').innerHTML = `<p class="muted">${esc(e.message)}. Showing the source.</p>`;
    return;
  }
  for (const f of figs) {
    const src = f.querySelector('.mermaid-src').textContent;
    if (!(await drawSvg(mermaid, f, src))) continue;
    const graph = parseDiagram(src);
    if (graph && graph.nodes.size >= FOCUS_MIN_NODES) addFocusBar(mermaid, f, graph, src);
  }
}

async function drawSvg(mermaid, f, src) {
  try {
    const { svg } = await mermaid.render(`mmd-${++diagramSeq}`, src);
    f.querySelector('.mermaid-svg').innerHTML = svg;
    return true;
  } catch (e) {
    f.querySelector('.mermaid-svg').innerHTML = `<p class="muted">Mermaid could not draw this diagram: ${esc(String(e?.message ?? e).split('\n')[0])}</p>`;
    f.querySelector('details').open = true;
    return false;
  }
}

/**
 * Search box, hop count and class toggles above a large diagram. Picking a node, by search or by
 * clicking it, redraws the diagram with only that node and the nodes within the chosen hops.
 */
function addFocusBar(mermaid, f, graph, full) {
  const n = ++diagramSeq;
  const nodes = [...graph.nodes.values()];
  const classes = [...new Set(nodes.map((x) => x.cls).filter(Boolean))];
  const st = { focus: null, depth: 1, hidden: new Set() };
  const bar = document.createElement('div');
  bar.className = 'dfocus';
  bar.innerHTML = `
    <input type="search" list="dfl-${n}" placeholder="Focus on a node…" aria-label="Focus the diagram on a node">
    <datalist id="dfl-${n}">${nodes.map((x) => `<option value="${esc(x.label)}">`).join('')}</datalist>
    <select aria-label="How far from the focused node">${[1, 2, 3].map((d) => `<option value="${d}">${d} hop${d > 1 ? 's' : ''}</option>`).join('')}</select>
    <button type="button">Show all</button>
    ${classes.length > 1 ? `<span class="dclasses">${classes.map((c) => `<label><input type="checkbox" value="${esc(c)}" checked> ${esc(c)}</label>`).join('')}</span>` : ''}
    <span class="dcaption muted"></span>`;
  f.classList.add('focusable');
  f.insertBefore(bar, f.querySelector('.mermaid-svg'));
  const [input, depth, reset] = [$('input[type=search]', bar), $('select', bar), $('button', bar)];

  const find = (text) => {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const hit = nodes.find((x) => x.label.toLowerCase() === t || x.id.toLowerCase() === t) ?? nodes.find((x) => x.label.toLowerCase().includes(t));
    return hit?.id ?? null;
  };
  /** The model node behind an SVG node: Mermaid ids end in "-<node id>-<n>", or carry data-id. */
  const nodeOf = (g) => {
    const attr = g.getAttribute('data-id') ?? '';
    if (graph.nodes.has(attr)) return attr;
    const keys = [...graph.nodes.keys()].filter((k) => new RegExp(`(^|-)${k}-\\d+$`).test(g.id));
    return keys.sort((a, b) => b.length - a.length)[0] ?? null;
  };
  const pick = (k) => {
    st.focus = k;
    input.value = graph.nodes.get(k).label;
    update();
  };

  async function update() {
    const near = st.focus ? neighbourhood(graph, [st.focus], st.depth) : new Set(graph.nodes.keys());
    const keep = new Set([...near].filter((k) => k === st.focus || !st.hidden.has(graph.nodes.get(k).cls)));
    const filtered = keep.size < graph.nodes.size;
    if (!(await drawSvg(mermaid, f, filtered ? focusSource(graph, keep) : full))) return;
    const label = st.focus && graph.nodes.get(st.focus).label;
    const hops = `${st.depth} hop${st.depth > 1 ? 's' : ''}`;
    $('.dcaption', bar).textContent = filtered
      ? `Showing ${keep.size} of ${graph.nodes.size} nodes${label ? `: ${label} and everything within ${hops}` : ''}.`
      : 'Click a node, or search, to show only it and its neighbours.';
    for (const g of f.querySelectorAll('.mermaid-svg g.node')) {
      const k = nodeOf(g);
      if (!k) continue;
      g.classList.toggle('focused', k === st.focus);
      g.addEventListener('click', () => pick(k));
    }
  }

  // Picking from the suggestions focuses at once; Enter or leaving the box takes the closest match.
  input.addEventListener('input', () => {
    const hit = nodes.find((x) => x.label === input.value);
    if (hit && hit.id !== st.focus) pick(hit.id);
  });
  input.addEventListener('change', () => {
    const k = find(input.value);
    if (k && k !== st.focus) pick(k);
    else if (!k && input.value.trim()) toast(`No node in this diagram matches "${input.value}"`, true);
  });
  depth.addEventListener('change', () => {
    st.depth = Number(depth.value);
    if (st.focus) update();
  });
  reset.addEventListener('click', () => {
    st.focus = null;
    input.value = '';
    update();
  });
  bar.addEventListener('change', (e) => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) st.hidden.delete(e.target.value);
    else st.hidden.add(e.target.value);
    update();
  });
  update();
}

function reveal(el) {
  if (!el) return;
  for (let x = el.parentElement; x; x = x.parentElement) if (x.tagName === 'DETAILS') x.open = true;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1800);
}

function highlight(root, q) {
  const needle = q.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walker.nextNode() && hits.length < 300) if (walker.currentNode.nodeValue.toLowerCase().includes(needle)) hits.push(walker.currentNode);
  for (const node of hits) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let i = 0;
    for (let k = text.toLowerCase().indexOf(needle); k >= 0; k = text.toLowerCase().indexOf(needle, i)) {
      frag.append(text.slice(i, k));
      const m = document.createElement('mark');
      m.textContent = text.slice(k, k + q.length);
      frag.append(m);
      i = k + q.length;
    }
    frag.append(text.slice(i));
    node.replaceWith(frag);
  }
}

// ── Search, decisions, reading load ─────────────────────────────────────────────────────────

async function searchView(q) {
  $('#q').value = q;
  main.innerHTML = '<p class="pad muted">Searching…</p>';
  const hits = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
  const mark = (t) => esc(t).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  main.innerHTML = `<div class="pad"><h1>“${esc(q)}”</h1><p class="muted">${hits.length} documents${hits.length === 80 ? ' (first 80)' : ''}, most matches first.</p>
    ${hits
      .map(
        (h) => `<div class="hit"><a href="${docHref(h.path, null, q)}"><b>${esc(short(h.path))}</b></a> <span class="muted">${esc(h.group)} · ${h.count} matches · ${esc(h.path)}</span>
        ${h.lines.map((l) => `<div class="hitline"><span class="muted">${l.line}</span> ${mark(plain(l.text))}</div>`).join('')}</div>`,
      )
      .join('')}</div>`;
}

function adrView() {
  const rows = S.index.adrs
    .map((a) => `<tr><td><a href="${docHref(a.path)}">${esc(a.id)}</a></td><td>${esc(a.title)}</td><td><span class="pill">${esc(plain(a.status))}</span></td></tr>`)
    .join('');
  main.innerHTML = `<div class="pad"><h1>Architecture decisions</h1><p class="muted">ADRs in <code>docs/adr/</code>.</p>
    <div class="tablewrap"><table><thead><tr><th>ID</th><th>Decision</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function loadView() {
  const { features, stages, groups } = S.index;
  const perFeature = features.map((f) => {
    const cells = featureSteps(f).map((s) => sumOf(s.docs, 'words'));
    return { f, cells, total: cells.reduce((a, b) => a + b, 0) };
  });
  const max = Math.max(...perFeature.map((x) => x.total), 1);
  const rows = perFeature
    .map(
      ({ f, cells, total }) => `<tr><td><a href="${featureHref(f.id)}">${f.id}</a></td>${cells
        .map((w) => `<td class="num">${w ? `${minutes(w)}` : '<span class="muted">·</span>'}</td>`)
        .join('')}<td class="num"><b>${minutes(total)}</b></td><td class="barcell"><div class="bar" style="width:${(100 * total) / max}%"></div></td></tr>`,
    )
    .join('');
  const grows = groups
    .map((g) => {
      const lines = g.files.reduce((n, x) => n + (x.lines ?? 0), 0);
      return `<tr><td>${esc(g.name)}</td><td class="num">${g.files.length}</td><td class="num">${lines.toLocaleString()}</td></tr>`;
    })
    .join('');
  main.innerHTML = `<div class="pad"><h1>Reading load</h1>
    <p class="muted">Minutes to read each feature's documents at ${WPM} words a minute. Use it to see where a human reader's time goes, and which stages a summary would save most.</p>
    <div class="tablewrap"><table><thead><tr><th>Feature</th><th class="num">Story</th>${stages.map((s) => `<th class="num">${esc(s.label)}</th>`).join('')}<th class="num">Total min</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <h2>Every document group</h2>
    <div class="tablewrap"><table><thead><tr><th>Group</th><th class="num">Files</th><th class="num">Lines</th></tr></thead><tbody>${grows}</tbody></table></div></div>`;
}

function notFound(msg) {
  main.innerHTML = `<div class="pad"><h1>Not found</h1><p>${esc(msg)}</p><p><a href="#/">Back to the board</a></p></div>`;
}

// ── Router ──────────────────────────────────────────────────────────────────────────────────

async function route() {
  pop.hidden = true;
  // Before rendering: a slow page (Mermaid) must not leave the star pointing at the last one.
  const star = $('#star');
  star.dataset.star = marks.hrefOf(location.hash);
  paintStar(star, new Set(marks.list()));
  const h = location.hash.replace(/^#/, '') || '/';
  const [pathPart, qs] = h.split('?');
  const params = new URLSearchParams(qs ?? '');
  for (const a of document.querySelectorAll('[data-nav]')) a.classList.toggle('on', (pathPart === '/' && a.dataset.nav === 'board') || pathPart === `/${a.dataset.nav}`);
  try {
    if (pathPart === '/') boardView();
    else if (pathPart.startsWith('/f/')) await featureView(pathPart.slice(3));
    else if (pathPart.startsWith('/d/')) await docView(decodeURIComponent(pathPart.slice(3)), params.get('a'), params.get('q'));
    else if (pathPart.startsWith('/s/')) await searchView(decodeURIComponent(pathPart.slice(3)));
    else if (pathPart === '/adr') adrView();
    else if (pathPart === '/load') loadView();
    else notFound(h);
  } catch (e) {
    main.innerHTML = `<div class="pad"><h1>Could not show this page</h1><pre>${esc(String(e?.stack ?? e))}</pre></div>`;
  }
  for (const a of document.querySelectorAll('#lib a')) a.classList.toggle('current', a.getAttribute('href') === `#/d/${pathPart.slice(3)}`);
}

$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (q.length >= 2) location.hash = `#/s/${encodeURIComponent(q)}`;
});
document.addEventListener('keydown', (e) => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    $('#q').focus();
  } else if (e.key === 'b') {
    // Quick access: open the library on narrow screens and focus the first bookmark.
    document.body.classList.add('libopen');
    $('#marks').scrollIntoView({ block: 'nearest' });
    $('#marks a')?.focus();
  }
});
$('#toggleLib').addEventListener('click', () => document.body.classList.toggle('libopen'));
/** ↻ re-reads the folder. */
$('#reload').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  docCache.clear();
  await loadIndex();
  await route();
  btn.disabled = false;
  toast('Documents re-read');
});

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = `toast${isError ? ' err' : ''}`;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), isError ? 12000 : 2500);
}
window.addEventListener('hashchange', () => {
  document.body.classList.remove('libopen');
  route();
});

await loadIndex();
route();
