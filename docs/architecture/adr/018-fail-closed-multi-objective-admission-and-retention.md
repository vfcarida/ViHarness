# ADR 018: Fail-Closed Multi-Objective Admission and Capability Retention

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** Optimizing solely for Pass@1 on an evolve split leads to token/cost inflation ("What Does a Harness Buy? Tokens, Mostly"), evaluation leakage (HarnessOpt-Bench), and harness-induced forgetting of previously working skills (EvoHarnessBench).
- **Decision:**
  1. `DefaultMultiObjectiveSelector` evaluates candidates across 5 separate objective dimensions (Quality, Efficiency, Reliability, Generalization, Security), computes the non-dominated Pareto frontier, and supports 5 deployment profiles (`quality_first`, `balanced`, `low_cost`, `low_latency`, `high_assurance`).
  2. `RetentionSuiteRunner` evaluates 11 core capability categories and tracks `retained`, `newly_acquired`, `forgotten`, and `unstable` capabilities separately.
  3. `FailClosedAdmissionGate` separates `task_only`, `library_only`, and `promoted` (global baseline promotion) statuses. Global promotion is **fail-closed**: it requires structural validation, constitutional compliance, `E4_GENERALIZATION` evidence from a held-out split inaccessible to the proposer (`callerRole === 'admission_gate'`), zero forgotten capabilities, bounded cost/latency regression, and cryptographic signature verification.
- **Consequences:**
  - Infrastructure or judge failures never default to promotion.
  - Promoted baselines can be rolled back deterministically at any time (`vi-harness rollback-harness`).
