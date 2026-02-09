# Multi-Source Sessions, Light Mode & Full-Text Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend claude-run to support Factory and Codex sessions, add light/dark mode toggle, migrate to Bun runtime with bun:sqlite for full-text search.

**Architecture:** The backend is refactored from Node.js to Bun runtime. Storage layer gains source-specific loaders for `.claude`, `.factory`, and `.codex` directories, each normalizing data into shared Session/ConversationMessage interfaces. A SQLite FTS5 database indexes all session content for full-text search. The frontend adds a source filter button group, theme toggle, and search API integration.

**Tech Stack:** Bun runtime, bun:sqlite, Hono (kept for routing), Vite (kept for frontend dev), React 19, Tailwind v4, lucide-react

---

### Task 1: Migrate to Bun Runtime & Package Manager

**Files:**
- Modify: `package.json`
- Delete: `pnpm-lock.yaml`
- Modify: `api/index.ts`
- Modify: `api/server.ts`
- Modify: `tsconfig.json`

**Step 1: Update package.json for Bun**

Replace pnpm-lock.yaml with bun.lockb. Update scripts to use `bun` instead of `tsx`:
- `"dev:server": "bun --watch api/index.ts -- --dev"`
- `"dev:web": "bunx vite --config web/vite.config.ts"`
- `"dev": "concurrently \"bun run dev:web\" \"bun run dev:server\""`
- `"build:web": "bunx vite build --config web/vite.config.ts"`
- `"build:server": "bun build api/index.ts --outdir dist --target bun --format esm"`
- `"start": "bun dist/index.js"`
- Remove `tsx` from devDependencies
- Remove `tsup` from devDependencies
- Remove `@hono/node-server` from dependencies
- Add `"@types/bun": "latest"` to devDependencies

**Step 2: Update api/server.ts to use Bun.serve**

Replace `@hono/node-server` imports with Bun's native serve. Replace `serve()` call with `Bun.serve({ port, fetch: app.fetch })`. Remove `serveStatic` from `@hono/node-server` and use hono/bun's `serveStatic` or manual static file serving. For serving static files, use `hono/bun` adapter or a custom middleware that reads files via `Bun.file()`.

**Step 3: Install dependencies with Bun**

```bash
cd claude-run && rm pnpm-lock.yaml && bun install
```

**Step 4: Test the dev server starts**

```bash
bun run dev:server
```

Expected: Server starts on port 12001 without errors.

**Step 5: Test the full dev setup**

```bash
bun run dev
```

Expected: Both API server (12001) and Vite dev server (12000) start.

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor: migrate from Node.js/pnpm to Bun runtime"
```

---

### Task 2: Add Source Type to Data Model

**Files:**
- Modify: `api/storage.ts`

**Step 1: Add source type to interfaces**

Add to `api/storage.ts`:
```typescript
export type SessionSource = "claude" | "factory" | "codex";
```

Update `Session` interface to include:
```typescript
export interface Session {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
  source: SessionSource;
}
```

Update `HistoryEntry` interface:
```typescript
export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
  source: SessionSource;
}
```

**Step 2: Update existing Claude loader to set source**

In `loadHistoryCache()`, set `source: "claude"` on each entry.
In `getSessions()`, set `source: "claude"` on each session.

**Step 3: Verify existing Claude functionality still works**

```bash
bun run dev
```

Open browser, confirm Claude sessions load with no errors.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add source type field to session data model"
```

---

### Task 3: Add Factory Session Loader

**Files:**
- Modify: `api/storage.ts`

**Step 1: Implement Factory history loader**

Factory stores history in `~/.factory/history.json` as a JSON array of objects:
```json
[{"command": "...", "timestamp": "2026-02-02T00:32:54.333Z", "type": "message", "mode": "chat"}]
```

Sessions are in `~/.factory/sessions/<encoded-project>/<session-id>.jsonl` where each line is a JSON object. First line has `"type": "session_start"` with fields: `id`, `sessionTitle`, `cwd`. Subsequent lines have `"type": "message"` with `id`, `timestamp`, and `message: {role, content}`.

Add function `loadFactoryHistory()`:
- Read `~/.factory/history.json` (JSON array, not JSONL)
- For each entry, create a `HistoryEntry` with `source: "factory"`, `display` from `command`, `timestamp` converted from ISO string to epoch ms, `project` derived from the session directory structure

