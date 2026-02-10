import { watch, type FSWatcher } from "chokidar";
import { basename, join } from "path";
import type { SessionSource } from "./storage";

type HistoryChangeCallback = () => void;
type SessionChangeCallback = (sessionId: string, filePath: string, source: SessionSource) => void;

let watcher: FSWatcher | null = null;
let claudeDir = "";
let factoryDir = "";
let codexDir = "";
let piDir = "";
const debounceTimers = new Map<string, NodeJS.Timeout>();
const debounceMs = 20;
const historyDebounceMs = 100;

const historyChangeListeners = new Set<HistoryChangeCallback>();
const sessionChangeListeners = new Set<SessionChangeCallback>();

export function initWatcher(claude: string, factory: string, codex: string, pi?: string): void {
  claudeDir = claude;
  factoryDir = factory;
  codexDir = codex;
  piDir = pi || "";
}

function detectSource(filePath: string): SessionSource {
  if (filePath.startsWith(factoryDir)) return "factory";
  if (filePath.startsWith(codexDir)) return "codex";
  if (piDir && filePath.startsWith(piDir)) return "claude"; // Pi sessions use claude format
  return "claude";
}

function emitChange(filePath: string): void {
  const isHistory =
    filePath.endsWith("history.jsonl") || filePath.endsWith("history.json");

  if (isHistory) {
    for (const callback of historyChangeListeners) {
      callback();
    }
  } else if (filePath.endsWith(".jsonl")) {
    const source = detectSource(filePath);
    let sessionId: string;

    if (source === "codex") {
      const match = basename(filePath, ".jsonl").match(/([0-9a-f]{4,}-[0-9a-f-]+)$/);
      sessionId = match ? match[1] : basename(filePath, ".jsonl");
    } else {
      sessionId = basename(filePath, ".jsonl");
    }

    for (const callback of sessionChangeListeners) {
      callback(sessionId, filePath, source);
    }
  }
}

function handleChange(path: string): void {
  const existing = debounceTimers.get(path);
  if (existing) clearTimeout(existing);

  const isHistory = path.endsWith("history.jsonl") || path.endsWith("history.json");
  const delay = isHistory ? historyDebounceMs : debounceMs;

  const timer = setTimeout(() => {
    debounceTimers.delete(path);
    emitChange(path);
  }, delay);

  debounceTimers.set(path, timer);
}

export function startWatcher(): void {
  if (watcher) return;

  const watchPaths = [
    join(claudeDir, "history.jsonl"),
    join(claudeDir, "projects"),
    join(factoryDir, "history.json"),
    join(factoryDir, "sessions"),
    join(codexDir, "history.jsonl"),
    join(codexDir, "sessions"),
    ...(piDir ? [piDir] : []),
  ];

  const usePolling = process.env.CLAUDE_RUN_USE_POLLING === "1";

  watcher = watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    usePolling,
    ...(usePolling && { interval: 100 }),
    depth: 5,
  });

  watcher.on("change", handleChange);
  watcher.on("add", handleChange);
  watcher.on("error", (error) => {
    console.error("Watcher error:", error);
  });
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

export function onHistoryChange(callback: HistoryChangeCallback): void {
  historyChangeListeners.add(callback);
}

export function offHistoryChange(callback: HistoryChangeCallback): void {
  historyChangeListeners.delete(callback);
}

export function onSessionChange(callback: SessionChangeCallback): void {
  sessionChangeListeners.add(callback);
}

export function offSessionChange(callback: SessionChangeCallback): void {
  sessionChangeListeners.delete(callback);
}
