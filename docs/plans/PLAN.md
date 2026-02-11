---
date: 2026-02-10
status: active
supersedes:
  - 2026-02-09-server-primary-hybrid-search-design.md (archived)
  - 2026-02-09-client-side-search-design.md (archived)
  - 2026-02-09-multi-source-lightmode-fts.md (archived)
  - ../brainstorms/2026-02-10-search-performance-and-live-updates-brainstorm.md (archived)
---

# Claude Run Plus — Unified Plan

## What's Already Shipped

- ✅ Bun runtime migration
- ✅ Multi-source sessions: Claude, Factory, Codex, Pi
- ✅ Pi source adapter (`~/.pi/agent/sessions`)
- ✅ Model metadata display (session header + per-message)
- ✅ Light/dark theme toggle
- ✅ Server-side SQLite FTS5 search (`api/search.ts`)
- ✅ Client-side wa-sqlite FTS5 search (`web/hooks/use-search-index.ts`)
- ✅ Keyboard navigation (↑↓, Enter, Escape, "/" shortcut)
- ✅ Source filter buttons
- ✅ Resume command per source
- ✅ Search snippet highlighting
- ✅ Exact phrase boost in ranking

---

## Phase 1: Fix Search Jank & Live Updates

**Priority: Highest. These are the two real UX problems.**

### 1A. Web Worker for Search (fixes jank)

**Problem:** `use-search-index.ts` runs `initSQLite()`, `populateIndex()`, and every `search()` call on the main UI thread — blocking rendering on every keystroke.

**Root cause files:**
- `web/hooks/use-search-index.ts:31` — `initDb()` fetches WASM + creates FTS table on main thread
- `web/hooks/use-search-index.ts:50` — `populateIndex()` inserts hundreds of rows on main thread
- `web/hooks/use-search-index.ts:87` — `search()` runs FTS5 query + reranking on main thread
- `web/components/session-list.tsx:36` — `useEffect` fires search immediately on every `search` state change (no debounce)

**Solution:** Move all SQLite WASM work into a dedicated Web Worker.

**New file: `web/workers/search-worker.ts`**
- Moves: `initDb()`, `populateIndex()`, `upsertEntry()`, and the `search()` query logic
- Imports `search-ranking.ts` functions (pure functions, no DOM — safe in worker)
- Message protocol:
  - `{ type: 'init', entries: SearchIndexEntry[] }` → init DB + populate index → `{ type: 'ready' }`
  - `{ type: 'search', id: number, query: string, source?: string }` → run FTS5 → `{ type: 'results', id: number, results: ClientSearchResult[] }`
  - `{ type: 'upsert', entry: SearchIndexEntry }` → upsert single entry → no response needed
- The `id` field on search messages enables cancelling stale queries (only render the latest)

**Modified file: `web/hooks/use-search-index.ts`**
- Becomes a thin wrapper around the Worker
- `useEffect` on mount: create Worker via `new Worker(new URL('../workers/search-worker.ts', import.meta.url), { type: 'module' })`
- Fetch `/api/search-index` on main thread, then `postMessage({ type: 'init', entries })` to worker
- `search()` sends `postMessage({ type: 'search', ... })`, returns Promise resolved by `onmessage` handler
- SSE `contentUpdate` events forwarded to worker via `postMessage({ type: 'upsert', entry })`
- Vite handles worker bundling natively — no config changes needed

**Acceptance:**
- [ ] SQLite WASM never loads on main thread
- [ ] `populateIndex` never blocks main thread
- [ ] Search queries never block main thread
- [ ] Index building shows "Indexing..." state, transitions to "Search..." when ready

### 1B. 200ms Debounce (search-on-pause)

**Problem:** No debounce — every keystroke triggers a search query immediately.

**Modified file: `web/components/session-list.tsx`**
- Replace the `useEffect` at line 36 with a 200ms debounced version:
  ```
  useEffect(() => {
    if (!search.trim() || !searchReady) { setSearchResults(null); return; }
    const timer = setTimeout(() => {
      clientSearch(search, selectedSource).then(results => { ... });
    }, 200);
    return () => clearTimeout(timer);
  }, [search, selectedSource, searchReady, clientSearch]);
  ```
