import { useState, useMemo, memo, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Session, SessionSource } from "@claude-run-plus/api";
import { formatTime } from "../utils";

interface SearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  rank: number;
}

const SOURCE_COLORS: Record<SessionSource, string> = {
  claude: "bg-blue-500",
  factory: "bg-emerald-500",
  codex: "bg-orange-500",
};

const SOURCES: Array<{ key: SessionSource | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "claude", label: "Claude" },
  { key: "factory", label: "Factory" },
  { key: "codex", label: "Codex" },
];

interface SessionListProps {
  sessions: Session[];
  selectedSession: string | null;
  onSelectSession: (sessionId: string) => void;
  loading?: boolean;
  selectedSource: SessionSource | null;
  onSelectSource: (source: SessionSource | null) => void;
}

const SessionList = memo(function SessionList(props: SessionListProps) {
  const { sessions, selectedSession, onSelectSession, loading, selectedSource, onSelectSource } = props;
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const doSearch = useCallback(async (query: string, source: SessionSource | null) => {
    if (!query.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: query });
      if (source) params.set("source", source);
      const res = await fetch(`/api/search?${params}`);
      const results: SearchResult[] = await res.json();
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!search.trim()) {
      setSearchResults(null);
      return;
    }

    searchTimeoutRef.current = setTimeout(() => {
      doSearch(search, selectedSource);
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search, selectedSource, doSearch]);

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
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Full-text search..."
            className="flex-1 bg-transparent text-sm text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none"
          />
          {searching && (
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
          searchResults.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-400 dark:text-zinc-600">
              No results found
            </p>
          ) : (
            <div className="divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
              {searchResults.map((result) => (
                <button
                  key={result.sessionId}
                  onClick={() => onSelectSession(result.sessionId)}
                  className={`w-full px-3 py-3 text-left transition-colors ${
                    selectedSession === result.sessionId
                      ? "bg-cyan-100 dark:bg-cyan-700/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${SOURCE_COLORS[result.source as SessionSource] || "bg-zinc-400"}`} />
                      <span className="text-[10px] text-zinc-500 font-medium">
                        {result.project.split("/").pop() || result.project}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600 capitalize">
                      {result.source}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-1 break-words mb-1">
                    {result.display}
                  </p>
                  <p
                    className="text-[11px] text-zinc-500 dark:text-zinc-500 leading-snug line-clamp-2 break-words [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-500/30 [&_mark]:text-zinc-900 dark:[&_mark]:text-zinc-100 [&_mark]:rounded-sm [&_mark]:px-0.5"
                    dangerouslySetInnerHTML={{ __html: result.snippet }}
                  />
                </button>
              ))}
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
              return (
                <button
                  key={session.id}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  onClick={() => onSelectSession(session.id)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                  className={`px-3 py-3.5 text-left transition-colors overflow-hidden border-b border-zinc-200/60 dark:border-zinc-800/40 ${
                    selectedSession === session.id
                      ? "bg-cyan-100 dark:bg-cyan-700/30"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  } ${virtualItem.index === 0 ? "border-t border-t-zinc-200/60 dark:border-t-zinc-800/40" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${SOURCE_COLORS[session.source]}`} />
                      <span className="text-[10px] text-zinc-500 font-medium">
                        {session.projectName}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
                      {formatTime(session.timestamp)}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-700 dark:text-zinc-300 leading-snug line-clamp-2 break-words">
                    {session.display}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800/60">
        <div className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center">
          {showSearchResults
            ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""}`
            : `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`
          }
        </div>
      </div>
    </div>
  );
});

export default SessionList;
