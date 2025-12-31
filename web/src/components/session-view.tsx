import { useEffect, useState, useRef, useCallback } from "react";
import type { ConversationMessage } from "@claude-run/shared";
import MessageBlock from "./message-block";

interface SessionViewProps {
  sessionId: string;
}

function SessionView(props: SessionViewProps) {
  const { sessionId } = props;

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const maxRetries = 10;
  const baseDelay = 1000;

  const connect = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

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
        if (unique.length === 0) {
          return prev;
        }
        offsetRef.current += unique.length;
        return [...prev, ...unique];
      });
    });

    eventSource.onerror = () => {
      eventSource.close();
      setLoading(false);

      if (!mountedRef.current) {
        return;
      }

      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;
        retryTimeoutRef.current = setTimeout(() => connect(), delay);
      }
    };
  }, [sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setMessages([]);
    offsetRef.current = 0;
    retryCountRef.current = 0;

    connect();

    return () => {
      mountedRef.current = false;
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);

  useEffect(() => {
    if (autoScroll && lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ behavior: "instant" });
    }
  }, [messages, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
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
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto bg-zinc-950"
    >
      <div className="mx-auto max-w-3xl px-4 py-4">
        {summary && (
          <div className="mb-6 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-4">
            <h2 className="text-sm font-medium text-zinc-200 leading-relaxed">
              {summary.summary}
            </h2>
            <p className="mt-2 text-[11px] text-zinc-500">
              {conversationMessages.length} messages
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {conversationMessages.map((message, index) => (
            <div
              key={message.uuid || index}
              ref={
                index === conversationMessages.length - 1
                  ? lastMessageRef
                  : undefined
              }
            >
              <MessageBlock message={message} />
            </div>
          ))}
        </div>

        {!autoScroll && (
          <button
            onClick={() => {
              setAutoScroll(true);
              lastMessageRef.current?.scrollIntoView({ behavior: "instant" });
            }}
            className="fixed bottom-4 right-6 rounded-full bg-zinc-200/90 px-3.5 py-2 text-xs font-medium text-zinc-900 shadow-lg transition-all hover:bg-zinc-100 flex items-center gap-1.5 backdrop-blur-sm"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
            <span>Latest</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default SessionView;
