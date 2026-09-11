# ADR 008: Autonomous Judge-in-the-Loop Iterative Repair Engine

**Status**: Accepted  
**Date**: 2026-09-11  
**Deciders**: Vi-Harness Core Team  
**Category**: Evaluation & Verification

---

## Context

External benchmarks (ACMOJ, SWE-bench Docker eval harness, Codeforces Online Judge, custom test runners) evaluate submitted solutions and produce structured verdicts (`AC`, `WA`, `CE`, `TLE`, `MLE`, `RE`) outside the agent's internal loop. Prior to this ADR, the agent stopped immediately once its internal state machine reached `GOAL_COMPLETE`, without verifying whether the external judge accepted the solution.

This created a gap between the agent declaring success and the external oracle confirming it — particularly damaging for competitive programming and SWE-bench evaluation, where the judge is the ground truth.

## Decision

Implement a `JudgeInTheLoopOrchestrator` that:
1. Executes user-specified judge commands in the target workspace sandbox.
2. Captures full execution output, parses structured verdicts from stdout/stderr.
3. Extracts compiler error snippets and test failure messages as targeted diagnostic context.
4. Drives iterative repair cycles: on non-`AC` verdicts, re-enters the agent loop with a structured diagnostic prompt up to `--max-judge-retries` iterations (default: 3).
5. Exits with `AC` status on success or `MAX_RETRIES_EXCEEDED` status on exhaustion.

The judge command is supplied as an opt-in CLI flag (`--judge-command <cmd>`), preserving backward compatibility for all existing benchmarks and workflows that do not require external judge integration.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **Internal test runner only** | Cannot validate against black-box external judges (ACMOJ, SWE-bench Docker) that require sandbox execution and produce opaque verdicts |
| **Post-solve evaluation only (no repair)** | Does not close the loop — the agent cannot learn from judge feedback without re-entry |
| **Always-on judge integration** | Would break existing headless `solve` workflows that do not have a judge command |

## Consequences

- **Positive**: Enables end-to-end autonomous benchmarking against any judge-based evaluation system.
- **Positive**: Structured verdict parsing and diagnostic injection improve repair success rates vs. raw error strings.
- **Negative**: Adds a retry loop that can multiply total solve time by up to `maxRetries + 1`.
- **Constraint**: Judge commands run within the same sandbox policy as the agent — path confinement and timeout policies apply.
