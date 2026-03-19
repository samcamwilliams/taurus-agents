import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import { Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import 'highlight.js/styles/github-dark-dimmed.css';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button className="code-copy" onClick={handleCopy} title="Copy">
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children);
  }
  return '';
}

interface MarkdownProps {
  children: string;
}

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  if (!children) return null;

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a({ href, children, ...props }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {children}
              </a>
            );
          },
          pre({ children, ...props }) {
            const text = extractText(children);
            return (
              <pre {...props}>
                {children}
                <CopyButton text={text} />
              </pre>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
