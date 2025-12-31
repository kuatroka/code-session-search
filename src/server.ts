import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { Server } from "http";
import { ClaudeStorage } from "./storage.js";
import { ClaudeWatcher } from "./watcher.js";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerOptions {
  port: number;
  claudeDir?: string;
  dev?: boolean;
}

export function createServer(options: ServerOptions) {
  const { port, claudeDir, dev = false } = options;

  const storage = new ClaudeStorage(claudeDir);
  const watcher = new ClaudeWatcher(storage.getClaudeDir());

  const app = new Hono();

  if (dev) {
    app.use(
      "*",
      cors({
        origin: ["http://localhost:12000"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type"],
      })
    );
  }

  app.get("/api/sessions", async (c) => {
    const sessions = await storage.getSessions();
    return c.json(sessions);
  });

  app.get("/api/projects", async (c) => {
    const projects = await storage.getProjects();
    return c.json(projects);
  });

  app.get("/api/sessions/stream", async (c) => {
    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        watcher.off("historyChange", onHistoryChange);
      };

      const onHistoryChange = async () => {
        if (!isConnected) {
          return;
        }
        try {
          const sessions = await storage.getSessions();
          await stream.writeSSE({
            event: "sessions",
            data: JSON.stringify(sessions),
          });
        } catch {
          cleanup();
        }
      };

      watcher.on("historyChange", onHistoryChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const sessions = await storage.getSessions();
        await stream.writeSSE({
          event: "sessions",
          data: JSON.stringify(sessions),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  app.get("/api/conversation/:id", async (c) => {
    const sessionId = c.req.param("id");
    const messages = await storage.getConversation(sessionId);
    return c.json(messages);
  });

  app.get("/api/conversation/:id/stream", async (c) => {
    const sessionId = c.req.param("id");
    const offsetParam = c.req.query("offset");
    let offset = offsetParam ? parseInt(offsetParam, 10) : 0;

    return streamSSE(c, async (stream) => {
      let isConnected = true;

      const cleanup = () => {
        isConnected = false;
        watcher.off("sessionChange", onSessionChange);
      };

      const onSessionChange = async (changedSessionId: string) => {
        if (changedSessionId !== sessionId || !isConnected) {
          return;
        }

        const { messages: newMessages, nextOffset: newOffset } =
          await storage.getConversationStream(sessionId, offset);
        offset = newOffset;

        if (newMessages.length > 0) {
          try {
            await stream.writeSSE({
              event: "messages",
              data: JSON.stringify(newMessages),
            });
          } catch {
            cleanup();
          }
        }
      };

      watcher.on("sessionChange", onSessionChange);
      c.req.raw.signal.addEventListener("abort", cleanup);

      try {
        const { messages, nextOffset } = await storage.getConversationStream(
          sessionId,
          offset
        );
        offset = nextOffset;

        await stream.writeSSE({
          event: "messages",
          data: JSON.stringify(messages),
        });

        while (isConnected) {
          await stream.writeSSE({
            event: "heartbeat",
            data: JSON.stringify({ timestamp: Date.now() }),
          });
          await stream.sleep(30000);
        }
      } catch {
        // Connection closed
      } finally {
        cleanup();
      }
    });
  });

  const webDistPath = join(__dirname, "..", "web-dist");

  app.use("/*", serveStatic({ root: webDistPath }));

  app.get("/*", async (c) => {
    const indexPath = join(webDistPath, "index.html");
    try {
      const html = readFileSync(indexPath, "utf-8");
      return c.html(html);
    } catch {
      return c.text("UI not found. Run 'pnpm build' first.", 404);
    }
  });

  watcher.start();

  let httpServer: Server | null = null;

  return {
    app,
    port,
    storage,
    watcher,
    start: () => {
      console.log(`\n  claude-run is running at http://localhost:${port}/\n`);
      httpServer = serve({
        fetch: app.fetch,
        port,
      });
      return httpServer;
    },
    stop: () => {
      watcher.stop();
      if (httpServer) {
        httpServer.close();
      }
    },
  };
}