Add function `findFactorySessions()`:
- Scan `~/.factory/sessions/` for project directories
- Each project directory contains `<session-id>.jsonl` files
- Read the first line of each to get `session_start` with `sessionTitle` for display

Add function `getFactoryConversation(sessionId)`:
- Find the session file across project directories
- Parse JSONL lines, map Factory message format to `ConversationMessage`:
  - `type: "message"` with `message.role === "user"` -> `type: "user"`
  - `type: "message"` with `message.role === "assistant"` -> `type: "assistant"`
  - Content is in `message.content` array with `{type: "text", text: "..."}`

**Step 2: Integrate into getSessions()**

Call `loadFactoryHistory()` alongside Claude loader. Merge results.

**Step 3: Integrate into getConversation()**

Check session source to dispatch to correct loader.

**Step 4: Test Factory sessions appear**

```bash
bun run dev
```

Expected: Factory sessions appear in the list alongside Claude sessions.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Factory session loader"
```

---

### Task 4: Add Codex Session Loader

**Files:**
- Modify: `api/storage.ts`

**Step 1: Implement Codex history and session loader**

Codex stores history in `~/.codex/history.jsonl` as JSONL:
```json
{"session_id":"...", "ts": 1757349798, "text": "..."}
```

Sessions are in `~/.codex/sessions/<year>/<month>/<day>/rollout-<timestamp>-<session-id>.jsonl`. Each line is:
```json
{"timestamp":"ISO", "type":"session_meta|response_item", "payload": {...}}
```

For `session_meta`: payload has `id`, `timestamp`, `cwd`, `model_provider`, `cli_version`.
For `response_item`: payload has `type: "message"`, `role: "developer"|"user"|"assistant"`, `content: [{type: "input_text"|"output_text", text: "..."}]`.

Add function `loadCodexHistory()`:
- Read `~/.codex/history.jsonl`
- For each line, create HistoryEntry with `source: "codex"`, `display` from `text` (truncated), `timestamp` from `ts` (seconds -> ms), `sessionId` from `session_id`

Add function `findCodexSessionFile(sessionId)`:
- Walk `~/.codex/sessions/` year/month/day directories
- Match filename containing the session_id

Add function `getCodexConversation(sessionId)`:
- Parse JSONL lines, map Codex format to ConversationMessage:
  - `response_item` with `payload.role === "user"` -> `type: "user"`
  - `response_item` with `payload.role === "assistant"` -> `type: "assistant"`
  - Skip `role === "developer"` (system prompts)
  - Content: map `input_text` to text content blocks, `output_text` to text content blocks

**Step 2: Integrate into getSessions() and getConversation()**

**Step 3: Test Codex sessions appear**

```bash
bun run dev
```

Expected: Codex sessions appear in the list.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add Codex session loader"
```

---

### Task 5: Update File Watcher for Multi-Source

**Files:**
- Modify: `api/watcher.ts`
- Modify: `api/server.ts`

**Step 1: Watch all three source directories**

Update `initWatcher()` to accept multiple directories. Watch:
- `~/.claude/history.jsonl` and `~/.claude/projects/`
- `~/.factory/history.json` and `~/.factory/sessions/`
- `~/.codex/history.jsonl` and `~/.codex/sessions/`

Update `emitChange()` to detect which source the change came from (by checking file path prefix) and invalidate the correct cache.

**Step 2: Test live updates from all sources**

