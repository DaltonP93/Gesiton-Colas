import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from './ui';

/*
 * Markdown básico para los documentos legales: títulos, párrafos, listas, citas, negrita, cursiva,
 * código y enlaces. Arma elementos de React (sin HTML crudo), así que el texto nunca ejecuta código.
 */

type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'rule' };

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: Extract<Block, { type: 'list' }> | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (quote.length) blocks.push({ type: 'quote', text: quote.join(' ') });
    if (list) blocks.push(list);
    paragraph = [];
    quote = [];
    list = null;
  };
  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,4})\s+(.+)$/.exec(line))) {
      flush();
      blocks.push({ type: 'heading', level: m[1]!.length as 1 | 2 | 3 | 4, text: m[2]! });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
    } else if ((m = /^(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line))) {
      const ordered = Boolean(m[2]);
      const current = list as Extract<Block, { type: 'list' }> | null;
      if (!current || current.ordered !== ordered) {
        flush();
        list = { type: 'list', ordered, start: ordered ? Number(m[2]) : 1, items: [] };
      }
      list!.items.push(m[3]!);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      if (paragraph.length || list) flush();
      quote.push(m[1]!);
    } else if (list && /^\s{2,}/.test(raw)) {
      // Continuación de un ítem (línea con sangría).
      const items = (list as Extract<Block, { type: 'list' }>).items;
      items[items.length - 1] += ` ${line}`;
    } else if (quote.length) {
      quote.push(line);
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** Identificador para enlazar un título (#2-aceptacion-y-contratacion). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])/;

function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </Link>
    );
  }
  if (/^(https?:|mailto:)/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </a>
    );
  }
  if (href.startsWith('#')) return <a href={href} className="font-medium text-primary hover:underline">{children}</a>;
  return <>{children}</>;
}

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index) out.push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(<strong key={key++}>{renderInline(m[1])}</strong>);
    else if (m[2] !== undefined) out.push(<SafeLink key={key++} href={m[3]!}>{renderInline(m[2])}</SafeLink>);
    else if (m[4] !== undefined) out.push(<code key={key++} className="rounded bg-subtle px-1 py-0.5 text-[0.9em]">{m[4]}</code>);
    else out.push(<em key={key++}>{renderInline(m[5] ?? m[6]!)}</em>);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

const HEADING = {
  1: 'text-2xl font-bold tracking-tight sm:text-3xl',
  2: 'mt-9 text-lg font-semibold sm:text-xl',
  3: 'mt-6 text-base font-semibold',
  4: 'mt-4 text-sm font-semibold',
} as const;

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cx('text-[15px] leading-relaxed', className)}>
      {parseMarkdown(source).map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${block.level}` as 'h1';
            return (
              <Tag key={i} id={slugify(block.text)} className={cx('scroll-mt-20', HEADING[block.level])}>
                {renderInline(block.text)}
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={i} className="mt-3">
                {renderInline(block.text)}
              </p>
            );
          case 'quote':
            return (
              <blockquote key={i} className="mt-4 border-l-4 border-primary/40 bg-subtle/60 px-4 py-2 text-muted">
                {renderInline(block.text)}
              </blockquote>
            );
          case 'rule':
            return <hr key={i} className="my-6 border-border" />;
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i} start={block.ordered ? block.start : undefined} className={cx('mt-3 space-y-1.5 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
