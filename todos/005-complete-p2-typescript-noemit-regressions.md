---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, quality, typescript]
dependencies: []
---

# TypeScript noEmit checks currently fail

## Problem Statement
TypeScript noEmit checks report errors on the current branch. This reduces confidence in refactors and can hide real regressions during merge/integration work.

## Findings
Running:
- `bunx tsc --noEmit`
- `bunx tsc -p web/tsconfig.json --noEmit`

Reported issues:
1. `web/app.tsx(1,53): TS6133` — `useRef` imported but unused.
2. `web/hooks/search-ranking.ts(119,52): TS2352` — generic cast can be unsafe (`Omit<...>` to `T`) and should use safer typing strategy.

## Proposed Solutions

### Option 1: Fix errors directly in source (recommended)

**Approach:** Remove unused import and refactor the generic return typing in `search-ranking.ts` to avoid unsafe cast.

**Pros:**
- Restores static quality gate
- Minimal change surface
- No config relaxation

**Cons:**
- Small refactor needed in ranking helper typing

**Effort:** 30-60 minutes

**Risk:** Low

---

### Option 2: Relax TS config for these checks

**Approach:** Adjust compiler flags to ignore unused imports / unsafe casts.

**Pros:**
- Fast

**Cons:**
- Hides valid quality signals
- Encourages technical debt

**Effort:** 10-20 minutes

**Risk:** Medium

## Recommended Action

## Technical Details

**Affected files:**
- `web/app.tsx`
- `web/hooks/search-ranking.ts`

**Related components:**
- Search result reranking utility typing

**Database changes (if any):**
- None

## Resources
- **Verification commands:**
  - `bunx tsc --noEmit`
  - `bunx tsc -p web/tsconfig.json --noEmit`

## Acceptance Criteria
- [x] `bunx tsc --noEmit` passes
- [x] `bunx tsc -p web/tsconfig.json --noEmit` passes
- [x] No unsafe generic cast warnings in search-ranking helper
- [x] No unused import warnings in `web/app.tsx`

## Work Log

### 2026-02-11 - Code review finding

**By:** Claude Code

**Actions:**
- Ran TypeScript noEmit checks after merge verification
- Captured exact compiler errors and files
- Proposed remediation options

**Learnings:**
- Runtime tests/build pass, but type-level quality gate remains red

### 2026-02-11 - Resolution implemented

**By:** Claude Code

**Actions:**
- Removed unused `useRef` import from `web/app.tsx`
- Adjusted generic cast in `web/hooks/search-ranking.ts` to satisfy TS safety checks
- Re-ran both noEmit commands and confirmed pass

**Learnings:**
- Keeping noEmit green catches integration drift quickly after merge-heavy sessions

## Notes
- Completed and verified.
