import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { ConversationMessage, SessionSource } from "@claude-run-plus/api";
import MessageBlock from "./message-block";
import ScrollToBottomButton from "./scroll-to-bottom-button";
import { sanitizeText } from "../utils";

const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;
const SCROLL_THRESHOLD_PX = 100;

export interface SessionModelInfo {
  model: string;
  provider: string;
}

interface SessionViewProps {
  sessionId: string;
  source: SessionSource;
  searchQuery?: string;
  onModelChange?: (info: SessionModelInfo | null) => void;
}

function getMessageText(message: ConversationMessage): string {
  const content = message.message?.content;
  if (!content) return "";
  if (typeof content === "string") return sanitizeText(content);
  return content
    .filter((b) => b.type === "text" && !!b.text)
    .map((b) => sanitizeText(b.text || ""))
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

function extractLatestModel(messages: ConversationMessage[]): SessionModelInfo | null {
  // Walk messages in reverse to find the latest assistant message with a model
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === "assistant" && msg.message?.model) {
      const fullModel = msg.message.model;
      // Try to derive provider from model name
      let provider = "";
      if (fullModel.startsWith("claude")) provider = "anthropic";
      else if (fullModel.startsWith("gpt") || fullModel.startsWith("o1") || fullModel.startsWith("o3") || fullModel.startsWith("o4")) provider = "openai";
      else if (fullModel.includes("gemini")) provider = "google";
      else if (fullModel.includes("codex")) provider = "openai-codex";
      return { model: fullModel, provider };
    }
  }
  return null;
}

function SessionView(props: SessionViewProps) {
  const { sessionId, source, searchQuery, onModelChange } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
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
      `/api/conversation/${sessionId}/stream?source=${encodeURIComponent(source)}&offset=${offsetRef.current}`
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
  }, [sessionId, source]);

  // Report latest model to parent whenever messages change
  useEffect(() => {
    if (onModelChange) {
      onModelChange(extractLatestModel(messages));
    }
  }, [messages, onModelChange]);

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
      const mark = container.querySelector("mark.search-highlight");
      const ring = container.querySelector(".ring-2");
      const target = mark || ring;
      if (!target) return false;

      hasScrolledToMatchRef.current = true;
      isScrollingProgrammaticallyRef.current = true;
      if (mark) mark.classList.add("search-highlight-active");
      setCurrentMatchIdx(0);
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

  // Count <mark> elements whenever messages or search changes
  useEffect(() => {
    if (searchWords.length === 0) {
      setMatchCount(0);
      setCurrentMatchIdx(0);
      return;
    }
    // Wait for render then count
    const timer = setTimeout(() => {
      const marks = containerRef.current?.querySelectorAll("mark.search-highlight");
      setMatchCount(marks?.length || 0);
    }, 400);
    return () => clearTimeout(timer);
  }, [messages, searchWords]);

  const scrollToMatch = useCallback((idx: number) => {
    const container = containerRef.current;
    if (!container) return;
    const marks = container.querySelectorAll("mark.search-highlight");
    if (idx < 0 || idx >= marks.length) return;

    // Remove active class from all, add to current
    marks.forEach((m) => m.classList.remove("search-highlight-active"));
    marks[idx].classList.add("search-highlight-active");

    setCurrentMatchIdx(idx);
    isScrollingProgrammaticallyRef.current = true;
    marks[idx].scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => { isScrollingProgrammaticallyRef.current = false; }, 600);
  }, []);

  const goToNextMatch = useCallback(() => {
    if (matchCount === 0) return;
    scrollToMatch(currentMatchIdx < matchCount - 1 ? currentMatchIdx + 1 : 0);
  }, [matchCount, currentMatchIdx, scrollToMatch]);

  const goToPrevMatch = useCallback(() => {
    if (matchCount === 0) return;
    scrollToMatch(currentMatchIdx > 0 ? currentMatchIdx - 1 : matchCount - 1);
  }, [matchCount, currentMatchIdx, scrollToMatch]);

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

      {searchWords.length > 0 && matchCount > 0 && (
        <div className="absolute top-2 right-6 z-10 flex items-center gap-1 px-2 py-1 rounded-lg bg-zinc-100/90 dark:bg-zinc-800/90 border border-zinc-300 dark:border-zinc-700 shadow-sm backdrop-blur-sm">
          <span className="text-[11px] text-zinc-600 dark:text-zinc-400 tabular-nums px-1">
            {currentMatchIdx + 1} / {matchCount}
          </span>
          <button
            onClick={goToPrevMatch}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            aria-label="Previous match"
          >
            <ChevronUp className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
          </button>
          <button
            onClick={goToNextMatch}
            className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            aria-label="Next match"
          >
            <ChevronDown className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
          </button>
        </div>
      )}

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
