# Changelog

All notable changes to Vi-Harness are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-08-25

### 🚀 Features
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
