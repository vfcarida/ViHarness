# Vi-Harness: Deep Research & Literature Review

## 1. Executive Summary

This report documents the theoretical, empirical, and architectural research informing the design of **Vi-Harness**. It synthesizes:
1. **Wave 1 & 2 Execution Foundations:** Meta-Harness, Claude Code, Pi, Hermes, Prime Agent, Aider, and DeepSeek Harness.
2. **Wave 3–10 Recursive Harness Evolution (2026):** **Harness²** (Google Research, [`arXiv:2610.14224v1`](https://arxiv.org/html/2610.14224v1), [`https://github.com/google-research/harness2`](https://github.com/google-research/harness2)) and the companion papers and formal verification methods that redefined self-evolving agent harnesses in 2026.

---

## 2. Foundational Execution Pillars

### 2.1. Meta-Harness: Outer-Loop Harness Engineering (Stanford IRIS Lab, arXiv:2603.28052)
- **Core Thesis:** Rather than treating prompt templates and tool orchestration as fixed artifacts, the agent harness itself should be optimized through causal analysis of execution traces.
- **Vi-Harness Adoption:** `MetaHarnessTraceLogger`, `TraceDistiller`, and `HarnessDiagnosticEngine`.

### 2.2. Claude Code: Operating System for AI Coding Agents (Anthropic, arXiv:2604.14228)
- **Core Thesis:** Coding agents require an operating system layer that guarantees non-bypassable security permissions, deterministic tool sandboxing, and progressive context compaction.
- **5-Stage Compaction Model:** `Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware` (implemented in `ContextCompressor`, `MicroCompactor`, and `CachePrefixTracker`).

### 2.3. Pi, Hermes, Prime Agent, Aider & DeepSeek Harness
- **Pi (pi.dev):** Model-agnostic provider abstraction and tree-structured sessions.
- **Hermes:** Durable memory decoupled from conversational history (`FrozenMemorySnapshot`, `SkillExtractor` with both success and failure pattern extraction).
- **Prime Agent:** Isolated subagent delegation with structured artifact/evidence returns.
- **Aider:** AST-indexed PageRank repository maps (`SourceCodeIndexer`).
- **DeepSeek Harness:** Composable DI modules and distribution profiles.

---

## 3. The 2026 Recursive Harness Evolution Wave

### 3.1. Harness²: Recursive Agent Harnessing for an Open World (Google Research, Oct 2026, [arXiv:2610.14224v1](https://arxiv.org/html/2610.14224v1) | [google-research/harness2](https://github.com/google-research/harness2))
- **Core Formalization:** A harness is an explicit tuple of editable components $H = (c_1, \dots, c_K)$ around a frozen-weight model.
- **Coupled Dual Recursion:**
  1. **Task-Level Recursion (Propose–Probe–Compose):** Generates invariant and domain-specific candidates, executes paired probes on the task without ground-truth rubric leakage, analyzes behavioral contrasts, and selectively composes component changes.
  2. **Cross-Task Recursion:** Reflects on contrastive evidence to populate an executable experience library while starting every new task from a canonical baseline $H_0$ to prevent cumulative specialization drift.
- **Vi-Harness Synthesis & Zero-Trust Advancement:** Vi-Harness implements the full Propose–Probe–Compose dual recursion (`RecursiveEvolutionEngine`), 8+4 component `HarnessManifest`, and `EightComponentAdapter`, while closing Harness²'s documented operational security gap (unrestricted network egress and disabled sandboxing) via `HarnessConstitution`, `IsolatedHarnessProbeRunner`, `WorktreeProbeSandboxManager`, `StructuralPolicyInvariantVerifier`, `RuntimeTemporalContractMonitor`, and `ConformalAbstentionGuard`.

### 3.2. Falsifiable Observability, Regularization, Held-Out Admission & Retention
- **Agentic Harness Engineering (AHE):** Component, experience, and decision observability; every edit predeclared as a falsifiable `HarnessChangeHypothesis` (`src/core/evolution/hypothesis.ts`).
- **HarnessCompass:** Component-wise constrained evolution minimizing cross-component interference (`DefaultHarnessComposer`).
- **RRSI (Regularized Recursive Self-Improvement):** Temporally annealed edit budgets, novelty scoring, `BenchmarkSpecificityCritic`, `GeneralizationCritic`, and `HarnessPruner` (`DefaultCandidateRegularizer`).
- **HarnessOpt-Bench & Rethinking Eval of Harness Evolution:** Inaccessible held-out target partitions (`callerRole === 'admission_gate'`) and matched-budget comparisons against `seed_harness`, `best_of_n_search`, and `extra_reasoning_budget` (`EvolutionBenchmarkProtocol`).
- **EvoHarnessBench:** Detection of harness-induced forgetting across 11 capability categories (`RetentionSuiteRunner` tracking `retained`, `newly_acquired`, `forgotten`, and `unstable`).
- **Complex Agents, Shallow Tests (HarnessTester):** Contract and mutation-adequacy testing around LLM-dependent manifest/tool/selector/admission paths (`tests/unit/evolution/mutation-contracts.test.ts`).
- **Self-Evolving Agent Harness:** Strict separation of mutation targets (`DefaultHarnessSurfaceRegistry`), proposal (`DefaultHarnessProposer`), and fail-closed admission (`FailClosedAdmissionGate`) under an immutable constitutional boundary (`HarnessConstitution`).
- **What Does a Harness Buy? Tokens, Mostly & Harnessing LLMs Cost:** Explicit resource accounting (cached/uncached tokens, context-memory traffic, verification cost), rerun variance CI95 reporting, and statistical power analysis (`AdaptiveRecursionBudgetPolicy` & `EvolutionBenchmarkProtocol`).
