/**
 * Focus a large Mermaid flowchart or classDiagram on one node and its neighbours.
 *
 * parse() reads a diagram's source into nodes, edges and lines; focus() writes the source of a
 * smaller diagram holding only the kept nodes, so Mermaid lays it out afresh. Anything parse()
 * does not understand (chained edges, `A & B`, other diagram types) returns null and the viewer
 * draws the diagram unfiltered.
 */

const ID = '[A-Za-z0-9_]+';
const SHAPE = String.raw`(?:\[\(|\(\[|\[\[|\[\/|\[\\|\(\(|\{\{|\[|\(|\{|>)(?:"[^"]*"|[^"\]\)\}]*)(?:\)\]|\]\)|\]\]|\/\]|\\\]|\)\)|\}\}|\]|\)|\})`;
const NODE = `(${ID})(${SHAPE})?((?::::[\\w-]+)?)`;
const ARROW = String.raw`<?(?:-->|---|-\.->|-\.-|==>|===|--o|--x)(?:\|[^|]*\|)?|--\s[^>]*?-->|-\.\s[^>]*?\.->`;
const NODE_RE = new RegExp(`^${NODE}$`);
const EDGE_RE = new RegExp(`^${NODE}\\s*(${ARROW})\\s*${NODE}$`);

/** Label text of a node, for search and captions: quotes, shape brackets and HTML tags removed. */
const labelOf = (shape, id) =>
  shape
    ? shape.replace(/^[[({>/\\]+"?|"?[\])}/\\]+$/g, '').replace(/<br\s*\/?>/gi, ' · ').replace(/<[^>]+>/g, '').trim() || id
    : id;

/**
 * @returns {{nodes: Map<string, {id, label, cls}>, edges: {from, to}[], lines: object[]} | null}
 */
export function parse(src) {
  const raw = src.split('\n');
  if (/^\s*classDiagram\s*$/.test(raw[0] ?? '')) return parseClasses(raw);
  if (!/^\s*(flowchart|graph)\s+\w+\s*$/.test(raw[0] ?? '')) return null;
  const nodes = new Map();
  const edges = [];
  const lines = [{ kind: 'keep', text: raw[0] }];
  const see = (id, shape, cls) => {
    const n = nodes.get(id) ?? { id, label: id, cls: '', def: '' };
    if (shape && !n.def) Object.assign(n, { label: labelOf(shape, id), def: shape });
    if (cls) n.cls = cls.slice(3);
    nodes.set(id, n);
  };
  for (const text of raw.slice(1)) {
    const t = text.trim();
    let m;
    if (!t || t.startsWith('%%') || /^(classDef|direction)\s/.test(t)) lines.push({ kind: 'keep', text });
    else if (/^(linkStyle|click)\s/.test(t)) lines.push({ kind: 'drop', text });
    else if ((m = t.match(/^subgraph\b/))) lines.push({ kind: 'open', text });
    else if (t === 'end') lines.push({ kind: 'close', text });
    else if ((m = t.match(new RegExp(`^style\\s+(${ID})\\s`)))) lines.push({ kind: 'style', text, ids: [m[1]] });
    else if ((m = t.match(/^class\s+([\w,\s]+?)\s+([\w-]+)$/))) {
      const ids = m[1].split(',').map((s) => s.trim());
      for (const i of ids) see(i, '', `:::${m[2]}`);
      lines.push({ kind: 'class', text, ids, cls: m[2] });
    } else if ((m = t.match(EDGE_RE))) {
      const [, a, as, ac, , b, bs, bc] = m;
      see(a, as, ac);
      see(b, bs, bc);
      edges.push({ from: a, to: b });
      lines.push({ kind: 'edge', text, from: a, to: b, inline: [as && a, bs && b].filter(Boolean) });
    } else if ((m = t.match(NODE_RE))) {
      see(m[1], m[2], m[3]);
      lines.push({ kind: 'node', text, id: m[1] });
    } else return null;
  }
  return { nodes, edges, lines };
}

