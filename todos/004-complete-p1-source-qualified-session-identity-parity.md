---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, architecture, reliability, multi-source, streaming]
dependencies: []
---

# Source-qualified session identity is incomplete outside search path

## Problem Statement
The merge fixed source-qualified identity in search indexing, but the rest of the app still treats `session.id` as globally unique in multiple backend and frontend flows. In a multi-source environment (`claude`, `factory`, `codex`, `pi`), this can merge/overwrite unrelated sessions when IDs collide.

This is a correctness issue that can lead to selecting, updating, or deleting the wrong session in UI state.

## Findings
- Backend storage still dedupes by `session.id` only:
  - `api/storage.ts` → `dedupeSessionsByLatestTimestamp()` uses `Map<string, Session>` keyed by `session.id`.
- Frontend session update state also keys by `id` only:
  - `web/app.tsx` → `handleSessionsUpdate()` uses `new Map(prev.map((s) => [s.id, s]))`.
- Selected session identity in UI is `string | null` id-only:
  - `web/app.tsx` → `selectedSession` and lookups based on `s.id === selectedSession`.
- Sidebar rendering logic compares selected row by id-only:
  - `web/components/session-list.tsx` → `selectedSession === session.id` and `selectedSession === result.sessionId`.
- Server-side stream tracking maps by id-only:
  - `api/server.ts` → `knownSessions = new Map<string, number>()` and reindex `sessionMap` keyed by `s.id`.

Impact: even though search layer now supports source-qualified identity, list/selection/streaming paths can still collapse two sessions with same id from different sources.

## Proposed Solutions

### Option 1: Full source-qualified identity rollout (recommended)

**Approach:** Introduce a composite identity key (`${source}:${id}`) across backend+frontend session state, streaming maps, and selection state while preserving id/source fields separately.

**Pros:**
- Correctness across all data paths
- Aligns with completed search-side identity hardening
- Prevents regressions from future source additions

**Cons:**
- Requires coordinated API/UI state updates
- Potential migration of component props and memo keys

**Effort:** 4-8 hours

**Risk:** Medium

---

### Option 2: Keep id-only in UI, enforce global uniqueness at ingestion

**Approach:** Rewrite/namespace incoming IDs per source at storage load time.

**Pros:**
- Smaller frontend changes
- Centralized transformation

**Cons:**
- Hidden coupling and implicit mutation
- Harder to reason about original session IDs
- Risk of breaking resume/delete APIs expecting raw IDs

**Effort:** 3-5 hours

**Risk:** High

---

### Option 3: Partial patch of only known collisions

**Approach:** Patch only affected maps (`handleSessionsUpdate`, `dedupeSessionsByLatestTimestamp`) without changing selection model.

**Pros:**
- Fast mitigation

**Cons:**
- Leaves latent bugs in selection/model-fetch/delete UX
- Incomplete and likely to regress

**Effort:** 1-2 hours

**Risk:** High

## Recommended Action

## Technical Details

**Affected files:**
- `api/storage.ts`
- `api/server.ts`
- `web/app.tsx`
- `web/components/session-list.tsx`
- (possibly) `web/components/session-view.tsx` for selection semantics

**Related components:**
- SSE session stream updates
- Search/list synchronization
- Session delete/model fetch actions

**Database changes (if any):**
- No DB migration expected for this specific parity fix

## Resources
- **Commit context:** `49e6ba1` (search-side source-qualified fixes)
- **Recent UI fix:** `2053eaa` (delete action restoration)
- **Related todo:** `todos/002-complete-p2-session-id-collision-across-sources.md` (search path only)

## Acceptance Criteria
- [x] Session identity in app state is source-qualified end-to-end
- [x] Two sessions with same `id` but different `source` can coexist in list/search/selection
- [x] Stream updates do not overwrite cross-source sessions
- [x] Delete action removes exactly one (`source`, `id`) tuple
- [x] Regression tests cover cross-source same-id scenarios in storage + app state transforms

## Work Log

### 2026-02-11 - Code review finding

**By:** Claude Code

**Actions:**
- Reviewed post-merge path for identity handling across storage/server/ui
- Verified source qualification exists in search but not in session/list/selection maps
- Documented impacted files and rollout options

**Learnings:**
- Merge resolved search collisions but not full app identity parity

### 2026-02-11 - Resolution implemented

**By:** Claude Code

**Actions:**
- Implemented source-qualified identity across storage/session dedupe, server streaming maps, and frontend session selection/update paths
- Added source query propagation for conversation/model streaming endpoints
- Updated sidebar/search row selection and per-session model fetch to use composite key (`source:id`)
- Added regression test for same id across different sources in `api/storage.test.ts`

**Learnings:**
- Search-side identity hardening must be mirrored in app state + API access paths to avoid subtle cross-source collisions

## Notes
- Completed and verified via tests/build/typecheck.
