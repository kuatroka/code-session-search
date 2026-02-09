import { readdir, readFile, stat, open } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";
import { createInterface } from "readline";

export type SessionSource = "claude" | "factory" | "codex";

export interface HistoryEntry {
  display: string;
  timestamp: number;
  project: string;
  sessionId?: string;
  source: SessionSource;
}

export interface Session {
  id: string;
  display: string;
  timestamp: number;
  project: string;
  projectName: string;
  source: SessionSource;
}

export interface ConversationMessage {
  type: "user" | "assistant" | "summary" | "file-history-snapshot";
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  sessionId?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
  summary?: string;
}

export interface ContentBlock {
  type: "text" | "thinking" | "tool_use" | "tool_result";
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface StreamResult {
  messages: ConversationMessage[];
  nextOffset: number;
}

let claudeDir = join(homedir(), ".claude");
let factoryDir = join(homedir(), ".factory");
let codexDir = join(homedir(), ".codex");

const fileIndex = new Map<string, { path: string; source: SessionSource }>();
let historyCache: HistoryEntry[] | null = null;
const pendingRequests = new Map<string, Promise<unknown>>();

export function initStorage(dir?: string): void {
  claudeDir = dir ?? join(homedir(), ".claude");
  factoryDir = join(homedir(), ".factory");
  codexDir = join(homedir(), ".codex");
}

export function getClaudeDir(): string {
  return claudeDir;
}

export function getFactoryDir(): string {
  return factoryDir;
}

export function getCodexDir(): string {
  return codexDir;
}

export function invalidateHistoryCache(): void {
  historyCache = null;
}

export function addToFileIndex(sessionId: string, filePath: string, source: SessionSource = "claude"): void {
  fileIndex.set(sessionId, { path: filePath, source });
}

function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

function encodeProjectPath(path: string): string {
  return path.replace(/[/.]/g, "-");
}

// --- Claude loader ---

async function buildClaudeFileIndex(): Promise<void> {
  const projectsDir = join(claudeDir, "projects");
  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());
    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const sessionId = basename(file, ".jsonl");
              fileIndex.set(sessionId, { path: join(projectPath, file), source: "claude" });
            }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* projects dir may not exist */ }
}

async function loadClaudeHistory(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(claudeDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        entries.push({ ...parsed, source: "claude" as SessionSource });
      } catch { /* skip malformed */ }
    }
    return entries;
  } catch {
    return [];
  }
}

async function findClaudeSessionByTimestamp(
  encodedProject: string,
  timestamp: number
): Promise<string | undefined> {
  try {
    const projectsDir = join(claudeDir, "projects");
    const projectPath = join(projectsDir, encodedProject);
    const files = await readdir(projectPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    const fileStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = join(projectPath, file);
        const fileStat = await stat(filePath);
        return { file, mtime: fileStat.mtimeMs };
      })
    );
    let closestFile: string | null = null;
    let closestTimeDiff = Infinity;
    for (const { file, mtime } of fileStats) {
      const timeDiff = Math.abs(mtime - timestamp);
      if (timeDiff < closestTimeDiff) {
        closestTimeDiff = timeDiff;
        closestFile = file;
      }
    }
    if (closestFile) return basename(closestFile, ".jsonl");
  } catch { /* ignore */ }
  return undefined;
}

// --- Factory loader ---

async function buildFactoryFileIndex(): Promise<void> {
  const sessionsDir = join(factoryDir, "sessions");
  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const directories = entries.filter((d) => d.isDirectory());
    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(sessionsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              const sessionId = basename(file, ".jsonl");
              fileIndex.set(sessionId, { path: join(projectPath, file), source: "factory" });
            }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* sessions dir may not exist */ }
}

async function loadFactoryHistory(): Promise<HistoryEntry[]> {
  const sessionsDir = join(factoryDir, "sessions");
  const entries: HistoryEntry[] = [];
  try {
    const projDirs = await readdir(sessionsDir, { withFileTypes: true });
    const directories = projDirs.filter((d) => d.isDirectory());
    await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(sessionsDir, dir.name);
          const files = await readdir(projectPath);
          for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;
            const filePath = join(projectPath, file);
            try {
              const content = await readFile(filePath, "utf-8");
              const firstLine = content.split("\n")[0];
              if (!firstLine) continue;
              const parsed = JSON.parse(firstLine);
              if (parsed.type !== "session_start") continue;
              const fileStat = await stat(filePath);
              const cwd = parsed.cwd || dir.name.replace(/-/g, "/");
              entries.push({
                display: parsed.sessionTitle || parsed.title || "Factory Session",
                timestamp: fileStat.mtimeMs,
                project: cwd,
                sessionId: parsed.id || basename(file, ".jsonl"),
                source: "factory",
              });
            } catch { /* skip malformed */ }
          }
        } catch { /* ignore */ }
      })
    );
  } catch { /* sessions dir may not exist */ }
  return entries;
}