const REL = String.raw`<\|--|--\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|\.\.\|>|<\|\.\.|--|\.\.`;
const REL_RE = new RegExp(`^(${ID})\\s*(?:"[^"]*"\\s*)?(?:${REL})\\s*(?:"[^"]*"\\s*)?(${ID})(?:\\s*:.*)?$`);

/** A classDiagram: each `class X["label"] { … }` block is a node, each relation line an edge. */
function parseClasses(raw) {
  const nodes = new Map();
  const edges = [];
  const lines = [{ kind: 'keep', text: raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const text = raw[i];
    const t = text.trim();
    let m;
    if (!t || t.startsWith('%%') || /^direction\s/.test(t) || /^classDef\s/.test(t)) lines.push({ kind: 'keep', text });
    else if ((m = t.match(new RegExp(`^class\\s+(${ID})(?:\\["([^"]*)"\\])?\\s*(\\{)?$`)))) {
      const block = [text];
      if (m[3]) while (i + 1 < raw.length && (block.push(raw[++i]), raw[i].trim() !== '}'));
      nodes.set(m[1], { id: m[1], label: m[2] ?? m[1], cls: '', def: '' });
      lines.push({ kind: 'node', text: block.join('\n'), id: m[1] });
    } else if ((m = t.match(new RegExp(`^style\\s+(${ID})\\s`)))) lines.push({ kind: 'style', text, ids: [m[1]] });
    else if ((m = t.match(new RegExp(`^(${ID})\\s*:`)))) lines.push({ kind: 'style', text, ids: [m[1]] });
    else if ((m = t.match(REL_RE))) {
      for (const n of [m[1], m[2]]) if (!nodes.has(n)) nodes.set(n, { id: n, label: n, cls: '', def: '' });
      edges.push({ from: m[1], to: m[2] });
      lines.push({ kind: 'edge', text, from: m[1], to: m[2], inline: [] });
    } else return null;
  }
  return { nodes, edges, lines };
}

/** Every node within `depth` edges of a start node, following edges in either direction. */
export function neighbourhood(graph, starts, depth) {
  const adj = new Map([...graph.nodes.keys()].map((k) => [k, new Set()]));
  for (const e of graph.edges) {
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
  }
  const seen = new Set(starts);
  let frontier = [...starts];
  for (let d = 0; d < depth; d++) {
    frontier = frontier.flatMap((n) => [...adj.get(n)].filter((x) => !seen.has(x)));
    frontier.forEach((x) => seen.add(x));
  }
  return seen;
}

/** Diagram source holding only the `keep` nodes, the edges between them and their subgraphs. */
export function focus(graph, keep) {
  const out = [];
  const defined = new Set();
  for (const l of graph.lines) {
    if (l.kind === 'keep' || l.kind === 'open' || l.kind === 'close') out.push(l);
    else if (l.kind === 'node' && keep.has(l.id)) {
      out.push(l);
      defined.add(l.id);
    } else if (l.kind === 'style' && l.ids.every((i) => keep.has(i))) out.push(l);
    else if (l.kind === 'class') {
      const ids = l.ids.filter((i) => keep.has(i));
      if (ids.length) out.push({ kind: 'keep', text: `  class ${ids.join(',')} ${l.cls}` });
    } else if (l.kind === 'edge') {
      if (keep.has(l.from) && keep.has(l.to)) {
        out.push(l);
        l.inline.forEach((i) => defined.add(i));
      } else
        // The edge goes, but a kept end may have been defined only here: define it on its own.
        for (const i of l.inline)
          if (keep.has(i) && !defined.has(i)) {
            const n = graph.nodes.get(i);
            out.push({ kind: 'node', text: `  ${i}${n.def}${n.cls ? `:::${n.cls}` : ''}` });
            defined.add(i);
          }
    }
  }
  // Drop subgraphs left empty, innermost first.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++)
      if (out[i].kind === 'open' && out[i + 1].kind === 'close') {
        out.splice(i, 2);
        changed = true;
      }
  }
  return out.map((l) => l.text).join('\n');
}
