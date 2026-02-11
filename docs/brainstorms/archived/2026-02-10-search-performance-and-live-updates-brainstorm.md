---
date: 2026-02-10
topic: search-performance-and-live-updates
---

# Fix Search Jank, Live Updates, Then Experiment with DuckDB

## What We're Building

Two immediate fixes to make claude-run feel instant and reliable, followed by a DuckDB experiment:

1. **Buttery smooth search** — Move the in-browser SQLite WASM search off the main thread into a Web Worker, add 200ms debounce on input. Search results appear after the user pauses typing — no jank, no UI freezes.

2. **Reliable live session updates** — Fix the existing SSE watcher pipeline so sessions in progress appear in the app without manual refresh. The infrastructure exists (`api/watcher.ts`, SSE streaming) but sessions aren't surfacing reliably.

3. **DuckDB experiment (after fixes)** — Once the baseline is solid, experiment with DuckDB (server-side or WASM) to evaluate its performance characteristics for future projects and potential analytics features (model/coder performance tracking, usage patterns).

## Why This Approach

We considered three options:
- **Option 1 (chosen): Fix first, experiment later** — Addresses the actual UX problems (main-thread blocking, watcher bugs) before introducing a new technology. Ensures the experiment has a clean baseline to compare against.
- **Option 2: Replace SQLite with DuckDB directly** — Risky. The search jank is an architecture problem (main thread), not a database problem. Switching engines without fixing the architecture would still be janky.
- **Option 3: Hybrid (server SQLite + client DuckDB)** — Interesting but premature. Better to fix the real issues first.

The search jank root cause is **architectural, not engine-related**: the FTS5 query runs on the browser's main UI thread, blocking rendering on every keystroke. Any database engine would be equally janky in this position. The fix is a Web Worker.

## Key Decisions

- **Web Worker for search**: All SQLite WASM initialization, index building, and query execution moves into a dedicated Web Worker (`search-worker.ts`). The main thread only sends messages and renders results. Zero UI blocking.
- **200ms debounce on search input**: Results appear after the user pauses typing for 200ms (search-on-pause pattern). No mid-typing updates. Guaranteed smooth.
- **Fix live updates before DuckDB**: The SSE/watcher pipeline (`api/watcher.ts` → `server.ts` SSE events → client) needs debugging. Sessions in progress must appear without manual refresh.
- **DuckDB is Phase 2**: Only after search and live updates are solid. Experiment scope: evaluate DuckDB for server-side search and/or potential analytics features. Not a replacement — a comparison.
- **Local-first, no bundle size concern**: User confirmed WASM bundle size is not a constraint since this is a local app, not a web app.

## Open Questions

- What exactly is broken in the watcher/SSE pipeline for live updates? Needs investigation during planning.
- For the DuckDB experiment: server-side only, or also WASM? Decide after Phase 1 is complete.
- Analytics features (model performance, token usage trends) — scope TBD, but DuckDB's columnar engine would genuinely shine here vs SQLite.
- Should the Web Worker also handle index building (currently blocks main thread on initial load)?

## Next Steps

→ `/workflows:plan` for implementation details — Phase 1: Web Worker + debounce + live update fix
