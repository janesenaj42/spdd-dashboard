/**
 * Markdown to HTML for the SPDD viewer, plus the ID definitions the pipeline's tables declare.
 * Covers what the repository's documents use: front-matter, headings, GFM tables, lists, fences,
 * blockquotes, code spans, links, bold and italic. No dependency, so the viewer runs offline.
 * A ```mermaid fence becomes <figure class="mermaid"> with its source; app.js draws it.
 *
 * An "ID" is a pipeline identifier such as FR-004, RSK-A10, D-A3a, OWASP-SC-15 or OP-2. A table
 * row whose first cell is an ID defines that ID; render() links every later mention to it.
 */

export const ID_RE = /\b(?:[A-Z][A-Z0-9]{0,9}-)+[A-Z]{0,4}\d+[a-z]?\b/g;
const ID_AT_START = /^((?:[A-Z][A-Z0-9]{0,9}-)+[A-Z]{0,4}\d+[a-z]?)\b/;

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (s) =>
  s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[`*_[\]()]/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';

/** Markdown inline text to plain text, for summaries and popovers. */
export const plain = (s) =>
  s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\\\|/g, '|')
    .trim();

/** Split a table row on `|`, ignoring escaped pipes and pipes inside code spans. */
export function cells(row) {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out = [];
  let cur = '';
  let tick = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      tick = tick === 0 ? n : tick === n ? 0 : tick;
      cur += '`'.repeat(n);
      i += n - 1;
    } else if (c === '|' && tick === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l) && l.includes('-');
const isTableStart = (lines, i) => /^\s*\|/.test(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]);
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;

function splitFrontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return { meta: null, body: text, offset: 0 };
  const meta = m[1].split('\n').map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]);
  return { meta, body: text.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

// ── Definitions ─────────────────────────────────────────────────────────────────────────────

/** Map of ID → { id, path, anchor, fields: [[header, value], …] } from table rows and headings. */
export function extractDefs(text, path) {
  const defs = new Map();
  const lines = splitFrontMatter(text.replace(/\r\n/g, '\n')).body.split('\n');
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{2,4})\s+(.*)$/);
    if (h) {
      section = plain(h[2]);
      const m = plain(h[2]).match(ID_AT_START);
      if (m && !defs.has(m[1])) defs.set(m[1], { id: m[1], path, section, anchor: `id-${m[1]}`, fields: [['', plain(h[2])]] });
      continue;
    }
    if (!isTableStart(lines, i)) continue;
    const head = cells(lines[i]).map(plain);
    i += 2;
    for (; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
      const row = cells(lines[i]);
      const m = plain(row[0] ?? '').match(ID_AT_START);
      if (!m || defs.has(m[1])) continue;
      const fields = row.slice(1).map((c, k) => [head[k + 1] ?? '', plain(c)]).filter(([, v]) => v);
      defs.set(m[1], { id: m[1], path, section, anchor: `id-${m[1]}`, fields });
    }
    i--;
  }
  return defs;
}

// ── Inline ──────────────────────────────────────────────────────────────────────────────────

