# Server-Primary Hybrid Search Design (Bun SQLite FTS5 + FlexSearch)

Date: 2026-02-09  
Status: Validated design (brainstormed)

## 1) Goals and Constraints

### Priorities
1. **Immediate availability of session data** across all coding agents (Claude, Codex, Factory, and Pi).
2. **Instantaneous search** with strong recall and no silent omissions.

### Non-priorities
- Cold-start index build time is acceptable in this local app.
- Initial multi-second indexing is acceptable if UX clearly communicates partial coverage.

### Key UX requirement
- Progressive mode: search is available immediately, but response must explicitly indicate when indexing is partial.

---

## 2) Final Decisions

1. **Search becomes server-primary** (Bun SQLite FTS5 is authoritative).
2. **Hybrid retrieval contract**: exact + fuzzy union.
   - SQLite FTS5 handles exact/token/phrase retrieval.
   - FlexSearch sidecar adds typo/near-match recall.
3. **Exact-first ranking tiers**:
   - Tier 1: exact literal / exact phrase
   - Tier 2: exact token matches
   - Tier 3: fuzzy-only matches
4. Add **Pi source** with sessions at:
   - `/Users/yo_macbook/.pi/agent/sessions`
5. Model metadata is extracted and shown in **session/message UI only**.
   - No model-based search filtering/facets.

---

## 3) Why Not DuckDB as Primary Search (Now)

DuckDB/WASM can read JSONL and works well with Arrow IPC, but this application’s core workload is:
- frequent incremental upserts from file watchers,
- interactive low-latency text search,
- deterministic exact retrieval with typo fallback.

SQLite FTS5 is a stronger fit for that interaction pattern, and Bun SQLite is mature and already available in-runtime. DuckDB remains a good candidate for future analytics workloads, but not the best risk/performance trade for primary interactive search at this stage.

---

## 4) Architecture Overview

### 4.1 Source Adapter Layer
Create adapters with a shared interface:
- `discoverSessions()`
- `readConversation(sessionId)`
- `watchRoots()`
- `extractModelMetadata()`

Sources:
- Claude: `~/.claude`
- Factory: `~/.factory`
- Codex: `~/.codex`
- **Pi: `~/.pi/agent/sessions`**

### 4.2 Canonical Content Pipeline
For each session:
1. Parse source-specific message format.
2. Normalize to unified internal message model.
3. Apply sanitization parity (index text == visible text policy).
4. Produce canonical searchable text blob.

### 4.3 Indexes
- **SQLite FTS5**: authoritative exact index + snippets + BM25
- **FlexSearch**: fuzzy sidecar, in-memory
- **Meta tables**: indexed state, timestamps, content hash, per-source coverage

---

## 5) API Contract

## `GET /api/search`
Params:
- `q` (required)
- `source` (optional)
- `limit` (default 50)
- `fuzzy=1` (default on)
- `requireComplete=0|1` (default 0)

Response:
- `partial: boolean`
- `coverage: { indexedSessions, totalSessions, bySource, lastUpdatedAt }`
- `results[]` with:
  - `sessionId, source, display, project, timestamp, snippet`
  - `tier: 1|2|3`
  - `signals: { exactLiteral, exactPhrase, exactTokens, fuzzy }`
  - `score`

If `requireComplete=1` and index is incomplete, return `409` with coverage payload.

---

## 6) Query Execution Pipeline

1. Normalize incoming query.
2. Run SQLite FTS query (candidate set + snippet + BM25).
3. Run FlexSearch fuzzy query on same corpus.
4. Union on `sessionId`, dedupe hard.
5. Compute tier signals.
6. Sort exact-first by tier, then rank/score/time.
7. Return top N.

Guarantee: fuzzy cannot suppress exact matches; exact always ranks above fuzzy-only.

---

## 7) Freshness and Progressive Indexing

### Startup
- Build session catalog quickly.
- Mark total sessions immediately.
- Start background indexing in batches.
- Search endpoint available immediately with `partial=true` until complete.

### Live updates
- Watcher events mark sessions dirty.
- Debounced dirty queue processes batch upserts.
- SQLite + FlexSearch updated in one logical step per session.
- Coverage counters updated continuously.

---

## 8) Model Metadata (UI Only)

Store model metadata per session and per message turn.

### Pi extraction (high confidence)
Pi JSONL provides explicit fields:
- `type: "model_change"` with `provider`, `modelId`
- assistant message with `provider`, `model`, `api`, `usage`

### Other sources
- Claude: usually explicit model in assistant payload.
- Codex: derive from turn/session metadata where available.
- Factory: best-effort; may be inferred from context text.

Track confidence:
- `explicit | derived | unknown`

UI behavior:
- Session header may show latest known model/provider.
- Message rows show per-turn model/provider when available.
- No model filter in search UI.

---

## 9) Error Handling

1. **Source isolation**: parse failure in one source/session never blocks others.
2. **Truthful completeness**: incomplete indexing always reflected via `partial + coverage`.
3. **Retry policy**: dirty upsert failures retried with bounded backoff.
4. **Rebuild safety**: versioned schema + full rebuild command for recovery.
5. **Fallback behavior**: if fuzzy sidecar fails, exact SQLite search still serves results.

---

## 10) Testing Plan

1. **Adapter fixtures**
   - Claude/Codex/Factory/Pi parsing and canonicalization.
2. **Ranking tests**
   - exact literal/phrase > token exact > fuzzy-only.
3. **Coverage tests**
   - startup partial semantics and transition to complete.
4. **Freshness tests**
   - watcher event to searchable content latency.
5. **UI metadata tests**
   - model chips render with confidence states.

---

## 11) Rollout Plan

1. Introduce server-primary `/api/search` behind feature flag.
2. Keep current client path as temporary fallback.
3. Enable hybrid retrieval and compare relevance/latency locally.
4. Remove client-side wa-sqlite primary path once parity is confirmed.
5. Add Pi adapter and UI model metadata rendering.

---

## 12) Acceptance Criteria

- Search is usable immediately after startup, with explicit partial-state signaling.
- No silent omissions: incompleteness is always disclosed in response/UI.
- Exact matches are never outranked by fuzzy-only results.
- Pi sessions are discoverable, indexable, and searchable.
- Model/provider metadata appears in session/message UI where available.
- Session/content refresh behavior is at least as fresh as current implementation.
