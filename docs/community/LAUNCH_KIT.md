# 🚀 Vi-Harness Community Launch Kit

> **Ready-to-publish launch copies, technical threads, and multi-channel announcement templates for Vi-Harness v0.2.0.**

This kit contains meticulously tailored launch announcements designed for engineering communities:
1. [Hacker News: Show HN](#1-hacker-news-show-hn)
2. [Reddit: r/LocalLLaMA & r/programming](#2-reddit-rlocalllama--rprogramming)
3. [Twitter / X: 10-Tweet Technical Breakdown](#3-twitter--x-10-tweet-technical-breakdown)
4. [Discord & Developer Communities](#4-discord--developer-communities)
5. [GitHub Release Notes (v0.2.0)](#5-github-release-notes-v020)

---

## 1. Hacker News (Show HN)

### Title
```text
Show HN: Vi-Harness – Open-source coding agent runtime with sublinear context and AST gates
```

### Post Body
```markdown
Hey HN,

Over the past six months, we studied the failure modes of long-horizon autonomous coding agents across hundreds of SWE-bench and real-world repository tasks. The dominant bottlenecks are consistent:

1. **Context Bloat & Token Degradation**: Naive conversation-based agents treat coding as an endless chat transcript ($O(N)$ token explosion). As context grows, models experience loss-in-the-middle attention degradation and start hallucinating file paths.
2. **Destructive Disk Regressions**: Models propose invalid syntax or half-finished diffs that corrupt the local workspace, breaking previously passing tests and forcing frantic back-and-forth debugging loops.
3. **Premature Self-Conclusion**: An LLM will say "I have fixed the issue and verified all tests" without actually running the test suite or verifying that the patch builds.
4. **Dependency Bloat**: Many agent frameworks pull in hundreds of transitive dependencies, making them fragile to install and impossible to embed cleanly into CI/CD pipelines.

To solve this, we built **Vi-Harness** (`vi-harness`): a deterministic, stateful coding agent runtime designed from first principles.

### Key Architectural Decisions

- **Stateful 14-Phase FSM**: The agent is not a conversation; it is an evidence-driven finite state machine (`INIT -> EXPLORE -> PLAN -> IMPLEMENT -> VERIFY -> REPAIR -> DONE`). Crucially, the LLM cannot directly declare success. Transitions require verifiable evidence (exit codes, test runner envelopes, AST checkpoints).
- **Sublinear Context Compiler ($O(\log N)$)**: Context is compiled on demand before every model turn through a 6-stage pipeline: retrieval -> secret scrubbing -> deduplication -> relevance ranking -> progressive AST skeleton compaction -> invariant validation. We observe up to 88% token spend reduction across 50+ iteration sessions.
- **Pre-Write AST Syntax Gate**: Proposed edits pass through a TypeScript/Python/Rust AST parser in memory before touching disk. Syntax errors are rejected immediately with structured diagnostics, preventing disk corruption.
- **Judge-in-the-Loop Interception**: When the agent attempts to conclude, an independent subprocess executes configured verification commands (`--judge-command "npm test"`). If the judge fails, the workspace transitions back to `REPAIR` with an atomic git rollback option.
- **Zero-Bloat Runtime**: Exactly 3 production dependencies (`better-sqlite3`, `uuid`, `zod`). Native Node `fetch` is used for all LLM calls (OpenAI, Anthropic Claude with native prompt caching, DeepSeek, vLLM, Ollama, Google Gemini, AWS Bedrock).
- **100% Test Rigor**: 1,325 tests passing across 196 test files with zero mocks in the verification pipeline.

### Quick Start

Run an autonomous repair session on any local repository in one command:

```bash
npx vi-harness solve -p "Fix timing race in session validator and verify" --judge-command "npm test"
```

Or launch the interactive TUI REPL:

```bash
npx vi-harness chat
```

- GitHub: https://github.com/vfcarida/Vi-Harness
- Architecture Tour: https://github.com/vfcarida/Vi-Harness/blob/main/docs/architecture/tour.md
- npm: https://www.npmjs.com/package/vi-harness

We would love your feedback on the architecture, token compiler, and state machine invariants!
```

---

## 2. Reddit: r/LocalLLaMA & r/programming

### Subreddit: `r/LocalLLaMA`
**Title:**
```text
Vi-Harness: Run local coding agents (DeepSeek-R1, Qwen 2.5 Coder, vLLM, Ollama) with 88% token savings & AST syntax gates
```

**Body:**
```markdown
Hey everyone,

If you’ve tried running autonomous coding agents locally using Ollama or vLLM with DeepSeek-R1 or Qwen 2.5 Coder, you’ve probably hit the classic local context wall:
1. The chat history explodes past 32k tokens after 10 iterations.
2. Inference speed grinds down to a crawl as KV caches grow.
3. The model hallucinates incomplete search-and-replace syntax and breaks the codebase.

We built **Vi-Harness** to solve these exact issues. It’s an open-source, model-agnostic coding agent runtime built in TypeScript with zero bloat (only 3 dependencies).

### Why it works well for local LLMs:

1. **Prefix Caching & Context Compaction**: Instead of feeding raw file dumps into the prompt, Vi-Harness compiles a multi-tier context window (`L0` invariants, `L1` working memory, `L2` episodic summaries, `L3` repo outline). Outdated file reads are automatically tombstoned, achieving up to 88% token reduction over long runs.
2. **PreWriteSyntaxGate**: Before any file write is allowed on disk, the patch is checked by an AST parser. If DeepSeek or Qwen emits invalid syntax or misses a closing bracket, the write is blocked before damaging your files, and the syntax diagnostic is fed back as an observation.
3. **Two-Phase Git Isolation**: Every iteration is backed by atomic git checkpoints. If a local model goes into an edit loop, you can roll back with zero lost work.
4. **Direct OpenAI-Compatible & Local Endpoints**: Point it directly to your local vLLM or Ollama instance without any proxies or vendor SDKs.

### Try it with Ollama:

```bash
# Point to your local Ollama or vLLM server
npx vi-harness solve \
  --base-url http://localhost:11434/v1 \
  -m qwen2.5-coder:32b \
  -p "Implement session refresh middleware and unit tests" \
  --judge-command "npm test"
```

GitHub: https://github.com/vfcarida/Vi-Harness  
Documentation & Tour: https://github.com/vfcarida/Vi-Harness/blob/main/docs/architecture/tour.md

Let us know what models you test it with!
```

---

## 3. Twitter / X: 10-Tweet Technical Breakdown

**Tweet 1 (Hook + Visual)**:
```text
🚨 Introducing Vi-Harness: The deterministic, open-source coding agent runtime built to eliminate token bloat and destructive regressions.

• 14-phase state machine
• Sublinear context compiler (88% token savings)
• Pre-write AST syntax gate
• Exactly 3 dependencies

A thread on how it works 🧵👇
[Attach docs/assets/terminal-demo.svg]
```

**Tweet 2 (The Problem)**:
```text
2/ Most coding agents treat engineering as an endless chat transcript.

Turn 1 ──> Turn 2 ──> Turn 3 ──> Turn 50

Token count explodes O(N). The model suffers from loss-in-the-middle attention degradation, forgets core requirements, and starts corrupting files.
```

**Tweet 3 (The FSM Architecture)**:
```text
3/ In Vi-Harness, the agent is NOT a conversation.

It is an evidence-driven 14-phase Finite State Machine:
INIT ➔ EXPLORE ➔ PLAN ➔ IMPLEMENT ➔ VERIFY ➔ REPAIR ➔ DONE.

Crucially: The LLM CANNOT self-declare completion. Transitions require verifiable evidence.
```

**Tweet 4 (Context Compiler)**:
```text
4/ "Context is compiled, not accumulated."

Before each turn, Vi-Harness runs a 6-stage compiler:
1. Retrieval
2. Secret scrubbing
3. Content deduplication
4. Relevance ranking
5. AST signature compaction
6. Invariant budget enforcement

Result: 85-89% token savings across 100 iterations.
```

**Tweet 5 (AST Safety Barrier)**:
```text
5/ Ever had an agent write broken code that breaks your build before you can even test?

Vi-Harness includes a Pre-Write AST Syntax Gate:
If a proposed patch introduces parse errors in TypeScript, Python, or Rust, the write is aborted before touching disk. Zero intermediate corruption.
```

**Tweet 6 (Judge-in-the-Loop)**:
```text
6/ No more "I have verified the code" hallucinations.

Vi-Harness features Judge-in-the-Loop interception:
When the agent claims completion, an isolated judge subprocess runs your actual test command (`npm test`, `pytest`). If the judge fails, the agent is routed back to REPAIR.
```

**Tweet 7 (Model Agnostic & Native Caching)**:
```text
7/ Built for model diversity with zero vendor SDK lock-in:

• Native Anthropic (Claude 3.7 / 3.5 Sonnet with prompt caching)
• OpenAI (o3-mini, GPT-4o)
• DeepSeek (R1, V3)
• Local models (vLLM, Ollama, LM Studio)
• AWS Bedrock & Google Gemini

All using native Node fetch.
```

**Tweet 8 (Zero Bloat & Engineering Rigor)**:
```text
8/ Zero runtime bloat:
The entire package relies on strictly 3 production dependencies:
- better-sqlite3 (ACID event sourcing)
- uuid (RFC 9562 UUIDv7)
- zod (schema validation)

TypeScript strict mode throughout.
1,325 tests passing across 196 test files.
```

**Tweet 9 (Try it now)**:
```text
9/ Get started immediately with npx — zero global setup required:

# Autonomous problem solving
npx vi-harness solve -p "Fix race condition in auth validator"

# Interactive terminal dashboard
npx vi-harness chat
```

**Tweet 10 (Links & Community)**:
```text
10/ Vi-Harness is 100% open source under the MIT License.

⭐ Star the repo on GitHub: https://github.com/vfcarida/Vi-Harness
📦 npm: https://www.npmjs.com/package/vi-harness
📖 Architecture Tour: https://github.com/vfcarida/Vi-Harness/blob/main/docs/architecture/tour.md

Built by studying the best patterns in AI engineering. What would you build with it?
```

---

## 4. Discord & Developer Communities

**Channels:** `#announcements`, `#ai-agents`, `#open-source`, `#showcase`

```markdown
Hey everyone! 👋

We just published **Vi-Harness v0.2.0** — an open-source autonomous coding agent harness designed to solve context degradation and unverified file regressions.

**Highlights:**
- 🛡️ **PreWriteSyntaxGate**: Blocks syntax errors in TypeScript/Python/Rust before writing to disk.
- ⚡ **Sublinear Context Compiler**: Achieves up to 88% token reduction via multi-tier memory and AST skeleton pruning.
- 🧠 **Native Claude Prompt Caching**: Native Anthropic Messages API support with ephemeral caching breakpoints.
- ⚖️ **Judge-in-the-Loop**: Prevents premature completion by intercepting termination proposals with real test runners.
- 📦 **Zero-Bloat**: Exactly 3 dependencies, 1,325 passing tests.

**Try it out:**
```bash
npx vi-harness solve -p "Your task description" --judge-command "npm test"
```

Check out the GitHub repo and interactive architecture guide:
👉 https://github.com/vfcarida/Vi-Harness
👉 https://github.com/vfcarida/Vi-Harness/blob/main/docs/architecture/tour.md

Feedback, PRs, and questions are very welcome!
```

---

## 5. GitHub Release Notes (v0.2.0)

```markdown
# Vi-Harness v0.2.0 — Deterministic Coding Agent Runtime

Vi-Harness v0.2.0 delivers production-grade agent execution with native Anthropic Claude prompt caching, sublinear context compilation, pre-write AST syntax barriers, and terminal dashboard telemetry.

### 🌟 What's New in v0.2.0

- **Native Anthropic Model Provider**:
  - Direct HTTP `fetch` adapter with zero vendor SDK overhead.
  - Native prompt caching breakpoints (`cache_control: { type: 'ephemeral' }`) across system prompts and tool definitions.
  - Real-time cache metrics (`cacheReadTokens`, `cacheWriteTokens`) and token pricing calculations.
  - Streaming SSE parser supporting text and tool call deltas.

- **PreWriteSyntaxGate**:
  - Validates patch syntax in memory (TypeScript, JavaScript, Python, Rust) before mutating the filesystem.
  - Aborts broken writes and emits structured syntax error feedback.

- **Interactive Architecture Tour**:
  - Added [`docs/architecture/tour.md`](./docs/architecture/tour.md) with complete walkthroughs of the 14 FSM states, 6-stage context compiler, and developer extension recipes.

- **Terminal Visual Showcase**:
  - Modern, responsive SVG terminal UI asset ([`docs/assets/terminal-demo.svg`](./docs/assets/terminal-demo.svg)) integrated into the README.

- **Automated Release Pipeline**:
  - Comprehensive maintainer runbook ([`docs/operations/RELEASE.md`](./docs/operations/RELEASE.md)) with GitHub Actions provenance, GHCR container publication, and rollback runbooks.

### 🧪 Verification & Test Suite Metrics

- **1,325 passing tests** across **196 test files** (0 failures).
- Automated README badge verification guard (`npm run check-readme-badge`).
- Zero ESLint errors and strict TypeScript compilation (`tsc --noEmit`).

### 📦 Installation

```bash
npm install -g vi-harness@0.2.0
# or run directly
npx vi-harness solve --help
```
```
