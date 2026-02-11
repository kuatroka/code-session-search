import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Session, SessionSource } from "@claude-run-plus/api";
import { PanelLeft, Copy, Check, Sun, Moon } from "lucide-react";
import { formatTime } from "./utils";
import SessionList from "./components/session-list";
import SessionView, { type SessionModelInfo } from "./components/session-view";
import { useEventSource } from "./hooks/use-event-source";
import { useSearchIndex, type SearchIndexEntry } from "./hooks/use-search-index";

interface SessionHeaderProps {
  session: Session;
  copied: boolean;
  modelInfo: SessionModelInfo | null;
  onCopyResumeCommand: (sessionId: string, projectPath: string, source: SessionSource) => void;
}

function formatModelName(model: string): string {
  // Shorten verbose model names: claude-opus-4-5-20251101 → claude-opus-4-5
  return model.replace(/-\d{8,}$/, "");
}

function SessionHeader(props: SessionHeaderProps) {
  const { session, copied, modelInfo, onCopyResumeCommand } = props;

  return (
    <>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <SourceBadge source={session.source} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate">
              {session.display}
            </span>
            {modelInfo && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                {modelInfo.provider ? `${modelInfo.provider}/` : ""}{formatModelName(modelInfo.model)}
              </span>
            )}
            <span className="text-xs text-zinc-400 dark:text-zinc-600 shrink-0">
              {formatTime(session.timestamp)}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-500 truncate mt-0.5">
            📁 {session.projectName} — {session.project}
          </div>
        </div>
      </div>
      <button
        onClick={() => onCopyResumeCommand(session.id, session.project, session.source)}
        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded transition-colors cursor-pointer shrink-0"
        title="Copy resume command to clipboard"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-500" />
            <span className="text-green-600 dark:text-green-500">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Resume Command</span>
          </>
        )}
      </button>
    </>
  );
}

const SOURCE_COLORS: Record<SessionSource, string> = {
  claude: "bg-blue-500",
  factory: "bg-emerald-500",
  codex: "bg-orange-500",
  pi: "bg-pink-500",
};

function SourceBadge({ source }: { source: SessionSource }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${SOURCE_COLORS[source]}`} title={source} />
  );
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SessionSource | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentModel, setCurrentModel] = useState<SessionModelInfo | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("claude-run-plus-theme") as "light" | "dark") || "dark";
    }
    return "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("claude-run-plus-theme", theme);
  }, [theme]);

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

  const selectedSessionData = useMemo(() => {
    if (!selectedSession) return null;
    return sessions.find((s) => s.id === selectedSession) || null;
  }, [sessions, selectedSession]);

  useEffect(() => {
    let cancelled = false;
    const fetchProjects = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const res = await fetch("/api/projects");
          const data = await res.json();
          if (!cancelled) setProjects(data);
          return;
        } catch {
          if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000));
        }
      }
    };
    fetchProjects();
    return () => { cancelled = true; };
  }, []);

  const handleSessionsFull = useCallback((event: MessageEvent) => {
    const data: Session[] = JSON.parse(event.data);
    setSessions(data);
    setLoading(false);
  }, []);

  const handleSessionsUpdate = useCallback((event: MessageEvent) => {
    const updates: Session[] = JSON.parse(event.data);
    setSessions((prev) => {
      const sessionMap = new Map(prev.map((s) => [s.id, s]));
      for (const update of updates) {
        sessionMap.set(update.id, update);
      }
      return Array.from(sessionMap.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      );
    });
  }, []);

  const handleSessionsError = useCallback(() => {
    setLoading(false);
  }, []);

  const { search: searchFn, ready: searchReady, upsertEntry, removeEntry } = useSearchIndex();

  const handleContentUpdate = useCallback((event: MessageEvent) => {
    const update: SearchIndexEntry = JSON.parse(event.data);
    upsertEntry(update);
  }, [upsertEntry]);

  useEventSource("/api/sessions/stream", {
    events: [
      { eventName: "sessions", onMessage: handleSessionsFull },
      { eventName: "sessionsUpdate", onMessage: handleSessionsUpdate },
      { eventName: "contentUpdate", onMessage: handleContentUpdate },
    ],
    onError: handleSessionsError,
  });

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (selectedProject) {
      result = result.filter((s) => s.project === selectedProject);
    }
    if (selectedSource) {
      result = result.filter((s) => s.source === selectedSource);
    }
    return result;
  }, [sessions, selectedProject, selectedSource]);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSession(sessionId);
    setCurrentModel(null);
    // Fetch model from server (works for all sources including Factory settings.json)
    fetch(`/api/session/${sessionId}/model`)
      .then((r) => r.json())
      .then((data: SessionModelInfo | null) => {
        if (data) setCurrentModel(data);
      })
      .catch(() => {});
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: string, source: SessionSource) => {
    const res = await fetch(`/api/sessions/${sessionId}?source=${encodeURIComponent(source)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      throw new Error("Failed to delete session");
    }

    setSessions((prev) => prev.filter((s) => !(s.id === sessionId && s.source === source)));
    removeEntry(sessionId, source);

    if (selectedSession === sessionId) {
      setSelectedSession(null);
      setCurrentModel(null);
    }
  }, [removeEntry, selectedSession]);

  const handleModelChange = useCallback((info: SessionModelInfo | null) => {
    // Client-side extraction overrides server model (more up-to-date for streaming sessions)
    if (info) setCurrentModel(info);
  }, []);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return (
    <div className="flex h-screen bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {!sidebarCollapsed && (
        <aside className="w-80 border-r border-zinc-200 dark:border-zinc-800/60 flex flex-col bg-white dark:bg-zinc-950">
          <div className="border-b border-zinc-200 dark:border-zinc-800/60">
            <label htmlFor={"select-project"} className="block w-full px-1">
              <select
                id={"select-project"}
                value={selectedProject || ""}
                onChange={(e) => setSelectedProject(e.target.value || null)}
                className="w-full h-[50px] bg-transparent text-zinc-700 dark:text-zinc-300 text-sm focus:outline-none cursor-pointer px-5 py-4"
              >
                <option value="">All Projects</option>
                {projects.map((project) => {
                  const name = project.split("/").pop() || project;
                  return (
                    <option key={project} value={project}>
                      {name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
          <SessionList
            sessions={filteredSessions}
            selectedSession={selectedSession}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            loading={loading}
            selectedSource={selectedSource}
            onSelectSource={setSelectedSource}
            onSearchQueryChange={handleSearchQueryChange}
            searchFn={searchFn}
            searchReady={searchReady}
          />
        </aside>
      )}

      <main className="flex-1 overflow-hidden bg-white dark:bg-zinc-950 flex flex-col">
        <div className="min-h-[50px] border-b border-zinc-200 dark:border-zinc-800/60 flex items-center px-4 py-2 gap-4">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
          >
            <PanelLeft className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
          </button>
          <button
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded transition-colors cursor-pointer"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4 text-zinc-400" />
            ) : (
              <Moon className="w-4 h-4 text-zinc-600" />
            )}
          </button>
          {selectedSessionData && (
            <SessionHeader
              session={selectedSessionData}
              copied={copied}
              modelInfo={currentModel}
              onCopyResumeCommand={handleCopyResumeCommand}
            />
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selectedSession ? (
            <SessionView sessionId={selectedSession} searchQuery={searchQuery} onModelChange={handleModelChange} />
          ) : (
            <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-600">
              <div className="text-center">
                <div className="text-base mb-2 text-zinc-500">
                  Select a session
                </div>
                <div className="text-sm text-zinc-400 dark:text-zinc-600">
                  Choose a session from the list to view the conversation
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
