import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";

export interface SearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  rank: number;
  timestamp: number;
}

let db: Database | null = null;

export function initSearchDb(): void {
  const dbDir = join(homedir(), ".claude-run-plus");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(join(dbDir, "search.db"));
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA synchronous=NORMAL");

  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      session_id UNINDEXED,
      source UNINDEXED,
      display,
      project,
      content,
      tokenize='porter unicode61'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_index_meta (
      session_id TEXT PRIMARY KEY,
      source TEXT,
      last_indexed_at INTEGER
    )
  `);

  // Migration: add timestamp column if missing
  const cols = db.query("PRAGMA table_info(session_index_meta)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "session_timestamp")) {
    db.run("ALTER TABLE session_index_meta ADD COLUMN session_timestamp INTEGER DEFAULT 0");
  }
}

export function indexSession(
  sessionId: string,
  source: string,
  display: string,
  project: string,
  content: string,
  timestamp?: number
): void {
  if (!db) return;

  const existing = db.query(
    "SELECT session_id FROM session_index_meta WHERE session_id = ?"
  ).get(sessionId) as { session_id: string } | null;

  if (existing) {
    db.run("DELETE FROM sessions_fts WHERE session_id = ?", [sessionId]);
  }

  db.run(
    "INSERT INTO sessions_fts (session_id, source, display, project, content) VALUES (?, ?, ?, ?, ?)",
    [sessionId, source, display, project, content]
  );
  db.run(
    "INSERT OR REPLACE INTO session_index_meta (session_id, source, last_indexed_at, session_timestamp) VALUES (?, ?, ?, ?)",
    [sessionId, source, Date.now(), timestamp || 0]
  );
}

export function searchSessions(query: string, source?: string): SearchResult[] {
  if (!db || !query.trim()) return [];

  const words = query.trim().split(/\s+/);
  const ftsQuery = words
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ");

  const exactPhrase = query.trim().toLowerCase();

  let sql = `
    SELECT f.session_id as sessionId, f.source, f.display, f.project,
           snippet(sessions_fts, 4, '<mark>', '</mark>', '...', 40) as snippet,
           f.rank,
           COALESCE(m.session_timestamp, 0) as timestamp
    FROM sessions_fts f
    LEFT JOIN session_index_meta m ON f.session_id = m.session_id
    WHERE sessions_fts MATCH ?
  `;
  const params: (string | number)[] = [ftsQuery];

  if (source) {
    sql += " AND f.source = ?";
    params.push(source);
  }

  sql += " ORDER BY f.rank LIMIT 100";

  try {
    const results = db.query(sql).all(...params) as SearchResult[];

    // Boost exact phrase matches to the top, then sort by timestamp (most recent first)
    return results
      .map((r) => {
        const content = getIndexedContent(r.sessionId);
        const hasExactPhrase = content?.toLowerCase().includes(exactPhrase);
        return { ...r, _exact: hasExactPhrase ? 1 : 0 };
      })
      .sort((a, b) => {
        if (a._exact !== b._exact) return b._exact - a._exact;
        return b.timestamp - a.timestamp;
      })
      .slice(0, 50)
      .map(({ _exact, ...r }) => r);
  } catch {
    return [];
  }
}

function getIndexedContent(sessionId: string): string | null {
  if (!db) return null;
  try {
    const row = db.query("SELECT content FROM sessions_fts WHERE session_id = ?").get(sessionId) as { content: string } | null;
    return row?.content || null;
  } catch {
    return null;
  }
}

export function isSessionIndexed(sessionId: string): boolean {
  if (!db) return false;
  const result = db.query(
    "SELECT 1 FROM session_index_meta WHERE session_id = ?"
  ).get(sessionId);
  return !!result;
}

const dirtySessionIds = new Set<string>();

export function markSessionDirty(sessionId: string): void {
  dirtySessionIds.add(sessionId);
}

export function getDirtySessions(): string[] {
  const ids = [...dirtySessionIds];
  dirtySessionIds.clear();
  return ids;
}

export function closeSearchDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
