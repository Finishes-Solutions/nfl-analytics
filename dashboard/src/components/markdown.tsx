/**
 * markdown.tsx — small, safe Markdown renderer for assistant answers.
 * Builds React elements directly (no innerHTML), so model output can't inject
 * markup. Supports headings, paragraphs, lists, tables, code, bold/italic,
 * inline code, and http(s) links. Tolerates half-streamed input.
 */
import type { ReactNode } from 'react';

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{inline(m[2].slice(2, -2), i)}</strong>);
    else if (m[3]) out.push(<em key={k}>{inline(m[3].slice(1, -1), i)}</em>);
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf(']'));
      out.push(<a key={k} className="link" href={m[5]} target="_blank" rel="noreferrer noopener">{label}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={blocks.length} className="md-code"><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(4, h[1].length + 1);
      const Tag = `h${level}` as 'h2' | 'h3' | 'h4';
      blocks.push(<Tag key={blocks.length} className="md-h">{inline(h[2])}</Tag>);
      i++; continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : 'left'));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const numeric = head.map((_, c) => rows.length > 0 && rows.every((r) => /^[-+−]?[\d.,%]+$/.test(r[c] ?? '') || !r[c]));
      blocks.push(
        <div key={blocks.length} className="md-table"><table className="dt">
          <thead><tr>{head.map((c, j) => <th key={j} className={numeric[j] || align[j] === 'right' ? '' : 'l'}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j} className={numeric[j] || align[j] === 'right' ? '' : 'l'}>{inline(r[j] ?? '')}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      blocks.push(<List key={blocks.length} className="md-list">{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s+)/.test(lines[i]) && !(isTableRow(lines[i]) && isSep(lines[i + 1] ?? ''))) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={blocks.length} className="md-p">{para.flatMap((p, j) => (j ? [<br key={`b${j}`} />, ...inline(p, j)] : inline(p, j)))}</p>);
  }
  return <div className="md">{blocks}</div>;
}
