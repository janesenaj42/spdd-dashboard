/**
 * SPDD Dashboard: a local, read-only web app for reading a repository's SPDD documents together.
 * SPDD is Structured-Prompt-Driven Development (gszhangwei/open-spdd): /spdd-analysis writes an
 * analysis to spdd/analysis/, /spdd-reasons-canvas a REASONS Canvas to spdd/prompt/, and
 * /spdd-code-review a review to spdd/review/, all for a user story in requirements/.
 *
 *   spdd-dashboard [folder]            http://127.0.0.1:4400, reading folder (default: the current one)
 *   spdd-dashboard [folder] --check    print the features and unmatched documents, then exit
 *   PORT=4500 spdd-dashboard           another port
 *
 * A feature is every document whose file name carries the same slug (src/names.mjs).
 * Reads the folder on every request, so it always shows the working tree. Only files in the
 * catalogue below are served; nothing else in the folder is reachable. It writes nothing.
 *
 * Mermaid diagrams are drawn in the browser by the mermaid package in node_modules (no CDN).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { sameFeature, slugFiles, STAGE_FILE } from './names.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The folder to read: the first argument that is not a flag, else the current folder. */
const ROOT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.');
const PUBLIC = path.join(HERE, '..', 'public');
const PORT = Number(process.env.PORT ?? 4400);
const MERMAID = createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.gradle', 'coverage', 'test-results', 'playwright-report']);

const abs = (p) => path.join(ROOT, ...p.split('/'));
const exists = (p) => fs.existsSync(abs(p));
const read = (p) => fs.readFileSync(abs(p), 'utf8').replace(/\r\n/g, '\n');
const ls = (dir, re = /\.md$/) => (exists(dir) ? fs.readdirSync(abs(dir)).filter((n) => re.test(n)).sort().map((n) => `${dir}/${n}`) : []);

/** Every file named `name` under `dir`, skipping build output and dependencies. */
function find(dir, name, depth = 4) {
  const out = [];
  const walk = (d, n) => {
    for (const e of fs.readdirSync(abs(d), { withFileTypes: true })) {
      const p = d === '.' ? e.name : `${d}/${e.name}`;
      if (e.isDirectory() && n < depth && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(p, n + 1);
      else if (e.isFile() && e.name === name) out.push(p);
    }
  };
  walk(dir, 0);
  return out.sort();
}

// ── Catalogue: which files the viewer shows, grouped as the pipeline uses them ─────────────

/**
 * The SPDD documents, in the order the commands write them. `dir` holds one file per feature and
 * command run. `reached` is a feature's status when this is the furthest folder with its document.
 */
const STAGES = [
  { key: 'analysis', label: 'Analysis', dir: 'spdd/analysis', command: '/spdd-analysis', reached: 'Analysed' },
  { key: 'canvas', label: 'REASONS Canvas', dir: 'spdd/prompt', command: '/spdd-reasons-canvas', reached: 'Canvas written' },
  { key: 'review', label: 'Review', dir: 'spdd/review', command: '/spdd-code-review', reached: 'Reviewed' },
];
/** User stories: the input /spdd-analysis reads. Any file name. */
const STORIES = 'requirements';

function catalogue() {
  const groups = [
    { name: 'Stories', files: ls(STORIES) },
    ...STAGES.map((s) => ({ name: s.label, files: ls(s.dir) })),
    { name: 'Decisions (ADR)', files: ls('docs/adr') },
    {
      name: 'Instructions',
      files: [...find('.', 'CLAUDE.md'), ...find('.', 'AGENTS.md'), ...ls('.claude/commands'), ...ls('.cursor/commands'), 'spdd/README.md'].filter(exists),
    },
    {
      name: 'Other docs',
      files: [...ls('docs'), ...find('.', 'README.md', 3)].filter((p) => exists(p) && !p.startsWith('spdd/')),
    },
  ];
  for (const g of groups) g.files = [...new Set(g.files)].map((p) => ({ path: p, lines: lineCount(p) }));
  return groups.filter((g) => g.files.length);
}

const lineCount = (p) => (p.endsWith('.html') ? null : read(p).split('\n').length);

/** The `| Key | Value |` rows of a document's first two-column table, if it has one. */
function control(text) {
  const out = {};
  const m = text.match(/^\|[^\n]*\|\s*\n\|\s*-{3,}\s*\|\s*-{3,}\s*\|\s*\n((?:\|[^\n]*\|\s*\n?)+)/m);
  if (!m) return out;
  for (const row of m[1].trim().split('\n')) {
    const cells = row.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.length >= 2 && cells[0]) out[cells[0].replace(/\*\*/g, '')] = cells[1];
  }
  return out;
}

