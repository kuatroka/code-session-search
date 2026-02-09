import { useState, useEffect, useRef, useCallback } from "react";
import uFuzzy from "@leeoniya/ufuzzy";

export interface SearchIndexEntry {
  id: string;
  source: string;
  display: string;
  project: string;
  content: string;
  timestamp: number;
}

export interface ClientSearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  timestamp: number;
}

const SNIPPET_RADIUS = 60;

function buildSnippet(content: string, query: string, words: string[]): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Try exact phrase first
  let idx = lowerContent.indexOf(lowerQuery);
  if (idx === -1 && words.length > 0) {
    // Fall back to first word match
    for (const w of words) {
      idx = lowerContent.indexOf(w.toLowerCase());
      if (idx !== -1) break;
    }
  }
  if (idx === -1) idx = 0;

  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(content.length, idx + query.length + SNIPPET_RADIUS);
  let snippet = content.slice(start, end).replace(/\n/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet += "...";

  // Wrap matching words in <mark>
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  snippet = snippet.replace(regex, "<mark>$1</mark>");

  return snippet;
}

export function useSearchIndex() {
  const [ready, setReady] = useState(false);
  const entriesRef = useRef<SearchIndexEntry[]>([]);
  const haystackRef = useRef<string[]>([]);
  const ufRef = useRef<uFuzzy | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Fetch full index in background
  useEffect(() => {
    let cancelled = false;

    fetch("/api/search-index")
      .then((res) => res.json())
      .then((data: SearchIndexEntry[]) => {
        if (cancelled) return;
        entriesRef.current = data;
        haystackRef.current = data.map((e) => `${e.display} ${e.project} ${e.content}`);
        ufRef.current = new uFuzzy({ intraMode: 1, intraIns: 1 });
        setReady(true);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, []);

  // Listen for SSE content updates
  useEffect(() => {
    const es = new EventSource("/api/sessions/stream");
    eventSourceRef.current = es;

    es.addEventListener("contentUpdate", (event) => {
      const update: SearchIndexEntry = JSON.parse(event.data);
      const entries = entriesRef.current;
      const idx = entries.findIndex((e) => e.id === update.id);
      if (idx >= 0) {
        entries[idx] = update;
        haystackRef.current[idx] = `${update.display} ${update.project} ${update.content}`;
      } else {
        entries.push(update);
        haystackRef.current.push(`${update.display} ${update.project} ${update.content}`);
      }
    });

    es.onerror = () => {
      // Reconnect is handled by the browser's built-in EventSource retry
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const search = useCallback((query: string, source?: string | null): ClientSearchResult[] => {
    if (!ufRef.current || !query.trim()) return [];

    const entries = entriesRef.current;
    const haystack = haystackRef.current;
    const words = query.trim().split(/\s+/);
    const exactPhrase = query.trim().toLowerCase();

    // Use uFuzzy for matching
    const [idxs, info, order] = ufRef.current.search(haystack, query.trim());
    if (!idxs || idxs.length === 0) return [];

    // Get ordered indices
    const matchIndices = order ? order.map((o) => idxs[o]) : idxs;

    const results: (ClientSearchResult & { _exact: number })[] = [];

    for (const i of matchIndices) {
      const entry = entries[i];
      if (!entry) continue;
      if (source && entry.source !== source) continue;

      const hasExact = entry.content.toLowerCase().includes(exactPhrase);
      const snippet = buildSnippet(entry.content, query.trim(), words);

      results.push({
        sessionId: entry.id,
        source: entry.source,
        display: entry.display,
        project: entry.project,
        snippet,
        timestamp: entry.timestamp,
        _exact: hasExact ? 1 : 0,
      });

      if (results.length >= 50) break;
    }

    // Exact phrase matches first, then by recency
    results.sort((a, b) => {
      if (a._exact !== b._exact) return b._exact - a._exact;
      return b.timestamp - a.timestamp;
    });

    return results.map(({ _exact, ...r }) => r);
  }, []);

  return { search, ready };
}
