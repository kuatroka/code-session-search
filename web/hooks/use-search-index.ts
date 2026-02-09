import { useState, useEffect, useRef, useCallback } from "react";
import { initSQLite, useMemoryStorage } from "@subframe7536/sqlite-wasm";

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

type RunFn = (sql: string, params?: (string | number | null)[]) => Promise<Record<string, unknown>[]>;

const WASM_URL = "https://cdn.jsdelivr.net/gh/subframe7536/sqlite-wasm@v0.5.0/wa-sqlite-fts5/wa-sqlite.wasm";

async function initDb(): Promise<RunFn> {
  const { run } = await initSQLite(useMemoryStorage({ url: WASM_URL }));

  await run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      source UNINDEXED,
      display,
      project,
      content,
      session_timestamp UNINDEXED,
      tokenize='porter unicode61'
    )
  `);

  return run as RunFn;
}

async function populateIndex(run: RunFn, entries: SearchIndexEntry[]): Promise<void> {
  await run("DELETE FROM sessions_fts");
  for (const e of entries) {
    await run(
      "INSERT INTO sessions_fts (session_id, source, display, project, content, session_timestamp) VALUES (?, ?, ?, ?, ?, ?)",
      [e.id, e.source, e.display, e.project, e.content, e.timestamp]
    );
  }
}

async function upsertEntry(run: RunFn, e: SearchIndexEntry): Promise<void> {
  await run("DELETE FROM sessions_fts WHERE session_id = ?", [e.id]);
  await run(
    "INSERT INTO sessions_fts (session_id, source, display, project, content, session_timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    [e.id, e.source, e.display, e.project, e.content, e.timestamp]
  );
}

function buildFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(Boolean) || [];

  if (tokens.length === 0) {
    const fallback = query.trim();
    return fallback ? `"${fallback.replace(/"/g, '""')}"` : "";
  }

  return tokens.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");
}

export function useSearchIndex() {
  const [ready, setReady] = useState(false);
  const runRef = useRef<RunFn | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const run = await initDb();
        if (cancelled) return;
        runRef.current = run;

        const res = await fetch("/api/search-index");
        const data: SearchIndexEntry[] = await res.json();
        if (cancelled) return;

        await populateIndex(run, data);
        if (cancelled) return;
        setReady(true);
      } catch (err) {
        console.error("Search index init failed:", err);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // SSE content updates
  useEffect(() => {
    if (!ready) return;

    const es = new EventSource("/api/sessions/stream");

    es.addEventListener("contentUpdate", async (event) => {
      const update: SearchIndexEntry = JSON.parse(event.data);
      if (runRef.current) {
        try {
          await upsertEntry(runRef.current, update);
        } catch { /* ignore */ }
      }
    });

    return () => es.close();
  }, [ready]);

  const search = useCallback(async (query: string, source?: string | null): Promise<ClientSearchResult[]> => {
    const run = runRef.current;
    if (!run || !query.trim()) return [];

    const ftsQuery = buildFtsQuery(query);

    let sql = `
      SELECT
        session_id as sessionId,
        source,
        display,
        project,
        snippet(sessions_fts, -1, '<mark class="search-highlight">', '</mark>', '...', 24) as snippet,
        CAST(session_timestamp AS TEXT) as timestamp,
        bm25(sessions_fts, 0, 0, 5.0, 3.0, 10.0, 0) as rank
      FROM sessions_fts
      WHERE sessions_fts MATCH ?
    `;
    const params: (string | number | null)[] = [ftsQuery];

    if (source) {
      sql += " AND source = ?";
      params.push(source);
    }

    sql += " ORDER BY rank LIMIT 50";

    try {
      const rows = await run(sql, params);
      return rows.map((r) => ({
        sessionId: String(r.sessionId),
        source: String(r.source),
        display: String(r.display),
        project: String(r.project),
        snippet: String(r.snippet),
        timestamp: Number(r.timestamp) || 0,
      }));
    } catch {
      return [];
    }
  }, []);

  return { search, ready };
}