Start dev server, open browser. Create/modify a session in any source. Confirm the UI updates.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: watch Factory and Codex directories for changes"
```

---

### Task 6: Add Source Filter Button Group (Frontend)

**Files:**
- Modify: `web/app.tsx`
- Modify: `web/components/session-list.tsx`

**Step 1: Add source filter state to App**

Add state: `const [selectedSource, setSelectedSource] = useState<SessionSource | null>(null)`.

Pass `selectedSource` and `setSelectedSource` to `SessionList`.

Update `filteredSessions` to also filter by source when `selectedSource` is set.

**Step 2: Add button group to SessionList**

Add a button group above the search input with buttons: "All", "Claude", "Factory", "Codex". Style as:
```tsx
<div className="flex px-3 py-2 gap-1 border-b border-zinc-800/60">
  {["all", "claude", "factory", "codex"].map(source => (
    <button
      key={source}
      onClick={() => setSelectedSource(source === "all" ? null : source)}
      className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
        (source === "all" && !selectedSource) || selectedSource === source
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
      }`}
    >
      {source === "all" ? "All" : source.charAt(0).toUpperCase() + source.slice(1)}
    </button>
  ))}
</div>
```

**Step 3: Add source badge to session items**

In session list items, add a small colored dot or label:
- Claude: blue dot
- Factory: green dot
- Codex: orange dot

**Step 4: Test filter functionality**

Click each filter button. Verify sessions filter correctly.

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: add source filter button group in sidebar"
```

---

### Task 7: Adapt Resume Command Per Source

**Files:**
- Modify: `web/app.tsx`

**Step 1: Update handleCopyResumeCommand**

Change the resume command based on session source:
```typescript
const handleCopyResumeCommand = useCallback(
  (sessionId: string, projectPath: string, source: SessionSource) => {
    let command: string;
    switch (source) {
      case "factory":
        command = `cd ${projectPath} && droid --resume ${sessionId}`;
        break;
      case "codex":
        command = `cd ${projectPath} && codex --resume ${sessionId}`;
        break;
      default:
        command = `cd ${projectPath} && claude --resume ${sessionId}`;
    }
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  },
  [],
);
```

**Step 2: Update SessionHeader to pass source**

Pass `session.source` to `onCopyResumeCommand`.

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: adapt resume command per session source"
```

---

### Task 8: Add Light/Dark Mode Theme Toggle

**Files:**
- Modify: `web/index.css`
- Modify: `web/index.html`
- Modify: `web/app.tsx`
- Modify: `web/components/session-list.tsx`
- Modify: `web/components/session-view.tsx`
- Modify: `web/components/message-block.tsx`
- Modify: `web/components/scroll-to-bottom-button.tsx`
- Modify: `web/components/markdown-renderer.tsx`
- Modify: all tool-renderer files

**Step 1: Set up CSS custom properties for theming**

In `index.css`, add CSS variables for both themes. Use Tailwind v4's `@theme` or custom properties approach:

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f4f4f5;
  --bg-tertiary: #e4e4e7;
  --text-primary: #18181b;
  --text-secondary: #52525b;
  --text-tertiary: #a1a1aa;
  --border: #e4e4e7;
  --accent: #0891b2;
  color-scheme: light;
}

.dark {
  --bg-primary: #09090b;
  --bg-secondary: #18181b;
  --bg-tertiary: #27272a;
  --text-primary: #fafafa;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;
  --border: rgba(39, 39, 42, 0.6);
  --accent: #0e7490;
  color-scheme: dark;
}
```

However, since the entire app uses Tailwind utility classes with hardcoded `zinc-950`, `zinc-100`, etc., we have two approaches:

**Approach A (recommended):** Use Tailwind's `dark:` variant. Add both light and dark classes everywhere: `bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100`. This is verbose but follows Tailwind conventions.

**Approach B:** Replace all hardcoded colors with CSS variables and use those variables in custom Tailwind utilities.

Go with **Approach A** since it's the standard Tailwind pattern and the codebase is small enough.

Update every component to have light variants alongside existing dark classes. The `<html>` element already has `class="dark"`. Toggle removes/adds this class.

**Step 2: Add theme toggle to the header bar**

In `app.tsx`, add a sun/moon icon button next to the sidebar toggle:
```tsx
import { Sun, Moon } from "lucide-react";

const [theme, setTheme] = useState<"light" | "dark">(() => {
  return localStorage.getItem("claude-run-theme") as "light" | "dark" || "dark";
});

useEffect(() => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("claude-run-theme", theme);
}, [theme]);
```

Button:
```tsx
<button
  onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
  className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
>
  {theme === "dark" ? <Sun className="w-4 h-4 text-zinc-400" /> : <Moon className="w-4 h-4 text-zinc-600" />}
</button>
```

**Step 3: Update all component classes**

For each component, add light mode equivalents. Pattern:
- `bg-zinc-950` -> `bg-white dark:bg-zinc-950`
- `bg-zinc-900` -> `bg-zinc-100 dark:bg-zinc-900`
- `text-zinc-100` -> `text-zinc-900 dark:text-zinc-100`
- `text-zinc-300` -> `text-zinc-700 dark:text-zinc-300`
- `text-zinc-400` -> `text-zinc-500 dark:text-zinc-400`
- `text-zinc-500` -> `text-zinc-500 dark:text-zinc-500` (often fine as-is)
- `text-zinc-600` -> `text-zinc-400 dark:text-zinc-600`
- `border-zinc-800/60` -> `border-zinc-200 dark:border-zinc-800/60`
- `bg-indigo-600/80` -> `bg-indigo-500 dark:bg-indigo-600/80` (user message)
- `bg-cyan-700/50` -> `bg-cyan-100 dark:bg-cyan-700/50` (assistant message)
- `hover:bg-zinc-800` -> `hover:bg-zinc-200 dark:hover:bg-zinc-800`

Also update `index.html` body classes and `index.css`.

**Step 4: Update index.html**

```html
<body class="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
```

**Step 5: Test both themes**

Toggle the theme button. Verify all elements look correct in both modes.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add light/dark mode theme toggle"
```

