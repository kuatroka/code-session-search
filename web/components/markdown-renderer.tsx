import { memo, useEffect, useRef, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./tool-renderers";

const MARK_CLASS = "search-highlight";

function applyDomHighlights(container: HTMLElement, words: string[]): void {
  if (!words.length) return;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const text = node.nodeValue || "";
    if (!regex.test(text)) continue;
    regex.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
      }
      const mark = document.createElement("mark");
      mark.className = MARK_CLASS;
      mark.textContent = match[1];
      frag.appendChild(mark);
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
    node.parentNode?.replaceChild(frag, node);
  }
}

function clearDomHighlights(container: HTMLElement): void {
  const marks = container.querySelectorAll(`mark.${MARK_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize();
    }
  });
}

export function highlightText(text: string, words: string[]): ReactNode {
  if (words.length === 0) return text;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className={MARK_CLASS}>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  highlightWords?: string[];
}

export const MarkdownRenderer = memo(function MarkdownRenderer(
  props: MarkdownRendererProps
) {
  const { content, className = "", highlightWords } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !highlightWords?.length) return;
    clearDomHighlights(containerRef.current);
    applyDomHighlights(containerRef.current, highlightWords);
    return () => {
      if (containerRef.current) clearDomHighlights(containerRef.current);
    };
  }, [content, highlightWords]);

  return (
    <div ref={containerRef} className={`break-words ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: (props) => {
            const { children } = props;
            return (
              <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h2: (props) => {
            const { children } = props;
            return (
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h3: (props) => {
            const { children } = props;
            return (
              <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mt-3 mb-1.5">
                {children}
              </div>
            );
          },
          h4: (props) => {
            const { children } = props;
            return (
              <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mt-2 mb-1">
                {children}
              </div>
            );
          },
          h5: (props) => {
            const { children } = props;
            return (
              <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mt-2 mb-1">
                {children}
              </div>
            );
          },
          h6: (props) => {
            const { children } = props;
            return (
              <div className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 mt-2 mb-1">
                {children}
              </div>
            );
          },
          p: (props) => {
            const { children } = props;
            return (
              <p className="text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap my-2">
                {children}
              </p>
            );
          },
          a: (props) => {
            const { href, children } = props;
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-600 dark:text-cyan-400 hover:text-cyan-500 dark:hover:text-cyan-300 underline underline-offset-2"
              >
                {children}
              </a>
            );
          },
          strong: (props) => {
            const { children } = props;
            return (
              <strong className="font-semibold text-zinc-900 dark:text-zinc-50">{children}</strong>
            );
          },
          em: (props) => {
            const { children } = props;
            return <em className="italic text-zinc-800 dark:text-zinc-200">{children}</em>;
          },
          code: (props) => {
            const { children } = props;
            return (
              <code className="px-1.5 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800/80 text-cyan-700 dark:text-cyan-300 text-[12px] font-mono">
                {children}
              </code>
            );
          },
          pre: (props) => {
            const { node } = props as { node?: { children?: Array<{ tagName?: string; properties?: { className?: string[] }; children?: Array<{ value?: string }> }> } };
            const codeNode = node?.children?.[0];

            if (codeNode?.tagName === "code") {
              const classNames = codeNode.properties?.className || [];
              const langClass = classNames.find((c) => c.startsWith("language-"));
              const language = langClass?.replace("language-", "") || "code";
              const codeContent = codeNode.children?.map((c) => c.value).join("") || "";

              return (
                <div className="relative group my-2 rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700/50">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-300 dark:border-zinc-700/50">
                    <span className="text-[10px] text-zinc-500 font-mono">
                      {language}
                    </span>
                    <CopyButton text={codeContent} />
                  </div>
                  <pre className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/80 p-3 overflow-x-auto rounded-t-none!">
                    <code>{codeContent}</code>
                  </pre>
                </div>
              );
            }

            const { children } = props;
            return <pre>{children}</pre>;
          },
          ul: (props) => {
            const { children } = props;
            return (
              <ul className="my-2 ml-3 space-y-1 list-disc list-inside text-zinc-800 dark:text-zinc-200">
                {children}
              </ul>
            );
          },
          ol: (props) => {
            const { children } = props;
            return (
              <ol className="my-2 ml-3 space-y-1 list-decimal list-inside text-zinc-800 dark:text-zinc-200">
                {children}
              </ol>
            );
          },
          li: (props) => {
            const { children } = props;
            return (
              <li className="text-[13px] leading-relaxed">{children}</li>
            );
          },
          blockquote: (props) => {
            const { children } = props;
            return (
              <div className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 my-2 text-zinc-500 dark:text-zinc-400 italic">
                {children}
              </div>
            );
          },
          hr: () => <hr className="border-zinc-300 dark:border-zinc-700 my-4" />,
          table: (props) => {
            const { children } = props;
            return (
              <div className="my-2 overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700/50">
                <table className="w-full text-[13px]">{children}</table>
              </div>
            );
          },
          thead: (props) => {
            const { children } = props;
            return <thead className="bg-zinc-100 dark:bg-zinc-900">{children}</thead>;
          },
          tr: (props) => {
            const { children } = props;
            return (
              <tr className="border-b border-zinc-200 dark:border-zinc-700/50 last:border-b-0">
                {children}
              </tr>
            );
          },
          th: (props) => {
            const { children } = props;
            return (
              <th className="px-3 py-2 text-left font-medium text-zinc-800 dark:text-zinc-200">
                {children}
              </th>
            );
          },
          td: (props) => {
            const { children } = props;
            return <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{children}</td>;
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
});
