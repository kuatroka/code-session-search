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
}

let db: Database | null = null;

export function initSearchDb(): void {
  const dbDir = join(homedir(), ".claude-run");
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
}

export function indexSession(
  sessionId: string,
  source: string,
  display: string,
  project: string,
  content: string
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
    "INSERT OR REPLACE INTO session_index_meta (session_id, source, last_indexed_at) VALUES (?, ?, ?)",
    [sessionId, source, Date.now()]
  );
}

export function searchSessions(query: string, source?: string): SearchResult[] {
  if (!db || !query.trim()) return [];

  const ftsQuery = query
    .trim()
    .split(/\s+/)
    .map((w) => `"${w.replace(/"/g, '""')}"`)
    .join(" ");

  let sql = `
    SELECT session_id as sessionId, source, display, project,
           snippet(sessions_fts, 4, '<mark>', '</mark>', '...', 40) as snippet,
           rank
    FROM sessions_fts
    WHERE sessions_fts MATCH ?
  `;
  const params: string[] = [ftsQuery];

  if (source) {
    sql += " AND source = ?";
    params.push(source);
  }

  sql += " ORDER BY rank LIMIT 50";

  try {
    return db.query(sql).all(...params) as SearchResult[];
  } catch {
    return [];
  }
}

export function isSessionIndexed(sessionId: string): boolean {
  if (!db) return false;
  const result = db.query(
    "SELECT 1 FROM session_index_meta WHERE session_id = ?"
  ).get(sessionId);
  return !!result;
}

export function closeSearchDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
