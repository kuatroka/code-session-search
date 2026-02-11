import { useState, useMemo, memo, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Trash2 } from "lucide-react";
import type { Session, SessionSource } from "@claude-run-plus/api";
import { formatTime } from "../utils";
import type { ClientSearchResult } from "../hooks/use-search-index";

interface ModelInfo {
  model: string;
  provider: string;
}

function formatModelShort(model: string): string {
  return model
    .replace(/-\d{8,}$/, "")
    .replace(/^claude-/, "");
}

function ModelBadge({ model }: { model: ModelInfo | null }) {
  if (!model) return null;
  return (
    <span className="text-[9px] text-zinc-400 dark:text-zinc-600 truncate">
      {model.provider ? `${model.provider}/` : ""}{formatModelShort(model.model)}
    </span>
  );
}

const SOURCE_COLORS: Record<SessionSource, string> = {
  claude: "bg-blue-500",
  factory: "bg-emerald-500",
  codex: "bg-orange-500",
  pi: "bg-pink-500",
};

const SOURCES: Array<{ key: SessionSource | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "claude", label: "Claude" },
  { key: "factory", label: "Factory" },
  { key: "codex", label: "Codex" },
  { key: "pi", label: "Pi" },
];

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string, source: SessionSource) => Promise<void>;
  loading?: boolean;
  selectedSource: SessionSource | null;
  onSelectSource: (source: SessionSource | null) => void;
  onSearchQueryChange?: (query: string) => void;
  searchFn: (query: string, source?: string | null) => Promise<ClientSearchResult[]>;
  searchReady: boolean;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, onDeleteSession, loading, selectedSource, onSelectSource, onSearchQueryChange, searchFn: clientSearch, searchReady } = props;
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [deletingSession, setDeletingSession] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultRefsMap = useRef<Map<number, HTMLDivElement>>(new Map());

  // Batch model fetching — fetch once per session, cache globally, no per-row state updates
  const [modelMap, setModelMap] = useState<Map<string, ModelInfo | null>>(new Map());
  const pendingModelsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const ids = sessions
      .map((s) => s.id)
      .filter((id) => !modelMap.has(id) && !pendingModelsRef.current.has(id));
    if (ids.length === 0) return;

    // Mark as pending to prevent duplicate concurrent requests
    for (const id of ids) pendingModelsRef.current.add(id);

    let cancelled = false;
    (async () => {
      const newEntries = new Map<string, ModelInfo | null>();
      for (let i = 0; i < ids.length; i += 20) {
        if (cancelled) return;
        const batch = ids.slice(i, i + 20);
        const results = await Promise.all(
          batch.map(async (id) => {
            try {
              const res = await fetch(`/api/session/${id}/model`);
              const data: ModelInfo | null = await res.json();
              return [id, data] as const;
            } catch {
              return [id, null] as const;
            }
          })
        );
        for (const [id, data] of results) {
          newEntries.set(id, data);
        }
      }
      if (!cancelled) {
        // Remove from pending and store results
        for (const id of ids) pendingModelsRef.current.delete(id);
        setModelMap((prev) => {
          const next = new Map(prev);
          for (const [id, data] of newEntries) next.set(id, data);
          return next;
        });
      } else {
        // Cancelled — remove from pending so they can be retried
        for (const id of ids) pendingModelsRef.current.delete(id);
      }
    })();

    return () => { cancelled = true; };
  }, [sessions, modelMap]);

  const [searchResults, setSearchResults] = useState<ClientSearchResult[] | null>(null);

  useEffect(() => {
    if (!search.trim() || !searchReady) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(() => {
      let cancelled = false;
      clientSearch(search, selectedSource).then((results) => {
        if (!cancelled) setSearchResults(results.length > 0 ? results : []);
      });
      // Note: cancelled is scoped to the timeout callback, cleanup below handles stale timers
    }, 200);
    return () => clearTimeout(timer);
  }, [search, selectedSource, searchReady, clientSearch]);

  useEffect(() => {
    onSearchQueryChange?.(search);
  }, [search, onSearchQueryChange]);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightIdx(-1);
  }, [searchResults, sessions]);

  const filteredSessions = useMemo(() => {
    if (searchResults !== null) return [];
    return sessions;
  }, [sessions, searchResults]);

  const virtualizer = useVirtualizer({
    count: filteredSessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  const showSearchResults = searchResults !== null && search.trim().length > 0;

  // The navigable list: search results or filtered sessions
  const navListLength = showSearchResults
    ? searchResults!.length
    : filteredSessions.length;

  const selectAtIndex = useCallback((idx: number) => {
    if (showSearchResults && searchResults) {
      const r = searchResults[idx];
      if (r) onSelectSession(r.sessionId);
    } else {
      const s = filteredSessions[idx];
      if (s) onSelectSession(s.id);
    }
  }, [showSearchResults, searchResults, filteredSessions, onSelectSession]);

  // Scroll highlighted result into view
  useEffect(() => {
    if (highlightIdx < 0) return;
    if (showSearchResults) {
      const el = resultRefsMap.current.get(highlightIdx);
      el?.scrollIntoView({ block: "nearest" });
    } else {
      virtualizer.scrollToIndex(highlightIdx, { align: "auto" });
    }
  }, [highlightIdx, showSearchResults, virtualizer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (navListLength === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev < navListLength - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => (prev > 0 ? prev - 1 : navListLength - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIdx >= 0) {
        selectAtIndex(highlightIdx);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (search) {
        setSearch("");
      } else {
        searchInputRef.current?.blur();
      }
    }
  }, [navListLength, highlightIdx, selectAtIndex, search]);

  // "/" global shortcut
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string, source: SessionSource) => {
    const confirmed = window.confirm("Delete this session permanently?");
    if (!confirmed) return;
    setDeletingSession(sessionId);
    try {
      await onDeleteSession(sessionId, source);
    } finally {
      setDeletingSession((prev) => (prev === sessionId ? null : prev));
    }
  }, [onDeleteSession]);

  const setResultRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) {
      resultRefsMap.current.set(idx, el);
    } else {
      resultRefsMap.current.delete(idx);
    }
  }, []);

  const placeholder = searchReady ? "Search... (press /)" : "Indexing...";

  return (
    <div className="h-full overflow-hidden bg-white dark:bg-zinc-950 flex flex-col">
      <div className="flex px-3 py-2 gap-1 border-b border-zinc-200 dark:border-zinc-800/60">
        {SOURCES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onSelectSource(key === "all" ? null : key)}
            className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
              (key === "all" && !selectedSource) || selectedSource === key
                ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800/60">
        <div className="flex items-center gap-2 text-zinc-500">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none"
          />
          {!searchReady && (
            <svg
              className="w-4 h-4 text-zinc-400 animate-spin flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          )}
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <svg
              className="w-5 h-5 text-zinc-400 dark:text-zinc-600 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : showSearchResults ? (
          searchResults!.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
              No results found
            </p>
          ) : (
            <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
              {searchResults!.map((result, idx) => {
                const resultSource = (result.source as SessionSource) || "claude";
                const deleting = deletingSession === result.sessionId;
                return (
                  <div
                    key={`${result.source}:${result.sessionId}`}
                    ref={(el) => setResultRef(idx, el)}
                    className={`group flex items-stretch ${
                      highlightIdx === idx
                        ? "bg-zinc-100 dark:bg-zinc-800"
                        : selectedSession === result.sessionId
                          ? "bg-cyan-100 dark:bg-cyan-700/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                    }`}
                  >
                    <button
                      onClick={() => onSelectSession(result.sessionId)}
                      className="flex-1 px-3 py-3 text-left transition-colors"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${SOURCE_COLORS[resultSource] || "bg-zinc-400"}`} />
                          <span className="text-[10px] text-zinc-500 font-medium truncate">
                            {result.project.split("/").pop() || result.project}
                          </span>
                          <span className="text-[10px] text-zinc-400 dark:text-zinc-600">·</span>
                          <ModelBadge model={modelMap.get(result.sessionId) ?? null} />
                        </div>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0 ml-1">
                          {result.timestamp ? formatTime(result.timestamp) : ""}
                        </span>
                      </div>
                      <p className="text-[12px] text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-1 break-words mb-1">
                        {result.display}
                      </p>
                      <p
                        className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-snug line-clamp-2 break-words"
                        dangerouslySetInnerHTML={{ __html: result.snippet }}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteSession(result.sessionId, resultSource);
                      }}
                      disabled={deleting}
                      className="mr-2 my-2 p-1.5 self-start rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-40"
                      title="Delete session"
                      aria-label="Delete session"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredSessions.length === 0 ? (
          <p className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
            No sessions found
          </p>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const session = filteredSessions[virtualItem.index];
              const isHighlighted = highlightIdx === virtualItem.index;
              const deleting = deletingSession === session.id;
              return (
                <div
                  key={`${session.source}:${session.id}`}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`group flex items-stretch overflow-hidden border-b border-zinc-200/60 dark:border-zinc-800/40 ${
                    isHighlighted
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : selectedSession === session.id
                        ? "bg-cyan-100 dark:bg-cyan-700/30"
                        : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  } ${virtualItem.index === 0 ? "border-t border-t-zinc-200/60 dark:border-t-zinc-800/40" : ""}`}
                >
                  <button
                    onClick={() => onSelectSession(session.id)}
                    className="flex-1 px-3 py-3.5 text-left transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${SOURCE_COLORS[session.source]}`} />
                        <span className="text-[10px] text-zinc-500 font-medium truncate">
                          {session.projectName}
                        </span>
                        <span className="text-[10px] text-zinc-400 dark:text-zinc-600">·</span>
                        <ModelBadge model={modelMap.get(session.id) ?? null} />
                      </div>
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-600 shrink-0 ml-1">
                        {formatTime(session.timestamp)}
                      </span>
                    </div>
                    <p className="text-[12px] text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-2 break-words">
                      {session.display}
                    </p>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDeleteSession(session.id, session.source);
                    }}
                    disabled={deleting}
                    className="mr-2 my-2 p-1.5 self-start rounded text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 opacity-0 group-hover:opacity-100 focus:opacity-100 transition disabled:opacity-40"
                    title="Delete session"
                    aria-label="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800/60">
        <div className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center">
          {showSearchResults
            ? `${searchResults!.length} result${searchResults!.length !== 1 ? "s" : ""}`
            : `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
          }
        </div>
      </div>
    </div>
  );
});

export default SessionList;