async function getFactoryConversation(sessionId: string): Promise<ConversationMessage[]> {
  const entry = fileIndex.get(sessionId);
  if (!entry || entry.source !== "factory") {
    const filePath = await findFactorySessionFile(sessionId);
    if (!filePath) return [];
    return parseFactorySession(filePath);
  }
  return parseFactorySession(entry.path);
}

async function findFactorySessionFile(sessionId: string): Promise<string | null> {
  const sessionsDir = join(factoryDir, "sessions");
  const targetFile = `${sessionId}.jsonl`;
  try {
    const projDirs = await readdir(sessionsDir, { withFileTypes: true });
    for (const dir of projDirs) {
      if (!dir.isDirectory()) continue;
      const projectPath = join(sessionsDir, dir.name);
      const files = await readdir(projectPath);
      if (files.includes(targetFile)) {
        return join(projectPath, targetFile);
      }
    }
  } catch { /* ignore */ }
  return null;
}

async function parseFactorySession(filePath: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "message" && parsed.message) {
          const role = parsed.message.role;
          if (role === "user" || role === "assistant") {
            messages.push({
              type: role,
              uuid: parsed.id,
              timestamp: parsed.timestamp,
              message: parsed.message,
            });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return messages;
}

// --- Codex loader ---

async function buildCodexFileIndex(): Promise<void> {
  const sessionsDir = join(codexDir, "sessions");
  try {
    await walkCodexSessions(sessionsDir, (sessionId, filePath) => {
      fileIndex.set(sessionId, { path: filePath, source: "codex" });
    });
  } catch { /* sessions dir may not exist */ }
}

async function walkCodexSessions(
  dir: string,
  callback: (sessionId: string, filePath: string) => void
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkCodexSessions(fullPath, callback);
    } else if (entry.name.endsWith(".jsonl")) {
      const match = entry.name.match(/([0-9a-f]{4,}-[0-9a-f-]+)\.jsonl$/);
      if (match) {
        callback(match[1], fullPath);
      }
    }
  }
}

async function loadCodexHistory(): Promise<HistoryEntry[]> {
  try {
    const historyPath = join(codexDir, "history.jsonl");
    const content = await readFile(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const entries: HistoryEntry[] = [];
    const seenSessions = new Set<string>();
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const sessionId = parsed.session_id;
        if (!sessionId || seenSessions.has(sessionId)) continue;
        seenSessions.add(sessionId);
        const ts = typeof parsed.ts === "string" ? parseInt(parsed.ts, 10) : parsed.ts;
        const timestamp = ts < 1e12 ? ts * 1000 : ts;
        entries.push({
          display: (parsed.text || "Codex Session").slice(0, 200),
          timestamp,
          project: "",
          sessionId,
          source: "codex",
        });
      } catch { /* skip */ }
    }
    return entries;
  } catch {
    return [];
  }
}

async function enrichCodexEntries(entries: HistoryEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.source !== "codex" || !entry.sessionId) continue;
    const indexed = fileIndex.get(entry.sessionId);
    if (!indexed) continue;
    try {
      const content = await readFile(indexed.path, "utf-8");
      const firstLine = content.split("\n")[0];
      if (!firstLine) continue;
      const parsed = JSON.parse(firstLine);
      if (parsed.type === "session_meta" && parsed.payload) {
        entry.project = parsed.payload.cwd || "";
      }
    } catch { /* ignore */ }
  }
}

async function getCodexConversation(sessionId: string): Promise<ConversationMessage[]> {
  const entry = fileIndex.get(sessionId);
  if (!entry || entry.source !== "codex") {
    return [];
  }
  return parseCodexSession(entry.path);
}

