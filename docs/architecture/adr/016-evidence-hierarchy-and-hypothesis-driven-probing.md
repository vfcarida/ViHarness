# ADR 016: Evidence Hierarchy and Hypothesis-Driven Contrastive Probing

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** Inferring harness edits solely from past traces (`traces -> reflection -> auto-tune`) confounds task stochasticity with component causal effect and lacks decision observability (AHE).
- **Decision:**
  1. Replace binary confidence flags with a monotonic 5-tier evidence hierarchy (`EvidenceLevel`):
     - `E0_REFLECTION`: Observation or hypothesis inferred from traces only.
     - `E1_SINGLE_CONTRAST`: Paired baseline vs candidate probe on the same task and seed.
     - `E2_REPLICATED_CONTRAST`: Multiple matched executions demonstrating a repeatable effect across seeds.
     - `E3_VERIFIED`: Independent verification engine, tests, and zero policy violations sustain the effect.
     - `E4_GENERALIZATION`: Inaccessible held-out/OOD evaluation and retention suites sustain the change.
  2. Require every proposed candidate to predeclare a falsifiable `HarnessChangeHypothesis` (linking motivating signals from the 30-signal `FailureTaxonomyRegistry`, scope `INVARIANT | DOMAIN_SPECIFIC`, mechanism `GUIDANCE | STRUCTURAL`, predicted effects, tradeoffs, edit budget, and generalization claim).
  3. After isolated paired probing, `DefaultBehavioralContrastAnalyzer` produces a `HypothesisOutcome` (`supported | contradicted | inconclusive`) and retains negative evidence in `EvidenceBundle`.
- **Consequences:**
  - Every component-level composition decision in `DefaultHarnessComposer` is backed by explicit contrastive evidence rather than heuristic guesswork.
