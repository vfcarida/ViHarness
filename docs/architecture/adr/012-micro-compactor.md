# ADR 012: Micro-Compactor — Stale-Read Tombstoning & Resolved-Failure Compaction

**Status**: Accepted  
**Date**: 2026-09-11  
**Deciders**: Vi-Harness Core Team  
**Category**: Context Engineering

---

## Context

In long-horizon tasks (20–50 iterations), two systematic sources of token bloat degrade context quality and increase cost:

1. **Stale file reads**: A `read_file` call at iteration 2 dumps 200 lines of source code. The agent modifies the file at iteration 5. The original read result remains in the compiled context for iterations 6–50, occupying tokens with content that is no longer valid — causing "stale state hallucinations" where the model reasons about outdated code.

2. **Resolved failure logs**: A compiler error or test failure at iteration 1 produces a 150-line stack trace in the context. The agent fixes the issue at iteration 3 and subsequent runs pass. The original failure log persists in context for iterations 4–50, polluting working memory with information about a resolved problem.

The existing 5-stage compaction pipeline (`Snip → Collapse → Auto-compact → Cache-Aware`) did not have a stage specifically designed to target these two patterns without also compacting unresolved, still-relevant content.

## Decision

Implement a `MicroCompactor` integrated as **Stage 2** of the 5-stage pipeline (between `Snip` and `Collapse`), operating on the iteration history before global summarisation:

1. **Dynamic Stale Read Tombstoning**: When a file path appears in both a `read_file` result at iteration N and a `write_file`/`edit_file` call at a later iteration M, replace the original read result with a compact tombstone: `[Stale Read Tombstone: '<path>' read in iteration #N, superseded by modifications in iteration #M. File content omitted to prevent stale state hallucination.]`

2. **Resolved Failure Compaction**: When a tool command that produced a non-zero exit code at iteration N is re-executed and produces exit code 0 at a later iteration M, compact the original failure output to: `[Resolved Failure: command '<cmd>' failed in iteration #N, subsequently passed in iteration #M. Full stack trace omitted as issue is resolved.]`

3. **Consecutive Redundant Output Collapse**: When the same tool call with identical arguments produces identical output in three or more consecutive iterations, collapse to a single entry with a count annotation.

The `MicroCompactor` operates at the iteration level (not the token level), preserving exact semantics about which content was replaced and why.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Sliding window truncation** | Blindly discards history — may remove unresolved failure evidence or active file reads |
| **Full re-read on every write** | Would flood context with re-reads on every file edit; defeats lazy loading |
| **Model-side deduplication via few-shot prompting** | Non-deterministic; cannot guarantee stale content is suppressed |

## Placement Decision: Stage 2 (Before Collapse)

The `MicroCompactor` runs at Stage 2 rather than Stage 1 (`Snip`) because:
- Stage 1 (`Snip`) handles hard token limits by clipping the oldest messages.
- The `MicroCompactor` handles **semantic invalidity** (stale or resolved content) — a different axis from chronological age.
- Running before `Collapse` (Stage 3) ensures that tombstones and resolution notes are not further summarised away, preserving auditability.

## Consequences

- **Positive**: Eliminates stale-read hallucinations in long-horizon tasks — agents no longer reason about code that has been superseded.
- **Positive**: Resolved failure logs are compacted to single-line notes, freeing context for current working state.
- **Negative**: Tombstoning is irreversible within a session — if the model later needs the original file content, it must re-read the file.
- **Constraint**: Tombstone detection is path-based; moves and renames within the same session may not be detected correctly.