function inline(src, ctx) {
  const holds = [];
  const hold = (html) => `\u0001${holds.push(html) - 1}\u0002`;
  let s = src;

  s = s.replace(/(`+)([\s\S]*?[^`]|[^`])\1(?!`)/g, (_, _t, code) => {
    const c = code.trim();
    const href = ctx.linkPath?.(c.replace(/^@/, '').replace(/^input=/, ''));
    return hold(href ? `<a class="pathref" href="${href}"><code>${esc(c)}</code></a>` : `<code>${esc(c)}</code>`);
  });
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt) => hold(`<span class="muted">[image: ${esc(alt)}]</span>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
    const local = /^[a-z]+:/i.test(url) ? null : ctx.linkPath?.(url);
    const href = local ?? (/^https?:/i.test(url) ? url : null);
    const inner = inline(label, { ...ctx, linkId: null });
    if (!href) return hold(`<span class="deadlink" title="${esc(url)}">${inner}</span>`);
    return hold(`<a href="${esc(href)}"${local ? '' : ' target="_blank" rel="noreferrer"'}>${inner}</a>`);
  });
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => hold(`<a href="${esc(u)}" target="_blank" rel="noreferrer">${esc(u)}</a>`));
  s = s.replace(/<br\s*\/?>/gi, () => hold('<br>'));

  s = esc(s);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?![\w])/g, '$1<em>$2</em>');
  if (ctx.linkId)
    s = s.replace(ID_RE, (id) => {
      const href = ctx.linkId(id);
      return href ? `<a class="idref" data-id="${id}" href="${href}">${id}</a>` : id;
    });

  for (let k = 0; k < 4 && s.includes('\u0001'); k++) s = s.replace(/\u0001(\d+)\u0002/g, (_, n) => holds[Number(n)]);
  return s;
}

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────

/**
 * render(text, ctx) → { html, headings, meta }
 * ctx.linkId(id) → href or null; ctx.linkPath(path) → href or null.
 * Each H2 opens a collapsible <details class="sec"> that ends at the next H2.
 */
export function render(text, ctx = {}) {
  const { meta, body, offset } = splitFrontMatter(text.replace(/\r\n/g, '\n'));
  const lines = body.split('\n');
  const headings = [];
  const used = new Map();
  const anchor = (t) => {
    const b = slug(t);
    const n = used.get(b) ?? 0;
    used.set(b, n + 1);
    return n ? `${b}-${n}` : b;
  };

  const h2Lines = [];
  let fenced = false;
  lines.forEach((l, i) => {
    if (FENCE.test(l)) fenced = !fenced;
    else if (!fenced && /^##\s/.test(l)) h2Lines.push(i);
  });
  const out = [];
  let open = false;

  const blocks = (ls, base, top) => {
    const html = [];
    let i = 0;
    while (i < ls.length) {
      const line = ls[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      if (/^\s*<!--/.test(line)) {
        while (i < ls.length && !ls[i].includes('-->')) i++;
        i++;
        continue;
      }
      const fence = line.match(FENCE);
      if (fence) {
        const mark = fence[1];
        const body = [];
        i++;
        while (i < ls.length && !ls[i].trim().startsWith(mark)) body.push(ls[i++]);
        i++;
        const code = esc(body.join('\n'));
        if (fence[2] === 'mermaid')
          html.push(`<figure class="mermaid"><div class="mermaid-svg"></div><details><summary>Diagram source (${body.length} lines)</summary><pre><code class="mermaid-src">${code}</code></pre></details></figure>`);
        else html.push(`<pre><code${fence[2] ? ` class="lang-${fence[2]}"` : ''}>${code}</code></pre>`);
        continue;
      }
      const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) {
        const level = h[1].length;
        const text = h[2];
        const idm = plain(text).match(ID_AT_START);
        const id = idm ? `id-${idm[1]}` : anchor(plain(text));
        if (top) {
          const lineNo = base + i + 1 + offset;
          const next = level === 2 ? h2Lines.find((x) => x > base + i) ?? lines.length : null;
          headings.push({ level, text: plain(text), id, line: lineNo, lines: next === null ? null : next - (base + i) });
          if (level === 2) {
            if (open) html.push('</div></details>');
            html.push(`<details class="sec" open><summary><h2 id="${id}">${inline(text, ctx)}</h2><span class="seclines">${next - (base + i)} lines</span></summary><div class="secbody">`);
            open = true;
            i++;
            continue;
          }
        }
        html.push(`<h${level} id="${id}">${inline(text, ctx)}</h${level}>`);
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push('<hr>');
        i++;
        continue;
      }
      if (isTableStart(ls, i)) {
        const head = cells(ls[i]);
        const align = cells(ls[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : ''));
        i += 2;
        const rows = [];
        while (i < ls.length && /^\s*\|/.test(ls[i])) rows.push(cells(ls[i++]));
        const td = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c, ctx)}</${tag}>`;
        const tr = (r) => {
          const m = plain(r[0] ?? '').match(ID_AT_START);
          return `<tr${m ? ` id="id-${m[1]}"` : ''}>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`;
        };
        html.push(`<div class="tablewrap"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*>/.test(line)) {
        const q = [];
        while (i < ls.length && /^\s*>/.test(ls[i])) q.push(ls[i++].replace(/^\s*>\s?/, ''));
        html.push(`<blockquote>${blocks(q, 0, false)}</blockquote>`);
        continue;
      }
      if (LIST.test(line)) {
        const items = [];
        while (i < ls.length) {
          const l = ls[i];
          const m = l.match(LIST);
          if (m) items.push({ indent: m[1].length, ordered: /\d/.test(m[2]), start: parseInt(m[2], 10), lines: [m[3]] });
          else if (l.trim() && /^\s+/.test(l) && items.length) items[items.length - 1].lines.push(l.trim());
          else if (!l.trim() && i + 1 < ls.length && (LIST.test(ls[i + 1]) || /^\s{2,}\S/.test(ls[i + 1]))) {
            /* blank line inside a list */
          } else break;
          i++;
        }
        html.push(list(items, ctx));
        continue;
      }
      const para = [];
      while (
        i < ls.length &&
        ls[i].trim() &&
        !FENCE.test(ls[i]) &&
        !/^#{1,6}\s/.test(ls[i]) &&
        !isTableStart(ls, i) &&
        !/^\s*>/.test(ls[i]) &&
        !(LIST.test(ls[i]) && para.length === 0)
      )
        para.push(ls[i++]);
      if (!para.length) para.push(ls[i++]);
      html.push(`<p>${inline(para.join('\n'), ctx)}</p>`);
    }
    return html.join('\n');
  };

  out.push(blocks(lines, 0, true));
  if (open) out.push('</div></details>');
  const metaHtml = meta?.length
    ? `<div class="frontmatter">${meta.map(([k, v]) => `<span><b>${esc(k)}</b> ${esc(v)}</span>`).join('')}</div>`
    : '';
  return { html: metaHtml + out.join('\n'), headings, meta };
}

function list(items, ctx) {
  const root = { children: [], indent: -1 };
  const stack = [root];
  for (const it of items) {
    while (stack.length > 1 && it.indent <= stack[stack.length - 1].indent) stack.pop();
    const node = { ...it, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const emit = (nodes) => {
    if (!nodes.length) return '';
    const ordered = nodes[0].ordered;
    const tag = ordered ? 'ol' : 'ul';
    const start = ordered && nodes[0].start !== 1 ? ` start="${nodes[0].start}"` : '';
    return `<${tag}${start}>${nodes.map((n) => `<li>${inline(n.lines.join(' '), ctx)}${emit(n.children)}</li>`).join('')}</${tag}>`;
  };
  return emit(root.children);
}
