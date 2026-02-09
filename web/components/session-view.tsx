import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import type { ConversationMessage } from "@claude-run-plus/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCROLL_THRESHOLD_PX = 100;

interface SessionViewProps {
  sessionId: string;
  searchQuery?: string;
}

function getMessageText(message: ConversationMessage): string {
  const content = message.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((b) => b.text || b.thinking || "")
    .join(" ");
}

function naiveStem(word: string): string {
  let w = word.toLowerCase();
  const suffixes = ["ation", "ment", "ness", "ting", "ning", "ing", "ied", "ies", "ous", "ive", "ion", "ers", "est", "ble", "ing", "ful", "ant", "ent", "ly", "ed", "er", "es", "al", "en", "ty", "ry", "or", "ar", "le", "s"];
  for (const s of suffixes) {
    if (w.length > s.length + 2 && w.endsWith(s)) {
      w = w.slice(0, -s.length);
      break;
    }
  }
  return w;
}

function messageMatchesQuery(message: ConversationMessage, words: string[]): boolean {
  if (words.length === 0) return false;
  const text = getMessageText(message).toLowerCase();
  return words.every((w) => {
    const stem = naiveStem(w);
    try {
      return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*`, "i").test(text);
    } catch {
      return text.includes(w);
    }
  });
}

function SessionView(props: SessionViewProps) {
  const { sessionId, searchQuery } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const firstMatchRef = useRef<HTMLDivElement>(null);
  const hasScrolledToMatchRef = useRef(false);
  const offsetRef = useRef(0);
  const isScrollingProgrammaticallyRef = useRef(false);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const searchWords = useMemo(() => {
    if (!searchQuery?.trim()) return [];
    return searchQuery.trim().toLowerCase().split(/\s+/);
  }, [searchQuery]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (eventSourceRef.current) eventSourceRef.current.close();

    const eventSource = new EventSource(
      `/api/conversation/${sessionId}/stream?offset=${offsetRef.current}`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("messages", (event) => {
      retryCountRef.current = 0;
      const newMessages: ConversationMessage[] = JSON.parse(event.data);
      setLoading(false);
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.uuid).filter(Boolean));
        const unique = newMessages.filter((m) => !existingIds.has(m.uuid));
        if (unique.length === 0) return prev;
        offsetRef.current += unique.length;
        return [...prev, ...unique];
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setLoading(false);
      if (!mountedRef.current) return;
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.min(BASE_RETRY_DELAY_MS * Math.pow(2, retryCountRef.current), MAX_RETRY_DELAY_MS);
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    setAutoScroll(!searchQuery?.trim());
    hasScrolledToMatchRef.current = false;
    offsetRef.current = 0;
    retryCountRef.current = 0;
    connect();
    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [connect]);

  const scrollToBottom = useCallback(() => {
    if (!lastMessageRef.current) return;
    isScrollingProgrammaticallyRef.current = true;
    lastMessageRef.current.scrollIntoView({ behavior: "instant" });
    requestAnimationFrame(() => {
      isScrollingProgrammaticallyRef.current = false;
    });
  }, []);

  // Auto-scroll to the first search match.
  // Uses MutationObserver + polling fallback to handle React render timing.
  useEffect(() => {
    if (searchWords.length === 0 || messages.length === 0) {
      if (autoScroll) scrollToBottom();
      return;
    }
    if (hasScrolledToMatchRef.current) return;

    const container = containerRef.current;
    if (!container) return;

    const scrollToFirstMatch = (): boolean => {
      if (hasScrolledToMatchRef.current) return true;
      // Priority 1: scroll to a <mark> highlight inside the content area
      const mark = container.querySelector("mark.search-highlight");
      // Priority 2: scroll to the ring-highlighted message div
      const ring = container.querySelector(".ring-2");
      const target = mark || ring;
      if (!target) return false;

      hasScrolledToMatchRef.current = true;
      isScrollingProgrammaticallyRef.current = true;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => { isScrollingProgrammaticallyRef.current = false; }, 600);
      return true;
    };

    // Try immediately (content may already be rendered)
    if (scrollToFirstMatch()) return;

    // Watch for DOM changes (React rendering marks/rings)
    let observer: MutationObserver | null = null;
    observer = new MutationObserver(() => {
      if (scrollToFirstMatch() && observer) {
        observer.disconnect();
        observer = null;
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    // Polling fallback (in case MutationObserver misses it, e.g. mark added
    // via text replacement that doesn't trigger childList)
    let attempt = 0;
    const maxAttempts = 20;
    const poll = () => {
      if (hasScrolledToMatchRef.current) return;
      attempt++;
      if (scrollToFirstMatch()) {
        if (observer) { observer.disconnect(); observer = null; }
        return;
      }
      if (attempt < maxAttempts) {
        retryTimerRef.current = setTimeout(poll, 300);
      }
    };
    retryTimerRef.current = setTimeout(poll, 200);

    return () => {
      if (observer) { observer.disconnect(); observer = null; }
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [messages, autoScroll, scrollToBottom, searchWords]);

  const handleScroll = () => {
    if (!containerRef.current || isScrollingProgrammaticallyRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD_PX;
    setAutoScroll(isAtBottom);
  };

  const summary = messages.find((m) => m.type === "summary");
  const conversationMessages = messages.filter(
    (m) => m.type === "user" || m.type === "assistant"
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto bg-white dark:bg-zinc-950"
      >
        <div className="mx-auto max-w-3xl px-4 py-4">
          {summary && (
            <div className="mb-6 rounded-xl border border-zinc-200 dark:border-zinc-800/60 bg-zinc-50 dark:bg-zinc-900/50 p-4">
              <h2 className="text-sm font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed">
                {summary.summary}
              </h2>
              <p className="mt-2 text-[11px] text-zinc-500">
                {conversationMessages.length} messages
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {conversationMessages.map((message, index) => {
              const isMatch = searchWords.length > 0 && messageMatchesQuery(message, searchWords);
              const isFirstMatch = isMatch && !conversationMessages.slice(0, index).some((m) => messageMatchesQuery(m, searchWords));
              return (
                <div
                  key={message.uuid || index}
                  ref={
                    isFirstMatch
                      ? firstMatchRef
                      : index === conversationMessages.length - 1
                        ? lastMessageRef
                        : undefined
                  }
                  className={isMatch ? "ring-2 ring-orange-400 dark:ring-orange-500/60 rounded-2xl" : ""}
                >
                  <MessageBlock message={message} searchHighlight={searchWords} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!autoScroll && (
        <ScrollToBottomButton
          onClick={() => {
            setAutoScroll(true);
            scrollToBottom();
          }}
        />
      )}
    </div>
  );
}

export default SessionView;