---

### Task 9: Add SQLite FTS5 Full-Text Search (Backend)

**Files:**
- Create: `api/search.ts`
- Modify: `api/server.ts`
- Modify: `api/storage.ts`

**Step 1: Create search.ts with bun:sqlite FTS5**

```typescript
import { Database } from "bun:sqlite";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

let db: Database | null = null;

export interface SearchResult {
  sessionId: string;
  source: string;
  display: string;
  project: string;
  snippet: string;
  rank: number;
}

export function initSearchDb(dataDir: string): void {
  const dbDir = join(dataDir, ".claude-run");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(join(dbDir, "search.db"));
  db.run("PRAGMA journal_mode=WAL");

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

  const existing = db.query("SELECT session_id FROM session_index_meta WHERE session_id = ?").get(sessionId);
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

  const ftsQuery = query.trim().split(/\s+/).map(w => `"${w}"`).join(" ");

  let sql = `
    SELECT session_id, source, display, project,
           snippet(sessions_fts, 4, '<mark>', '</mark>', '...', 40) as snippet,
           rank
    FROM sessions_fts
    WHERE sessions_fts MATCH ?
  `;
  const params: (string)[] = [ftsQuery];

  if (source) {
    sql += " AND source = ?";
    params.push(source);
  }

  sql += " ORDER BY rank LIMIT 50";

  return db.query(sql).all(...params) as SearchResult[];
}

export function isSessionIndexed(sessionId: string): boolean {
  if (!db) return false;
  const result = db.query("SELECT 1 FROM session_index_meta WHERE session_id = ?").get(sessionId);
  return !!result;
}
```

**Step 2: Add search API endpoint to server.ts**

```typescript
app.get("/api/search", async (c) => {
  const query = c.req.query("q") || "";
  const source = c.req.query("source") || undefined;
  const results = searchSessions(query, source);
  return c.json(results);
});
```

**Step 3: Index sessions on startup**

After `loadStorage()`, iterate all sessions and index their full content (concatenated user + assistant text). Do this in background so startup isn't blocked.

**Step 4: Incremental indexing on file changes**

When a session file changes (watcher event), re-index that session's content.

**Step 5: Test search API**

```bash
curl "http://localhost:12001/api/search?q=test"
```

Expected: JSON array of matching sessions with snippets.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add SQLite FTS5 full-text search backend"
```

---

### Task 10: Add Full-Text Search UI (Frontend)

**Files:**
- Modify: `web/components/session-list.tsx`
- Modify: `web/app.tsx`

**Step 1: Update search to call API**

When user types in search box, debounce 300ms, then call `/api/search?q=<query>&source=<source>`. Display results with snippets instead of the normal session list.

```typescript
const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
const [searching, setSearching] = useState(false);
const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (!search.trim()) {
    setSearchResults(null);
    return;
  }

  if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

  searchTimeoutRef.current = setTimeout(async () => {
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: search });
      if (selectedSource) params.set("source", selectedSource);
      const res = await fetch(`/api/search?${params}`);
      const results = await res.json();
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, 300);
}, [search, selectedSource]);
```

**Step 2: Render search results with snippets**

When `searchResults` is not null, render those instead of normal filtered sessions. Each result shows:
- Session display text
- Snippet with `<mark>` tags highlighted (use `dangerouslySetInnerHTML` for the snippet since it comes from our own backend)
- Project name

**Step 3: Test full-text search**

Type a query that matches content inside messages (not in title). Verify results appear.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: add full-text search UI with result snippets"
```

---

### Task 11: Final Build & Verification

**Files:**
- Modify: `package.json` (if needed)

**Step 1: Production build**

```bash
bun run build
```

Expected: No errors. Output in `dist/`.

**Step 2: Test production mode**

```bash
bun run start
```

Expected: Opens browser, all features work: multi-source sessions, source filter, theme toggle, full-text search.

**Step 3: Final commit**

```bash
git add -A && git commit -m "chore: verify production build"
```
