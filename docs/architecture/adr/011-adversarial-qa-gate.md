# ADR 011: Dual-Pass Adversarial QA Auditor Gate

**Status**: Accepted  
**Date**: 2026-09-11  
**Deciders**: Vi-Harness Core Team  
**Category**: Verification & Security

---

## Context

Code-generating agents suffer from a systematic confirmation bias: they evaluate their own output against the goal they were trying to achieve, making them poor detectors of security flaws, resource leaks, and type safety bypasses in their own patches. Common failure modes observed in practice include:

- Shell command injection via unescaped variable concatenation into `exec`/`spawn`.
- Hardcoded API keys and bearer tokens in test fixtures or configuration files.
- Unchecked `as any` type casts that silently bypass TypeScript's safety system.
- Unclosed file stream handles creating resource leaks in long-running processes.
- Empty `catch` blocks silently swallowing exceptions, hiding real failures.

These defects can pass the agent's own internal verification (unit tests pass, goal is complete) while remaining exploitable or buggy in production.

## Decision

Implement a `QaAuditorGate` that performs a dual-pass adversarial inspection of proposed patch hunks before final patch export. Pass 1 checks for security violations (injection, credentials, type bypasses). Pass 2 checks for reliability issues (resource leaks, swallowed exceptions).

The gate is invoked via the opt-in CLI flag `--adversarial-qa`. On a failing audit, the gate returns structured `AuditFinding` records to the agent with exact file locations and repair mandates, re-entering the solve loop rather than exporting the patch.

**Decision on opt-in vs. always-on**: The gate is opt-in (not default) because:
1. It adds inspection latency proportional to patch size.
2. Some legitimate patterns (e.g., intentional `as unknown as T` casts in test mocks) may produce false positives.
3. Benchmark harnesses with strict per-task time limits would be penalised by always-on auditing.

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| **External linter only (ESLint)** | Cannot detect semantic issues like unescaped shell arguments or hardcoded secrets without specialised plugins |
| **Always-on by default** | Adds latency; false positives on legitimate test code would frustrate developers |
| **LLM self-review only** | Subject to the same confirmation bias the gate is designed to eliminate |

## Consequences

- **Positive**: Eliminates a systematic class of security and reliability defects from agent-generated patches.
- **Positive**: Structured `AuditFinding` records give the agent precise, actionable repair targets.
- **Negative**: Adds one audit pass per solve attempt — latency proportional to patch size.
- **Negative**: Shannon entropy thresholding for credential detection may produce false positives on legitimately high-entropy strings (e.g., base64-encoded test fixtures).
- **Constraint**: Gate is opt-in; projects must enable `--adversarial-qa` explicitly in their benchmark harness configuration.
