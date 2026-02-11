# Client-Side Search with uFuzzy + Keyboard Navigation

## Problem

Search feels laggy due to 300ms debounce + network round-trip + server-side exact-phrase re-ranking that reads full content for each FTS match. Current data: 478 sessions, 5.5 MB content, 8.5 MB SQLite DB.

## Decision

Move search entirely to the browser using uFuzzy (in-memory JS fuzzy search). Server-side SQLite FTS remains as persistent index but the browser no longer calls `/api/search`.

## Architecture

### Server Changes

**New endpoint: `GET /api/search-index`**
- Returns JSON array: `[{ id, source, display, project, content, timestamp }, ...]`
- Gzip-compressed (~1.5 MB over the wire for 5.5 MB content)
- Reads from the existing session loaders (same data as indexSession uses)

**SSE content updates**
- Extend existing `sessionsUpdate` SSE events to include a `contentUpdate` event
- Payload: `{ sessionId, source, display, project, content, timestamp }`
- Fired when watcher detects session file changes
- Browser patches its in-memory index on receive

### Frontend Changes

**Search index module (`web/hooks/use-search-index.ts`)**
- On mount, fetches `/api/search-index` in background
- Builds uFuzzy instance from content array
- Listens for SSE `contentUpdate` events to patch the index
- Exports: `{ search(query, source?) => SearchResult[], ready: boolean }`

**Search execution (replaces server `/api/search` calls)**
- No debounce needed -- uFuzzy searches are sub-1ms
- Exact-phrase boost: check if content includes the full query string
- Sort: exact matches first, then by timestamp (most recent first)
- Snippet generation: extract ~80 chars around first match, wrap matches in `<mark>`

**Keyboard navigation**
- `"/"` global shortcut focuses search input
- Arrow Up/Down: move highlighted selection through results list
- Enter: open highlighted session
- Escape: clear search, blur input
- Visual highlight on currently selected item
- Auto-scroll list to keep selected item visible
- Only active when search input is focused

**Search input UX**
- Placeholder shows "Indexing..." until background fetch completes
- Then switches to "Search..." (or "Press / to search")
- Spinner shown during initial index load

## Implementation Steps

1. Install uFuzzy: `bun add @leeoniya/ufuzzy`
2. Add `GET /api/search-index` endpoint to `api/server.ts`
3. Add `contentUpdate` SSE event to session change handler
4. Create `web/hooks/use-search-index.ts` -- background fetch, uFuzzy index, SSE patching
5. Update `web/components/session-list.tsx`:
   - Replace server search with `useSearchIndex` hook
   - Remove 300ms debounce, search on every keystroke
   - Add keyboard navigation (arrow keys, enter, escape)
   - Add "/" global shortcut
   - Show "Indexing..." state
6. Build, test search speed, test keyboard nav, test SSE updates
7. Commit

## What Stays

- Server-side SQLite FTS (`api/search.ts`) remains untouched
- Periodic re-index (dirty sessions) continues running
- File watcher unchanged

## Scale Projections

| Sessions | Content | Browser RAM | Gzip Transfer |
|----------|---------|-------------|---------------|
| 500      | 6 MB    | ~18 MB      | ~1.5 MB       |
| 2,000    | 25 MB   | ~75 MB      | ~6 MB         |
| 5,000    | 60 MB   | ~180 MB     | ~15 MB        |

At 2,000 sessions this is still very comfortable. At 5,000+ we'd want pagination or lazy loading of content.
