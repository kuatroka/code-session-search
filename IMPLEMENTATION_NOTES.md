# Implementation Notes

## Scope

This document captures the **current state on `main`** and the latest implementation decisions that are already reflected in code.

## Current Architecture Snapshot

### Stack
- **Runtime/backend:** Bun + Hono
- **Frontend:** React 19 + TypeScript + Vite
- **Styling:** Tailwind CSS v4
- **Realtime transport:** SSE (`EventSource`)
- **Search engines present in codebase:**
  - Client: wa-sqlite FTS5 in a Web Worker
  - Server: Bun SQLite FTS index (maintained and queryable via API)

### Session sources
Unified multi-source support is active for:
- `claude`
- `factory`
- `codex`
- `pi`

Source is part of the session model and is surfaced through filters and badges in the UI.

### Realtime model
- `api/watcher.ts` watches Claude/Factory/Codex/Pi paths.
- `api/server.ts` streams updates through:
  - `/api/sessions/stream`
  - `/api/conversation/:id/stream`
- Frontend consumers:
  - `web/hooks/use-event-source.ts`
  - `web/components/session-view.tsx`
  - `web/app.tsx`

## Search: Actual State on Main

Search is currently **client-primary** for interactive UX:
- Frontend fetches `/api/search-index` and initializes wa-sqlite FTS in `web/workers/search-worker.ts`.
- Querying is performed in the worker (not on the main UI thread).
- Live content updates are applied via `contentUpdate` SSE events using worker `upsert`.

Server-side search remains available:
- `api/search.ts` maintains a Bun SQLite FTS index.
- `/api/search` exists and can serve server-ranked results.
- `/api/search-index` supplies full hydrated entries for client worker initialization.

This gives a hybrid-ready shape, while current interactive sidebar search still runs from the worker path.

## Latest Decisions & Fixes (already merged on `main`)

### 1) Search performance and responsiveness
- Moved search execution to a dedicated Web Worker.
- Added 200ms debounce before triggering searches.
- Kept ranking refinements for hyphenated queries (e.g. `wa-sqlite`) via reranking helpers/tests.

### 2) Streaming reliability across all sources
- Enabled live message/session streaming for Factory/Codex/Pi paths (not only Claude-centric flows).
- Increased Bun server `idleTimeout` to `255` to prevent long-lived SSE streams from being dropped.

### 3) Model metadata surfaced end-to-end
- Added per-session model API (`/api/session/:id/model`) and UI display in:
  - Sidebar model badges
  - Header model indicator
- Added model extraction fallbacks:
  - Parse message/model fields from session streams
  - Factory fallback from `settings.json` (`custom:` prefix normalization)
- Added provider derivation heuristics (Anthropic/OpenAI/Google/Codex labels).

### 4) UI/state stability improvements
- Fixed project dropdown behavior and header layout edge cases.
- Prevented runaway re-render/scroll churn from per-row model fetches by batching + caching fetches in session list.

## Operational Notes

### Verification pattern used for these changes
- `bun test`
- `bun run build`
- Manual runtime checks for:
  - SSE continuity
  - model badge/header correctness
  - search responsiveness and snippet relevance

### Repo remotes (current local intent)
- Primary push target is user-owned repo via `origin`.
- Legacy upstream remote was removed from this checkout.

## Known Next Work (tracked, not merged to `main` in this snapshot)

Task tracker context indicates ongoing/parallel work around a stronger server-primary hybrid search rollout. Treat this document as the source of truth for what is currently present on `main`.
