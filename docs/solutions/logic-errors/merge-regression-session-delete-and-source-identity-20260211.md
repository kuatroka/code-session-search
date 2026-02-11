---
module: Session Browser
date: 2026-02-11
problem_type: logic_error
component: assistant
symptoms:
  - "Delete session control disappeared from sidebar rows after merge"
  - "Session state updates used id-only keys, so same session id across different sources could overwrite each other"
  - "Model/conversation fetches could resolve wrong source when ids collide"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [merge-regression, multi-source, session-identity, delete-session, sse, typescript]
---

# Troubleshooting: Merge regression removed delete UI and left partial source-qualified identity

## Problem
After integrating recent search/streaming changes, users lost the session delete button in the sidebar. During follow-up review, a deeper issue was found: source-qualified identity was fixed in search, but not consistently applied across app state and API fetch paths.

## Environment
- Module: Session Browser (multi-source conversation viewer)
- Affected Component: Frontend + API session identity flow
- Date: 2026-02-11

## Symptoms
- No delete icon/action on session rows (normal list and search results).
- In multi-source setups (`claude`, `factory`, `codex`, `pi`), sessions sharing the same `id` could collide in list updates/selection.
- Requests like model/conversation streaming could target wrong source unless explicitly scoped.

## What Didn't Work

**Attempted Solution 1:** Restore only the delete button UI.
- **Why it failed:** It fixed visibility, but did not solve cross-source identity collisions.

**Attempted Solution 2:** Keep source-qualified identity only in search/indexing.
- **Why it failed:** App state (`selectedSession`, session update maps, stream tracking) still used id-only keys, so collisions were still possible.

## Solution
Implemented a full source-qualified rollout in UI and API access paths, then re-validated TypeScript quality gates.

**Key fixes:**
- Restored delete action in session list + search results.
- Used composite identity (`source:id`) for session state tracking and selection.
- Added source query propagation to model/conversation endpoints and SSE conversation stream.
- Updated backend storage/session helpers to accept source hints and avoid ambiguous lookups.
- Fixed TypeScript noEmit regressions discovered during review.

**Code changes (excerpt):**
```ts
// web/app.tsx
const [selectedSession, setSelectedSession] = useState<{ id: string; source: SessionSource } | null>(null);

fetch(`/api/session/${sessionId}/model?source=${encodeURIComponent(source)}`)
new EventSource(`/api/conversation/${sessionId}/stream?source=${encodeURIComponent(source)}&offset=${offset}`)
```

```ts
// api/storage.ts
export async function getConversation(sessionId: string, sourceHint?: SessionSource)
export async function getConversationStream(sessionId: string, fromOffset = 0, sourceHint?: SessionSource)
export async function getSessionLatestModel(sessionId: string, sourceHint?: SessionSource)
```

## Why This Works
The original merge left a split-brain identity model:
- search/index used source-qualified keys,
- UI/server state still used id-only keys.

By making source qualification consistent end-to-end (selection, updates, stream handling, model lookup, delete path), each session is uniquely identified by `(source, id)` and collisions are eliminated.

## Prevention
- Treat identity as a cross-cutting concern: if one subsystem moves to composite keys, audit all adjacent paths in same PR (UI state, SSE, API fetches, caches).
- Add regression tests for duplicate `id` across different `source` values.
- Keep both runtime and static checks in the merge checklist:
  - `bun test`
  - `bunx tsc --noEmit`
  - `bunx tsc -p web/tsconfig.json --noEmit`
  - `bun run build`

## Related Issues
- See also: [git-push-403-wrong-origin-remote-20260210.md](../developer-experience/git-push-403-wrong-origin-remote-20260210.md)
- Related implementation todos closed in this cycle:
  - `todos/004-complete-p1-source-qualified-session-identity-parity.md`
  - `todos/005-complete-p2-typescript-noemit-regressions.md`
