# ADR 009: Pre-Write In-Memory AST Syntax & Parse Gate

**Status**: Accepted  
**Date**: 2026-09-11  
**Deciders**: Vi-Harness Core Team  
**Category**: Security & Workspace Integrity

---

## Context

LLM-generated code edits — especially search-and-replace block operations — can introduce syntactically invalid content: unclosed braces, missing semicolons, malformed JSON, or truncated Python blocks. When written directly to disk, these corrupt the Git working tree and break downstream compiler and test runs, requiring manual intervention to restore a clean state.

The agent's error recovery relied on observing compiler failures after disk writes — a reactive, expensive, and imprecise mechanism that could result in multiple invalid states persisted to disk before detection.

## Decision

Implement a `PreWriteSyntaxGate` that intercepts all `write_file` and `edit_file` tool calls **before** disk flush and validates the proposed content in-memory:

- **TypeScript / JavaScript**: Full AST parse via TypeScript Compiler API `ts.createSourceFile` at `ScriptTarget.Latest`, inspecting `parseDiagnostics` for syntactic errors.
- **JSON**: `JSON.parse` with extraction of exact line and column from the native parse error.
- **Python**: In-memory block delimiter and docstring inspection heuristic.
- **Universal**: Bracket balance invariant check (`()`, `[]`, `{}`) across all language types.

On validation failure, the gate returns a rich error message (with file type, line number, column, and error detail) directly to the model without touching the disk. The model then self-corrects in the next turn.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Post-write compiler check** | Requires an actual disk write and compiler invocation; corrupts the working tree before detection |
| **Full AST parse for all languages** | Tree-sitter wasm parsers for 20+ languages would add latency and binary size; language-targeted heuristics are sufficient for the most common failure modes |
| **Reject all edits over a size limit** | Too coarse — large legitimate refactors would be blocked |

## Consequences

- **Positive**: Eliminates an entire class of workspace corruption failures before they reach disk.
- **Positive**: Rich error messages with exact line/column enable the model to self-correct immediately in the next turn.
- **Negative**: TypeScript AST parsing adds ~5–20ms latency per write operation on large files.
- **Constraint**: Python validation is heuristic-based (not full AST) — some edge cases (e.g., complex decorator patterns) may pass the gate with superficial validity.
