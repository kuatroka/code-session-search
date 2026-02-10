import { initSQLite, useMemoryStorage } from "@subframe7536/sqlite-wasm";
import { FTS_TOKENIZER, buildFtsQuery, rerankSearchRows } from "../hooks/search-ranking";

// --- Types ---

interface SearchIndexEntry {
  id: string;
  source: string;
  display: string;
  project: string;
  content: string;
  timestamp: number;
}

interface ClientSearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  timestamp: number;
}

type RunFn = (sql: string, params?: (string | number | null)[]) => Promise<Record<string, unknown>[]>;

// --- Worker messages ---

type IncomingMessage =
  | { type: "init"; entries: SearchIndexEntry[] }
  | { type: "search"; id: number; query: string; source?: string | null }
  | { type: "upsert"; entry: SearchIndexEntry };

type OutgoingMessage =
  | { type: "ready" }
  | { type: "results"; id: number; results: ClientSearchResult[] }
  | { type: "error"; message: string };

// --- DB operations ---

const WASM_URL = "https://cdn.jsdelivr.net/gh/subframe7536/sqlite-wasm@v0.5.0/wa-sqlite-fts5/wa-sqlite.wasm";

let run: RunFn | null = null;

async function initDb(): Promise<RunFn> {
  const { run: runFn } = await initSQLite(useMemoryStorage({ url: WASM_URL }));

  await runFn(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      source UNINDEXED,
      display,
      project,
      content,
      session_timestamp UNINDEXED,
      tokenize='${FTS_TOKENIZER}'
    )
  `);

  return runFn as RunFn;
}

async function populateIndex(runFn: RunFn, entries: SearchIndexEntry[]): Promise<void> {
  await runFn("DELETE FROM sessions_fts");
  await runFn("BEGIN");
  try {
    for (const e of entries) {
      await runFn(
        "INSERT INTO sessions_fts (session_id, source, display, project, content, session_timestamp) VALUES (?, ?, ?, ?, ?, ?)",
        [e.id, e.source, e.display, e.project, e.content, e.timestamp]
      );
    }
    await runFn("COMMIT");
  } catch (err) {
    await runFn("ROLLBACK");
    throw err;
  }
}

async function upsertEntry(runFn: RunFn, e: SearchIndexEntry): Promise<void> {
  await runFn("DELETE FROM sessions_fts WHERE session_id = ?", [e.id]);
  await runFn(
    "INSERT INTO sessions_fts (session_id, source, display, project, content, session_timestamp) VALUES (?, ?, ?, ?, ?, ?)",
    [e.id, e.source, e.display, e.project, e.content, e.timestamp]
  );
}

async function searchIndex(runFn: RunFn, query: string, source?: string | null): Promise<ClientSearchResult[]> {
  if (!query.trim()) return [];

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

  sql += " ORDER BY rank LIMIT 120";

  try {
    const rows = await runFn(sql, params);
    const rankedRows = rows.map((r) => ({
      sessionId: String(r.sessionId),
      source: String(r.source),
      display: String(r.display),
      project: String(r.project),
      snippet: String(r.snippet),
      timestamp: Number(r.timestamp) || 0,
      rank: Number(r.rank) || 0,
      searchText: `${String(r.display)}\n${String(r.project)}\n${String(r.snippet)}`,
    }));

    return rerankSearchRows(rankedRows, query)
      .slice(0, 50)
      .map(({ rank: _rank, searchText: _searchText, ...result }) => result);
  } catch {
    return [];
  }
}

// --- Message handler ---

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "init": {
        run = await initDb();
        await populateIndex(run, msg.entries);
        (self as unknown as Worker).postMessage({ type: "ready" } satisfies OutgoingMessage);
        break;
      }

      case "search": {
        if (!run) {
          (self as unknown as Worker).postMessage({ type: "results", id: msg.id, results: [] } satisfies OutgoingMessage);
          return;
        }
        const results = await searchIndex(run, msg.query, msg.source);
        (self as unknown as Worker).postMessage({ type: "results", id: msg.id, results } satisfies OutgoingMessage);
        break;
      }

      case "upsert": {
        if (run) {
          await upsertEntry(run, msg.entry);
        }
        break;
      }
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies OutgoingMessage);
  }
};