async function parseCodexSession(filePath: string): Promise<ConversationMessage[]> {
  const messages: ConversationMessage[] = [];
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "response_item" && parsed.payload) {
          const { role, content: payloadContent } = parsed.payload;
          if (role === "user") {
            const textParts = (payloadContent || [])
              .filter((c: { type: string }) => c.type === "input_text")
              .map((c: { text: string }) => c.text || "");
            if (textParts.length > 0) {
              messages.push({
                type: "user",
                uuid: `codex-${messages.length}`,
                timestamp: parsed.timestamp,
                message: {
                  role: "user",
                  content: textParts.join("\n"),
                },
              });
            }
          } else if (role === "assistant") {
            const textParts = (payloadContent || [])
              .filter((c: { type: string }) => c.type === "output_text")
              .map((c: { text: string }) => c.text || "");
            if (textParts.length > 0) {
              messages.push({
                type: "assistant",
                uuid: `codex-${messages.length}`,
                timestamp: parsed.timestamp,
                message: {
                  role: "assistant",
                  content: textParts.join("\n"),
                },
              });
            }
          }
        } else if (parsed.type === "function_call") {
          const payload = parsed.payload || {};
          messages.push({
            type: "assistant",
            uuid: `codex-fc-${messages.length}`,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: payload.call_id || payload.id,
                  name: payload.name || payload.type || "function_call",
                  input: payload.arguments ? JSON.parse(payload.arguments) : {},
                },
              ],
            },
          });
        } else if (parsed.type === "function_call_output") {
          const payload = parsed.payload || {};
          messages.push({
            type: "assistant",
            uuid: `codex-fco-${messages.length}`,
            timestamp: parsed.timestamp,
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: payload.call_id,
                  content: payload.output || "",
                },
              ],
            },
          });
        } else if (parsed.type === "reasoning") {
          const payload = parsed.payload || {};
          if (payload.text) {
            messages.push({
              type: "assistant",
              uuid: `codex-r-${messages.length}`,
              timestamp: parsed.timestamp,
              message: {
                role: "assistant",
                content: [
                  {
                    type: "thinking",
                    thinking: payload.text,
                  },
                ],
              },
            });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }
  return messages;
}

// --- Unified API ---

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, promise);
  return promise;
}

async function findClaudeSessionFile(sessionId: string): Promise<string | null> {
  const entry = fileIndex.get(sessionId);
  if (entry) return entry.path;

  const targetFile = `${sessionId}.jsonl`;
  const projectsDir = join(claudeDir, "projects");
  try {
    const projectDirs = await readdir(projectsDir, { withFileTypes: true });
    const directories = projectDirs.filter((d) => d.isDirectory());
    const results = await Promise.all(
      directories.map(async (dir) => {
        try {
          const projectPath = join(projectsDir, dir.name);
          const files = await readdir(projectPath);
          if (files.includes(targetFile)) {
            return join(projectPath, targetFile);
          }
        } catch { /* ignore */ }
        return null;
      })
    );
    const filePath = results.find((r) => r !== null);
    if (filePath) {
      fileIndex.set(sessionId, { path: filePath, source: "claude" });
      return filePath;
    }
  } catch { /* ignore */ }
  return null;
}

async function loadAllHistory(): Promise<HistoryEntry[]> {
  const [claudeEntries, factoryEntries, codexEntries] = await Promise.all([
    loadClaudeHistory(),
    loadFactoryHistory(),
    loadCodexHistory(),
  ]);
  await enrichCodexEntries(codexEntries);
  const allEntries = [...claudeEntries, ...factoryEntries, ...codexEntries];
  historyCache = allEntries;
  return allEntries;
}

export async function loadStorage(): Promise<void> {
  await Promise.all([
    buildClaudeFileIndex(),
    buildFactoryFileIndex(),
    buildCodexFileIndex(),
  ]);
  await loadAllHistory();
}

export async function getSessions(): Promise<Session[]> {
  return dedupe("getSessions", async () => {
    const entries = historyCache ?? (await loadAllHistory());
    const sessions: Session[] = [];
    const seenIds = new Set<string>();

    for (const entry of entries) {
      let sessionId = entry.sessionId;

      if (!sessionId && entry.source === "claude") {
        const encodedProject = encodeProjectPath(entry.project);
        sessionId = await findClaudeSessionByTimestamp(encodedProject, entry.timestamp);
      }

      if (!sessionId || seenIds.has(sessionId)) continue;
      seenIds.add(sessionId);

      sessions.push({
        id: sessionId,
        display: entry.display,
        timestamp: entry.timestamp,
        project: entry.project,
        projectName: getProjectName(entry.project),
        source: entry.source,
      });
    }

    return sessions.sort((a, b) => b.timestamp - a.timestamp);
  });
}

