import { describe, expect, test } from "bun:test";
import {
  FTS_TOKENIZER,
  buildFtsQuery,
  getExactMatchBoost,
  rerankSearchRows,
} from "./search-ranking";

type RankedRow = {
  sessionId: string;
  display: string;
  project: string;
  snippet: string;
  timestamp: number;
  rank: number;
  searchText: string;
};

describe("search relevance ranking", () => {
  test("uses unicode61 tokenizer to reduce stemming false positives", () => {
    expect(FTS_TOKENIZER).toBe("unicode61");
  });

  test("buildFtsQuery drops short tokens when longer ones exist", () => {
    // "wa" (2 chars) is dropped, only "sqlite" (6 chars) remains
    expect(buildFtsQuery("wa-sqlite")).toBe('"sqlite"');
  });

  test("buildFtsQuery keeps short tokens when all tokens are short", () => {
    expect(buildFtsQuery("go")).toBe('"go"');
    expect(buildFtsQuery("a-b")).toBe('"a" "b"');
  });

  test("exact literal gets boost 4", () => {
    expect(getExactMatchBoost("wa-sqlite", "We use wa-sqlite in the browser")).toBe(4);
  });

  test("adjacent tokens get boost 3", () => {
    expect(getExactMatchBoost("wa-sqlite", "We use wa sqlite in the browser")).toBe(3);
  });

  test("all tokens present gets boost 2", () => {
    expect(getExactMatchBoost("wa-sqlite", "We use wa and also sqlite")).toBe(2);
  });

  test("only long tokens present gets boost 1", () => {
    expect(getExactMatchBoost("wa-sqlite", "It was a sqlite migration")).toBe(1);
  });

  test("no tokens present gets boost 0", () => {
    expect(getExactMatchBoost("wa-sqlite", "something completely unrelated")).toBe(0);
  });

  test("rerank promotes exact literal match over partial matches", () => {
    const rows: RankedRow[] = [
      {
        sessionId: "partial",
        display: "Session A",
        project: "proj",
        snippet: "...it was a <mark>sqlite</mark> migration...",
        timestamp: 100,
        rank: -7.5,
        searchText: "it was a sqlite migration",
      },
      {
        sessionId: "exact",
        display: "Session B",
        project: "proj",
        snippet: "...using <mark>wa-sqlite</mark> in browser...",
        timestamp: 90,
        rank: -7.4,
        searchText: "using wa-sqlite in browser",
      },
    ];

    const reranked = rerankSearchRows(rows, "wa-sqlite");
    expect(reranked[0]?.sessionId).toBe("exact");
  });

  test("rerank penalizes results with no query tokens in snippet", () => {
    const rows: RankedRow[] = [
      {
        sessionId: "no-highlight",
        display: "Session A",
        project: "proj",
        snippet: "...zero sync, powersync, jazz...",
        timestamp: 100,
        rank: -8.0,
        searchText: "zero sync, powersync, jazz, also sqlite somewhere",
      },
      {
        sessionId: "has-highlight",
        display: "Session B",
        project: "proj",
        snippet: "...in-memory <mark>sqlite</mark> for search...",
        timestamp: 90,
        rank: -7.0,
        searchText: "in-memory sqlite for search",
      },
    ];

    const reranked = rerankSearchRows(rows, "wa-sqlite");
    expect(reranked[0]?.sessionId).toBe("has-highlight");
  });
});
