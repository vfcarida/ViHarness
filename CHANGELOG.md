# Changelog

All notable changes to Vi-Harness are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-11

### Wave 2 — SOTA 2026 Next-Generation Frentes (A–E)

#### 🔁 Frente A (P0): Autonomous Judge-in-the-Loop Iterative Repair Engine
- **runtime**: `JudgeInTheLoopOrchestrator` — executes external judge commands in the target workspace, captures execution output, parses verdicts (`AC`, `WA`, `CE`, `TLE`, `MLE`, `RE`), and extracts compiler error / test failure snippets.
- **cli**: New `solve` flags `--judge-command <cmd>` and `--max-judge-retries <n>` (default: 3) — drives autonomous iterative repair loops against ACMOJ, SWE-bench Docker, Codeforces, or any local judge command.
- **tests**: +15 unit tests in `tests/unit/eval/judge-orchestrator.test.ts`.

#### 🛡️ Frente B (P0): Pre-Write In-Memory AST Syntax & Parse Gate
- **security**: `PreWriteSyntaxGate` — intercepts all `write_file` and `edit_file` calls before disk flush and validates syntax in-memory across TypeScript/JavaScript (TypeScript Compiler API `ts.createSourceFile`), JSON (`JSON.parse` with exact line/column extraction), Python (block delimiter inspection), and all languages (universal bracket balance invariant).
- **infra**: Returns rich, actionable syntax error messages to the model so it self-corrects without polluting the workspace or Git tree.
- **tests**: +15 unit tests in `tests/unit/security/pre-write-syntax-gate.test.ts`.

#### 🔍 Frente C (P1): Batch Semantic Discovery & High-Throughput Code Search
- **tools**: `batch_find_symbols` — resolves multiple symbol declarations, signatures, and AST locations in a single model turn; reduces exploration overhead by up to 70%.
- **tools**: `search_code` — concurrent multi-pattern regex search with path globbing (`includePattern`, `excludePattern`), context-bounded line snippet windows, and configurable max match limits.
- **tests**: +7 unit tests in `tests/unit/tools/batch-semantic-tools.test.ts`.

#### 🔬 Frente D (P1): Dual-Pass Adversarial QA Auditor Gate
- **verification**: `QaAuditorGate` — dual-pass adversarial inspection engine analysing patch hunks for multi-line command injections, unescaped shell concatenations, hardcoded secrets (Shannon entropy thresholding), unchecked `as any` type bypasses, resource leaks (unclosed streams, unhandled file handles), and empty catch blocks swallowing exceptions.
- **cli**: New `solve` flag `--adversarial-qa` — rejects flawed solutions and mandates targeted repair iterations before patch export.
- **tests**: +8 unit tests in `tests/unit/verification/qa-auditor-gate.test.ts`.

#### 🗜️ Frente E (P2): Multi-Tier Dynamic Context Pruning & Micro-Compaction Pipeline
- **compiler**: `MicroCompactor` — dynamic stale-read tombstoning (replaces obsolete `read_file` results with compact tombstones once the file is modified in a later iteration) and resolved-failure compaction (collapses error logs once a subsequent command or test run succeeds).
- **compiler**: Integrated as Stage 2 of the 5-stage compaction pipeline (`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`), seamlessly reducing token bloat in long-horizon tasks (20–50 iterations).
- **tests**: +11 unit tests in `tests/unit/compiler/micro-compactor.test.ts`.

#### 📊 Wave 2 Quality Gate Results
- **Total test suite**: 1,304 passed / 193 files / 0 failures (+56 tests, +28 files from Wave 2).
- **TypeScript typecheck**: 0 errors.
- **ESLint**: 0 errors.
- **Production build**: Clean.
- **Tarball size**: 2,030.4 KB (< 2 MB limit).

---

### Wave 1 — Core CLI & Workspace Tools

#### 🚀 Features
- **cli**: Native standalone `solve` command (`vi-harness solve -p "<task>"` / `vi-harness -p "<task>"` / `vih solve`) for executing autonomous coding tasks headlessly on any repository workspace without out-of-tree wrappers.
- **cli**: Machine-readable JSONL streaming mode (`--mode jsonl`) for clean CI/CD and automated benchmark harness orchestration.
- **tools**: Precision targeted file editing tool (`edit_file`) using search-and-replace block replacement to eliminate whole-file overwriting and prevent signature regression bugs.
- **tools**: Git rollback tool (`revert_file`) enabling agents to discard changes and recover from catastrophic build errors.
- **tools**: Shell execution (`run_command`) with automatic compiler warning detection (`-Wall -Wextra -Werror`), notifying the agent to eliminate all warnings prior to completion.
- **tools**: Real filesystem tools (`read_file`, `write_file`, `list_directory`) with path traversal denial and directory creation.
- **syntax**: Automatic RepoMap context injection on startup in `solve`, including C and C++ AST/regex symbol extraction (`SourceCodeIndexer`).
- **model**: OpenRouter generation ID (`x-openrouter-generation-id`) and exact provider-reported cost tracking.
- **reliability**: Post-edit syntax integrity alert hook detecting unclosed braces (`{ }`, `( )`, `[ ]`) and malformed JSON before compiler invocation.
- **runtime**: Configurable request timeouts (`VI_HARNESS_REQUEST_TIMEOUT_MS`, default 180s) and retries (`VI_HARNESS_MAX_RETRIES`).

## [0.1.0] - 2026-08-19

### 🚀 Features
- **runtime**: Architect Mode (Dual-Model Plan→Execute) with pre-step interception waterfalls.
- **goal**: Event-sourced goal lifecycle with token budgets, round limits, and hierarchical child attribution.
- **memory**: Frozen memory snapshot, skills catalog, and background self-improvement loop.
- **session**: Tree-structured session branching, derived model history, crash recovery, and JSONL persistence.
- **telemetry**: Outer-loop experience accumulation and auto-tuning diagnostics (Meta-Harness pattern).
- **eval**: First-class ProjDevBench generative project benchmark integration.
- **eval**: Terminal-Bench (TBench 2.0 / Harbor framework) containerized evaluation suite.
- **mcp**: Production stdio and HTTP/SSE MCP transports with JSON-RPC 2.0.
- **acp**: Agent Client Protocol (ACP) automation server for headless CI and multi-agent orchestrators.
- **storage**: Persistent SQLite storage with WAL mode, generic KV with TTL, and Hermes memory lifecycle curation.
- **distribution**: Distribution profiles (`web`, `headless`, `ci`, `eval`), npm packaging, and auto-update checker.
