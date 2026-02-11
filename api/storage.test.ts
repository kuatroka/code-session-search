import { describe, expect, test } from "bun:test";
import type { Session } from "./storage";
import { dedupeSessionsByLatestTimestamp } from "./storage";

describe("dedupeSessionsByLatestTimestamp", () => {
  test("keeps the newest entry for the same session id", () => {
    const sessions: Session[] = [
      {
        id: "s-1",
        display: "old prompt",
        timestamp: 1_000,
        project: "/tmp",
        projectName: "tmp",
        source: "claude",
      },
      {
        id: "s-1",
        display: "latest prompt",
        timestamp: 5_000,
        project: "/tmp",
        projectName: "tmp",
        source: "claude",
      },
    ];

    const deduped = dedupeSessionsByLatestTimestamp(sessions);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.timestamp).toBe(5_000);
    expect(deduped[0]?.display).toBe("latest prompt");
  });

  test("sorts deduped sessions by newest timestamp first", () => {
    const sessions: Session[] = [
      {
        id: "older",
        display: "older",
        timestamp: 2_000,
        project: "/tmp",
        projectName: "tmp",
        source: "factory",
      },
      {
        id: "newer",
        display: "newer",
        timestamp: 7_000,
        project: "/tmp",
        projectName: "tmp",
        source: "claude",
      },
      {
        id: "middle",
        display: "middle",
        timestamp: 4_000,
        project: "/tmp",
        projectName: "tmp",
        source: "codex",
      },
    ];

    const deduped = dedupeSessionsByLatestTimestamp(sessions);

    expect(deduped.map((s) => s.id)).toEqual(["newer", "middle", "older"]);
  });
});
