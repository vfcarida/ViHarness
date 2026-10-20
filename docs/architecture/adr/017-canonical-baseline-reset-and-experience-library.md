# ADR 017: Canonical Baseline Reset (H0) and Regularized Experience Library

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** Sequentially chaining task-specialized harnesses (`H0 -> H1 -> H2 -> ...`) across tasks causes cumulative drift, task-specific overfitting, and silent competence degradation.
- **Decision:**
  1. Enforce the **Canonical Baseline Reset Invariant** (inspired by Harness²): every new task starts from the canonical baseline `H0` managed by `FailClosedAdmissionGate`.
  2. Prior specialized harnesses and their contrastive outcomes (both positive and negative) are persisted in `FileHarnessExperienceLibrary` (`ExperienceEntry`) with applicability conditions, motivating failure signals, effect sizes, staleness/TTL expiry, conflict quarantine, and HMAC audit signatures.
  3. `DefaultCandidateRegularizer` (synthesizing RRSI and HarnessCompass) applies temporally annealed edit budgets, novelty scoring, `BenchmarkSpecificityCritic` (rejecting task-ID/rubric/fixture memorization), `GeneralizationCritic`, `HarnessPruner`, and complexity penalties before any probe is executed.
- **Consequences:**
  - Task-specific adaptations inform future proposals via domain/signal-aware retrieval without polluting the canonical baseline unless promoted through `FailClosedAdmissionGate`.
