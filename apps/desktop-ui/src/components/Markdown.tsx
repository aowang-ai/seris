import { useI18n } from '../i18n';
/**
 * Markdown.tsx — GFM-aware renderer for assistant turns (and any markdown
 * surface). Mirrors the synara chat-markdown structure: compact vertical
 * rhythm, ink-on-paper code surface with a small lang header, sized tables,
 * readable lists, careful link/streaming inline-code treatment.
 */

import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownProps {
  text: string;
  /** compact = inside a user bubble: tighter rhythm, code-on-tint not ink-block */
  compact?: boolean;
}

export const Markdown = memo(function Markdown({
  text,
  compact,
}: MarkdownProps) {
  return (
    <div className={compact ? 'md md-compact' : 'md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isBlock =
              /language-(\w+)/.test(className ?? '') ||
              String(children).includes('\n');
            if (!isBlock) {
              return (
                <code className="md-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            const lang = /language-(\w+)/.exec(className ?? '')?.[1] ?? '';
            return (
              <CodeBlock
                lang={lang}
                code={String(children).replace(/\n$/, '')}
              />
            );
          },
          // paragraph
          p: ({ children }) => <p className="md-p">{children}</p>,
          // lists
          ul: ({ children }) => <ul className="md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="md-ol">{children}</ol>,
          li: ({ children }) => <li className="md-li">{children}</li>,
          // headings
          h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="md-h4">{children}</h4>,
          // blockquote
          blockquote: ({ children }) => (
            <blockquote className="md-quote">{children}</blockquote>
          ),
          // link
          a: ({ children, href }) => (
            <a className="md-link" href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          // table (GFM)
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table className="md-table">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="md-th">{children}</th>,
          td: ({ children }) => <td className="md-td">{children}</td>,
          // horizontal rule
          hr: () => <hr className="md-hr" />,
          // strong/em — keep default tags
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-codeblock">
      <div className="md-codeblock-head">
        <span className="md-codeblock-lang">{lang || t('Plain text')}</span>
        <button
          type="button"
          className="md-codeblock-copy"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 900);
            });
          }}
        >
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre className="md-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}