/** Git output only: a folder that is not a repository makes git print "fatal" to stderr. */
const QUIET = ['ignore', 'pipe', 'ignore'];
const GIT_MAX_BUFFER = 32 << 20;
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER, stdio: QUIET });
const isoDate = (s) => s?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
let commitDates = { head: null, files: new Map() };

/** First and last commit date of every file under spdd/, read once per HEAD; {} for uncommitted files. */
function fileDates() {
  try {
    const head = git(['rev-parse', 'HEAD']).trim();
    if (commitDates.head === head) return commitDates.files;
    const files = new Map();
    const out = git(['log', '--no-merges', '--relative', '--format=%x1e%as', '--name-only', '--', 'spdd']);
    // The log runs newest first: the first date seen is the last commit, the final one the first.
    for (const rec of out.split('\x1e').slice(1)) {
      const [date, ...paths] = rec.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const p of paths) files.set(p, { first: date, last: files.get(p)?.last ?? date });
    }
    commitDates = { head, files };
    return files;
  } catch {
    return new Map();
  }
}

/** One SPDD document with the fields of its first two-column table. */
function stageDoc(p, dates) {
  const t = read(p);
  const c = control(t);
  const pick = (...keys) => keys.map((k) => c[k]).find(Boolean) ?? null;
  return {
    path: p,
    lines: t.split('\n').length,
    words: t.split(/\s+/).length,
    title: t.match(/^# (.+)$/m)?.[1] ?? p,
    version: pick('Version'),
    status: pick('Status'),
    date: pick('Date'),
    created: dates.get(p)?.first ?? null,
    revised: dates.get(p)?.last ?? null,
  };
}

/** Every stage folder listed once: { analysis: [paths], canvas: [...], review: [...] }. */
const stageFolders = () => Object.fromEntries(STAGES.map((s) => [s.key, ls(s.dir)]));

/** { analysis: [], canvas: [], review: [] } to collect paths into. */
const emptyStages = () => Object.fromEntries(STAGES.map((s) => [s.key, []]));

/** { stageKey: [doc] } for the given paths per stage. */
const stageDocs = (filesByStage, dates) => Object.fromEntries(STAGES.map((s) => [s.key, filesByStage[s.key].map((p) => stageDoc(p, dates))]));

/** The furthest stage with a document. */
const furthest = (stages) => STAGES.findLast((s) => stages[s.key].length);

/** Every path of a feature: its story, if found, and each SPDD document. */
const docPaths = (f) => [f.story?.path, ...Object.values(f.stages).flat().map((d) => d.path)].filter(Boolean);

/** Group every stage document by slug, earliest stage first, so the first document seen names the feature. */
function chainGroups(folders) {
  const groups = [];
  for (const s of STAGES)
    for (const p of folders[s.key]) {
      const m = path.basename(p).match(STAGE_FILE);
      if (!m) continue;
      // A ticket key (GGQPA-169) names one feature; a bare prefix (ABC) needs its date too.
      const [, prefix, date, slug] = m;
      let g = groups.find((x) => sameFeature(x.slug, slug));
      if (!g) groups.push((g = { key: /\d/.test(prefix) ? prefix : `${prefix}-${date}`, slug, first: p, files: emptyStages() }));
      g.files[s.key].push(p);
    }
  return groups;
}

/** Lower-case letters and digits only, to compare a title with a file name. */
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The user story of a feature: a requirements/ file its documents cite by path, else one whose
 * file name or first heading contains the feature's title. Null when neither matches.
 */
function storyOf(stages, title, stories) {
  const texts = Object.values(stages).flat().map((d) => read(d.path));
  const heading = (p) => read(p).match(/^# (.+)$/m)?.[1] ?? '';
  const p =
    stories.find((s) => texts.some((t) => t.includes(s))) ??
    stories.find((s) => [path.basename(s), heading(s)].some((x) => squash(x).includes(squash(title))));
  if (!p) return null;
  const t = read(p);
  return { path: p, lines: t.split('\n').length, words: t.split(/\s+/).length };
}

/**
 * One feature per slug found across the stage folders. Its ID is the first document's ticket key,
 * or prefix and date when the key has no digit, with -2, -3… when several share it.
 */
function features() {
  const dates = fileDates();
  const stories = ls(STORIES);
  const seen = new Map();
  return chainGroups(stageFolders()).map(({ key, slug, first, files }) => {
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const text = read(first);
    const stages = stageDocs(files, dates);
    const title = control(text).Title ?? text.match(/^# (?:[^:—]+[:—]\s*)?(.+)$/m)?.[1] ?? slug;
    return {
      id: seen.get(key) > 1 ? `${key}-${seen.get(key)}` : key,
      title,
      status: furthest(stages).reached,
      story: storyOf(stages, title, stories),
      born: dates.get(first)?.first ?? null,
      stages,
    };
  });
}

function adrs() {
  return ls('docs/adr', /^\d{4}-.*\.md$/).map((p) => {
    const t = read(p);
    return {
      path: p,
      id: `ADR-${path.basename(p).slice(0, 4)}`,
      status: t.match(/^status:\s*(.+)$/m)?.[1] ?? '',
      title: t.match(/^# (.+)$/m)?.[1] ?? p,
    };
  });
}

/** Files git knows (tracked or untracked, not ignored), so the viewer links only paths that exist. */
function trackedFiles() {
  try {
    return git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ── Search ──────────────────────────────────────────────────────────────────────────────────

function search(q, groups) {
  const needle = q.toLowerCase();
  const hits = [];
  for (const g of groups)
    for (const f of g.files) {
      if (f.path.endsWith('.html')) continue;
      const lines = read(f.path).split('\n');
      const found = [];
      lines.forEach((l, i) => {
        if (l.toLowerCase().includes(needle)) found.push({ line: i + 1, text: l.slice(0, 240) });
      });
      if (found.length) hits.push({ path: f.path, group: g.name, count: found.length, lines: found.slice(0, 5) });
    }
  return hits.sort((a, b) => b.count - a.count).slice(0, 80);
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function allowed(p, groups) {
  return groups.some((g) => g.files.some((f) => f.path === p));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/index') {
      const groups = catalogue();
      return send(res, 200, {
        root: path.basename(ROOT),
        rootAbs: ROOT.replace(/\\/g, '/'),
        stages: STAGES,
        features: features(),
        adrs: adrs(),
        groups,
        tracked: trackedFiles(),
      });
    }
    if (url.pathname === '/api/doc' || url.pathname === '/raw') {
      const p = url.searchParams.get('path') ?? '';
      if (!allowed(p, catalogue())) return send(res, 404, { error: `not in the viewer's catalogue: ${p}` });
      if (url.pathname === '/raw') return send(res, 200, read(p), TYPES[path.extname(p)] ?? 'text/plain');
      const stat = fs.statSync(abs(p));
      return send(res, 200, { path: p, text: read(p), modified: stat.mtime.toISOString() });
    }
    if (url.pathname === '/vendor/mermaid.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(MERMAID).pipe(res);
    }
    if (url.pathname === '/api/search') {
      const q = (url.searchParams.get('q') ?? '').trim();
      return send(res, 200, q.length < 2 ? [] : search(q, catalogue()));
    }
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(PUBLIC, file);
    if (!full.startsWith(PUBLIC) || !fs.existsSync(full)) return send(res, 404, 'Not found', 'text/plain');
    return send(res, 200, fs.readFileSync(full, 'utf8'), TYPES[path.extname(full)] ?? 'text/plain');
  } catch (e) {
    return send(res, 500, { error: String(e?.message ?? e) });
  }
});

/** Column widths of the --check report. */
const ID_WIDTH = 24;
const GROUP_WIDTH = 18;

/** --check: what the dashboard would show for ROOT, and every SPDD document no feature claims. */
function checkReport() {
  const feats = features();
  const claimed = new Set(feats.flatMap(docPaths));
  const out = [`Folder: ${ROOT}`, `Features: ${feats.length}`, ''];
  for (const f of feats) out.push(`  ${f.id.padEnd(ID_WIDTH)} ${f.status.padEnd(ID_WIDTH)} ${[f.story ? 'Story' : '·', ...STAGES.map((s) => (f.stages[s.key].length ? s.label : '·'))].join(' | ')}`);
  out.push('', 'SPDD documents whose file name gives no slug (<KEY>-<date>-[<Tag>]-<slug>.md):');
  const orphans = STAGES.flatMap((s) => ls(s.dir)).filter((p) => !claimed.has(p));
  out.push(...(orphans.length ? orphans.map((p) => `  ${p}`) : ['  None']), '', 'Library groups:');
  for (const g of catalogue()) out.push(`  ${g.name.padEnd(GROUP_WIDTH)} ${g.files.length} files`);
  return out.join('\n');
}

if (process.argv.includes('--check')) {
  console.log(checkReport());
  process.exit(0);
}
if (!fs.existsSync(path.join(ROOT, 'spdd'))) console.warn(`No spdd/ folder in ${ROOT}: the board will be empty.`);
server.listen(PORT, '127.0.0.1', () => console.log(`SPDD Dashboard: http://127.0.0.1:${PORT}  reading ${ROOT}  (Ctrl+C to stop)`));
