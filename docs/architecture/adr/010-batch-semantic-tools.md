# ADR 010: Batch Semantic Discovery & Multi-Pattern Code Search

**Status**: Accepted  
**Date**: 2026-09-11  
**Deciders**: Vi-Harness Core Team  
**Category**: Code Intelligence & Tool Design

---

## Context

When an agent needs to understand a codebase — locating class definitions, finding all callers of a function, or searching for specific patterns — it previously had to issue multiple sequential tool calls: one `find_definition` call per symbol, one `search_code` call per pattern. Each roundtrip consumes a full model inference turn, adding latency and prompt token overhead proportional to the number of lookups required.

In a typical refactoring or debugging task, an agent might need to look up 5–10 symbols and search for 3–5 patterns before forming an action plan. Under the previous design, this produced 8–15 consecutive tool calls before any code change occurred — a significant exploration overhead.

## Decision

Implement two batch tools registered in `createWorkspaceTools`:

1. **`batch_find_symbols`**: Accepts an array of symbol names (e.g., `['AuthService', 'TokenValidator', 'SessionStore']`) and returns a grouped map of declarations, type signatures, file locations, and AST context for all symbols in a single model turn.

2. **`search_code`**: Accepts an array of regex patterns with optional `includePattern` / `excludePattern` glob filters, executes all searches concurrently via `Promise.all`, and returns grouped results with configurable context-window line snippets and max match limits.

Both tools are concurrency-safe (`isConcurrencySafe: true`) and eligible for parallel execution in the same barrier group as other read operations.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Sequential individual lookups** | O(N) roundtrips — unacceptable for discovery phases with many symbols |
| **Full codebase index dump in system prompt** | Token-prohibitive for large repos; defeats the purpose of lazy context loading |
| **Server-side pre-computation only** | Would require a persistent index server process — contradicts the zero-infrastructure deployment model |

## Consequences

- **Positive**: Reduces exploration overhead by up to 70% for multi-symbol discovery tasks.
- **Positive**: Concurrent search execution (`Promise.all`) keeps wall-clock latency near that of a single search.
- **Negative**: Larger individual tool responses require output spill for result sets exceeding the 10K character limit.
- **Constraint**: Symbol resolution accuracy is bounded by the quality of the underlying AST/regex indexer; TypeScript symbols resolve with full type information, while other languages use regex-based approximations.