export async function getProjects(): Promise<string[]> {
  const entries = historyCache ?? (await loadAllHistory());
  const projects = new Set<string>();
  for (const entry of entries) {
    if (entry.project) projects.add(entry.project);
  }
  return [...projects].sort();
}

export async function getConversation(sessionId: string): Promise<ConversationMessage[]> {
  return dedupe(`getConversation:${sessionId}`, async () => {
    const entry = fileIndex.get(sessionId);

    if (entry?.source === "factory") {
      return getFactoryConversation(sessionId);
    }
    if (entry?.source === "codex") {
      return getCodexConversation(sessionId);
    }

    // Default: Claude
    const filePath = await findClaudeSessionFile(sessionId);
    if (!filePath) return [];

    const messages: ConversationMessage[] = [];
    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            messages.push(msg);
          } else if (msg.type === "summary") {
            messages.unshift(msg);
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
    return messages;
  });
}

export async function getConversationStream(
  sessionId: string,
  fromOffset: number = 0
): Promise<StreamResult> {
  const entry = fileIndex.get(sessionId);
  let filePath: string | null = null;

  if (entry) {
    filePath = entry.path;
  } else {
    filePath = await findClaudeSessionFile(sessionId);
  }

  if (!filePath) {
    return { messages: [], nextOffset: 0 };
  }

  // For non-Claude sources, return all messages at once (no streaming optimization)
  if (entry && entry.source !== "claude") {
    if (fromOffset > 0) return { messages: [], nextOffset: fromOffset };
    const messages = await getConversation(sessionId);
    return { messages, nextOffset: 1 };
  }

  const messages: ConversationMessage[] = [];
  let fileHandle;
  try {
    const fileStat = await stat(filePath);
    const fileSize = fileStat.size;
    if (fromOffset >= fileSize) {
      return { messages: [], nextOffset: fromOffset };
    }

    fileHandle = await open(filePath, "r");
    const stream = fileHandle.createReadStream({
      start: fromOffset,
      encoding: "utf-8",
    });

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let bytesConsumed = 0;

    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf-8") + 1;
      if (line.trim()) {
        try {
          const msg: ConversationMessage = JSON.parse(line);
          if (msg.type === "user" || msg.type === "assistant") {
            messages.push(msg);
          }
          bytesConsumed += lineBytes;
        } catch {
          break;
        }
      } else {
        bytesConsumed += lineBytes;
      }
    }

    const actualOffset = fromOffset + bytesConsumed;
    const nextOffset = actualOffset > fileSize ? fileSize : actualOffset;
    return { messages, nextOffset };
  } catch {
    return { messages: [], nextOffset: fromOffset };
  } finally {
    if (fileHandle) await fileHandle.close();
  }
}

export function getSessionSource(sessionId: string): SessionSource {
  const entry = fileIndex.get(sessionId);
  return entry?.source ?? "claude";
}

const SANITIZE_PATTERNS = [
  /<command-name>[^<]*<\/command-name>/g,
  /<command-message>[^<]*<\/command-message>/g,
  /<command-args>[^<]*<\/command-args>/g,
  /<local-command-stdout>[^<]*<\/local-command-stdout>/g,
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<system-notification>[\s\S]*?<\/system-notification>/g,
  /^\s*Caveat:.*?unless the user explicitly asks you to\./s,
];

function sanitizeForIndex(text: string): string {
  let result = text;
  for (const pattern of SANITIZE_PATTERNS) {
    result = result.replace(pattern, "");
  }
  return result.trim();
}

export function getAllSessionContent(sessionId: string): Promise<string> {
  return dedupe(`content:${sessionId}`, async () => {
    const messages = await getConversation(sessionId);
    const parts: string[] = [];
    for (const msg of messages) {
      if (!msg.message) continue;
      const content = msg.message.content;
      if (typeof content === "string") {
        const cleaned = sanitizeForIndex(content);
        if (cleaned) parts.push(cleaned);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            const cleaned = sanitizeForIndex(block.text);
            if (cleaned) parts.push(cleaned);
          }
        }
      }
    }
    return parts.join("\n");
  });
}