- While debounce is pending, optionally show a subtle loading indicator (or just keep previous results visible)

**Acceptance:**
- [ ] Typing/deleting characters feels instant — no frame drops
- [ ] Results appear ~200ms after user stops typing
- [ ] Rapid typing doesn't queue up stale queries

### 1C. Fix Live Session Updates

**Problem:** Sessions in progress don't appear without manual page refresh.

**Bugs found in code review:**

**Bug 1 — Silent drop of new sessions** (`api/server.ts:100-112`)
The SSE `handleContentChange` calls `getSessions()` to find the session. For NEW sessions, `history.jsonl` hasn't been updated yet → `sessions.find()` returns `undefined` → contentUpdate event is never emitted. The session JSONL file is written before history.jsonl, so the watcher fires `sessionChange` before the session is discoverable via history.

*Fix:* In `handleContentChange`, if session not found in `getSessions()`, fall back to building a minimal session object from the file index entry (sessionId, source, filePath). Or: also emit `sessionsUpdate` from `onSessionChange`, not just from `onHistoryChange`.

**Bug 2 — Pi sessions not watched** (`api/watcher.ts:68-77`)
`startWatcher()` only watches Claude, Factory, Codex directories. Pi sessions at `~/.pi/agent/sessions` are never watched.

*Fix:* Add Pi session directory to `initWatcher()` and `startWatcher()` watch paths. Add Pi detection in `detectSource()`.

**Bug 3 — Duplicate SSE connections** (`web/hooks/use-search-index.ts:82-93`)
`use-search-index.ts` opens its own `new EventSource("/api/sessions/stream")` for `contentUpdate` events. `app.tsx` already opens one via `useEventSource`. Two SSE connections to the same endpoint.

*Fix:* Remove the standalone EventSource from `use-search-index.ts`. Instead, have `app.tsx` listen for `contentUpdate` events on its existing SSE connection and forward them to the search index (via a callback prop or a shared event bus). Or: expose an `upsertEntry` method from `useSearchIndex` and call it from `app.tsx`'s SSE handler.

**Bug 4 — `handleHistoryChange` is async but fires from watcher** (`api/server.ts:75-98`)
When history.jsonl changes, `handleHistoryChange` calls `await getSessions()` which re-reads history. But if the watcher fires before Claude Code finishes writing the file, we get truncated data. The 20ms debounce in `watcher.ts` may not be enough.

*Fix:* Increase watcher debounce for history files to 100ms. Or: add a retry — if `getSessions()` returns the same count as before, retry after 200ms.

**Modified files:**
- `api/watcher.ts` — add Pi watch path, increase history debounce
- `api/server.ts` — fix handleContentChange to not silently drop new sessions
- `web/hooks/use-search-index.ts` — remove duplicate EventSource
- `web/app.tsx` — forward contentUpdate events to search index

**Acceptance:**
- [ ] New sessions appear in the sidebar within ~1 second of creation
- [ ] Session content updates (new messages) appear without refresh
- [ ] Pi sessions update live like other sources
- [ ] Only one SSE connection from the browser

---

## Phase 2: Search Quality Improvements

### 2A. FlexSearch Fuzzy Sidecar

**Problem:** FTS5 only matches exact tokens. Typos like "recact" won't find "react".

**Solution:** Add FlexSearch as a fuzzy search sidecar alongside SQLite FTS5.

- Install `flexsearch`
- Build FlexSearch index in the same Web Worker alongside wa-sqlite
- Query pipeline: run FTS5 (exact) + FlexSearch (fuzzy) in parallel, union results
- Tiered ranking:
  - Tier 1: Exact literal / exact phrase matches
  - Tier 2: Exact token matches (FTS5 BM25)
  - Tier 3: Fuzzy-only matches (FlexSearch)
- Guarantee: fuzzy results never outrank exact matches

