export const FTS_TOKENIZER = "unicode61";

const MIN_TOKEN_LENGTH = 3;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(Boolean) || [];
}

export function buildFtsQuery(query: string): string {
  const tokens = tokenizeQuery(query);

  if (tokens.length === 0) {
    const fallback = query.trim();
    return fallback ? `"${fallback.replace(/"/g, '""')}"` : "";
  }

  // Filter out very short tokens (1-2 chars) when longer tokens exist.
  // Short tokens like "wa" from "wa-sqlite" match too broadly (e.g. "was").
  const longTokens = tokens.filter((t) => t.length >= MIN_TOKEN_LENGTH);
  const searchTokens = longTokens.length > 0 ? longTokens : tokens;

  return searchTokens.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");
}

function stripSearchMarkup(text: string): string {
  return text.replace(/<\/?mark[^>]*>/g, "");
}

/**
 * Check how many query tokens appear in the text.
 * Returns a ratio 0..1 of tokens found.
 */
function tokenCoverage(query: string, text: string): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 0;
  const normalizedText = text.toLowerCase();
  const found = tokens.filter((t) => normalizedText.includes(t));
  return found.length / tokens.length;
}

export function getExactMatchBoost(query: string, searchText: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 0;

  const normalizedSearchText = stripSearchMarkup(searchText).toLowerCase();

  // Strongest: exact literal match (preserves punctuation like "wa-sqlite")
  if (normalizedSearchText.includes(normalizedQuery)) {
    return 4;
  }

  // Strong: all tokens present adjacent (e.g. "wa sqlite" found as "wa sqlite")
  const tokens = tokenizeQuery(query);
  if (tokens.length > 1 && normalizedSearchText.includes(tokens.join(" "))) {
    return 3;
  }

  // Moderate: all tokens present as whole words in the text
  const allTokensPresent = tokens.every((t) => {
    const wordBoundary = new RegExp(`(?:^|[\\W_])${escapeRegex(t)}(?:$|[\\W_])`);
    return wordBoundary.test(normalizedSearchText);
  });
  if (tokens.length > 0 && allTokensPresent) {
    return 2;
  }

  // Weak: at least some long tokens present as whole words
  const longTokens = tokens.filter((t) => t.length >= MIN_TOKEN_LENGTH);
  if (longTokens.length > 0 && longTokens.some((t) => {
    const wordBoundary = new RegExp(`(?:^|[\\W_])${escapeRegex(t)}(?:$|[\\W_])`);
    return wordBoundary.test(normalizedSearchText);
  })) {
    return 1;
  }

  return 0;
}

type RankedSearchRow = {
  rank: number;
  timestamp: number;
  display: string;
  project: string;
  snippet: string;
  searchText?: string;
};

export function rerankSearchRows<T extends RankedSearchRow>(rows: T[], query: string): T[] {
  return [...rows]
    .map((row) => {
      const text = row.searchText ?? `${row.display}\n${row.project}\n${row.snippet}`;
      const boost = getExactMatchBoost(query, text);
      const snippetText = stripSearchMarkup(row.snippet);
      const coverage = tokenCoverage(query, snippetText);
      return { ...row, _boost: boost, _coverage: coverage };
    })
    .sort((a, b) => {
      // Primary: exact match boost tier
      if (a._boost !== b._boost) return b._boost - a._boost;

      // Secondary: penalize results where snippet has no visible query terms
      // (the match is buried deep in content, not useful to the user)
      if (a._coverage > 0 && b._coverage === 0) return -1;
      if (a._coverage === 0 && b._coverage > 0) return 1;

      // Tertiary: BM25 rank
      if (a.rank !== b.rank) return a.rank - b.rank;

      // Finally: most recent first
      return b.timestamp - a.timestamp;
    })
    .map(({ _boost: _, _coverage: __, ...row }) => row as T);
}
