import { useState, useEffect, useRef, useCallback } from "react";

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

let searchIdCounter = 0;

export function useSearchIndex() {
  const [ready, setReady] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pendingSearches = useRef<Map<number, (results: ClientSearchResult[]) => void>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const worker = new Worker(
      new URL("../workers/search-worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "ready") {
        if (!cancelled) setReady(true);
      } else if (msg.type === "results") {
        const resolver = pendingSearches.current.get(msg.id);
        if (resolver) {
          resolver(msg.results);
          pendingSearches.current.delete(msg.id);
        }
      } else if (msg.type === "error") {
        console.error("Search worker error:", msg.message);
      }
    };

    // Fetch index data on main thread (network), then send to worker for processing
    (async () => {
      try {
        const res = await fetch("/api/search-index");
        const data: SearchIndexEntry[] = await res.json();
        if (cancelled) return;
        worker.postMessage({ type: "init", entries: data });
      } catch (err) {
        console.error("Search index fetch failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      worker.terminate();
      workerRef.current = null;
      pendingSearches.current.clear();
    };
  }, []);

  const search = useCallback(async (query: string, source?: string | null): Promise<ClientSearchResult[]> => {
    const worker = workerRef.current;
    if (!worker || !query.trim()) return [];

    const id = ++searchIdCounter;

    return new Promise<ClientSearchResult[]>((resolve) => {
      // Cancel any older pending searches — they're stale
      for (const [oldId, oldResolver] of pendingSearches.current) {
        if (oldId < id) {
          oldResolver([]);
          pendingSearches.current.delete(oldId);
        }
      }

      pendingSearches.current.set(id, resolve);
      worker.postMessage({ type: "search", id, query, source });

      // Safety timeout — don't hang forever
      setTimeout(() => {
        if (pendingSearches.current.has(id)) {
          pendingSearches.current.delete(id);
          resolve([]);
        }
      }, 5000);
    });
  }, []);

  const upsertEntry = useCallback((entry: SearchIndexEntry) => {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: "upsert", entry });
    }
  }, []);

  return { search, ready, upsertEntry };
}