### 2B. Improved Ranking

- Exact literal match (full query string found verbatim) → highest boost
- Exact phrase match (tokens in order) → high boost
- Token matches → BM25 score
- Fuzzy matches → lowest tier
- Within same tier: sort by timestamp (most recent first)

---

## Phase 3: DuckDB Experiment

**Problem:** Want to evaluate DuckDB for future projects and potential analytics features.

**Approach:** Only after Phases 1-3 are solid. Not a replacement — a comparison.

**Experiment scope:**
- Try DuckDB server-side for search and compare latency vs bun:sqlite FTS5
- Try DuckDB WASM in the Web Worker and compare vs wa-sqlite
- Evaluate for analytics workloads: token usage trends, model performance tracking, session statistics
- DuckDB's columnar engine genuinely shines for aggregation queries that SQLite struggles with
- Document findings for future project decisions

**Not in scope:** Replacing the working SQLite pipeline unless DuckDB proves measurably faster for interactive search.

---

## Architecture Overview

### Source Adapter Pattern

Each source implements a shared interface:
- `discoverSessions()` — scan directory, build file index
- `readConversation(sessionId)` — parse JSONL to `ConversationMessage[]`
- `watchRoots()` — directories to monitor for changes
- `extractModelMetadata()` — source-specific model/provider extraction

Sources: Claude (`~/.claude`), Factory (`~/.factory`), Codex (`~/.codex`), Pi (`~/.pi/agent/sessions`)

### Search Architecture (after Phase 1+2)

```
Main Thread (UI)                     Web Worker
─────────────────                    ──────────────────────
User types query                     
  → 200ms debounce                   
  → postMessage(query)  ──────────→  wa-sqlite FTS5 query
  UI stays smooth                    FlexSearch fuzzy query
                                     Union + tier ranking
  ← postMessage(results) ←────────  Return top 50
Render results                       
```

### Live Update Pipeline

```
JSONL file changes on disk
  → chokidar watcher detects change (~10ms)
  → invalidate history cache
  → re-index in bun:sqlite FTS5 (server)
  → emit SSE event (sessionsUpdate / contentUpdate)
  → client receives SSE
  → patch in-memory wa-sqlite index (Web Worker)
  → update session list UI
```

---

## API Contract

### `GET /api/search`
- `q` (required) — search query
- `source` (optional) — filter by source
- `limit` (default 50)
- Returns: `{ results[], partial: boolean, coverage: { indexed, total } }`

### `GET /api/search-index`
- Returns full session content for client-side index building
- Used on initial load only

### SSE `/api/sessions/stream`
- `sessions` — initial full session list
- `sessionsUpdate` — new/updated sessions
- `contentUpdate` — session content changed (triggers client re-index)
- `heartbeat` — keepalive every 30s

---

## Decisions Log

| Decision | Rationale |
|----------|-----------|
| Web Worker for search | Main-thread blocking is the root cause of jank, not the DB engine |
| 200ms debounce | Search-on-pause pattern — smooth and feels instant |
| FlexSearch over uFuzzy | Faster for search operations |
| SQLite FTS5 stays primary | Best fit for interactive text search + incremental upserts |
| DuckDB is Phase 3 experiment | Not the right tool for primary search, but worth evaluating for analytics |
| TrailBase not needed | Ingestion is already ~15-20ms; the problem is a watcher/SSE bug, not speed |
| No model-based search filtering | YAGNI — display only, no facets |
| Pi source added | Fourth source alongside Claude, Factory, Codex |

---

## Acceptance Criteria

- [ ] Search input is buttery smooth — zero jank when typing or deleting characters
- [ ] Sessions in progress appear in the app within ~1 second without manual refresh
- [ ] Typo tolerance: "recact" finds sessions about "react"
- [ ] Exact matches always rank above fuzzy-only matches
- [x] Pi sessions are discoverable, searchable, and resumable
- [x] Model/provider metadata visible in session header and per-message
- [ ] DuckDB experiment documented with latency comparisons
