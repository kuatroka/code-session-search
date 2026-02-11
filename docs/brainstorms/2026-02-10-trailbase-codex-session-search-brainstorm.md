---
date: 2026-02-10
topic: trailbase-codex-session-search
---

# TrailBase-Powered Local Search for Codex Sessions

## What We're Building

A single-user, local-first searchable archive for Codex session data stored in `.jsonl` files.  
The product focus is instant retrieval of past sessions and messages, not collaboration or multi-user workflows.

V1 scope is:
- Hybrid ingestion: one bulk import of existing session history, then tailing for newly appended lines.
- Keyword and phrase search (no semantic search in v1).
- Result highlights plus practical filters (project, date, model).
- Performance-first user experience for local, single-user usage at up to 100k messages.

Performance targets selected for v1:
- Query latency under 30ms for typical searches.
- New data freshness within 1-2 seconds from append-to-searchable after initial app startup ingest is complete.

## Why This Approach

We evaluated three options:
- TrailBase-centered architecture (chosen)
- Dual-system (TrailBase + separate search engine)
- Existing app first, TrailBase later

The chosen direction is TrailBase-centered because it best matches local-first simplicity for this v1 scope. It keeps the system coherent, reduces synchronization complexity, and still supports high-performance indexing/search for the current target scale. This is the lowest-complexity path that still meets the performance objective.

## Key Decisions

- Build a single-user local app first.
- Use a TrailBase-centered architecture as the primary backend for this feature.
- Use hybrid ingestion: initial bulk import + incremental tailing.
- Accept initial app startup ingest taking a few seconds.
- Prioritize keyword/phrase search with highlights and filters in v1.
- Defer semantic search until after v1 performance goals are met.
- Define typical query acceptance behavior: user types a term (for example `wa-SQLite`) in the search box above the left session list, matching sessions appear in under 30ms, and the right pane shows the first matching session with an excerpt block where the term appears.
- Set explicit SLA targets: `<30ms` query latency and `1-2s` ingest-to-search freshness at 100k messages after initial startup ingest.
- Keep scope tightly focused on search UX and performance over additional feature breadth.

## Open Questions

- Which exact filter set is required in v1 beyond project/date/model (for example: source, tool usage, error-only)?
- What is the minimum acceptable behavior if dataset size exceeds 100k messages during validation?
- What lightweight observability should be present in v1 to verify SLA compliance continuously?

## Next Steps

-> `/prompts:workflows-plan` for implementation details.
