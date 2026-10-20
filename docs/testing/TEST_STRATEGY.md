# Vi-Harness: Comprehensive Test Strategy

## 1. Test Pyramid & Verification Hierarchy

Vi-Harness employs a five-tier testing strategy designed to verify functional correctness, state-machine transitions, context efficiency, zero-trust security boundaries, deterministic recursive evolution (without requiring live LLM calls), contract/mutation adequacy around LLM-dependent paths, and machine-verifiable architectural synchronization.

---

## 2. Test Layer Specifications

### 2.1. Layer 1: Unit Tests (`tests/unit/`)
- **Scope:** Fast, isolated verification of domain models, state-machine transitions, context compaction (`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`), tools, security rules, and the **Evolution Plane**.
- **Network & I/O Isolation:** Zero real LLM network calls. Uses `TestClock`, `MockModelProvider`, `ScriptedModelProvider`, and deterministic probe executors.
- **Key Evolution Plane Unit Suites:**
  - `evolution/milestone-a-foundations.test.ts`: `HarnessConstitution`, `EvidenceLevel` monotonic ordering (`E0`..`E4`), `HarnessManifest` deterministic SHA-256 hashing, structural diffing, `PreWriteSyntaxGate` script validation, HMAC signing, rollback, 12-surface `DefaultHarnessSurfaceRegistry`, 30-signal `FailureTaxonomyRegistry`, and `SkillExtractor` failure pattern extraction (`DEFECT-01` fix).
  - `evolution/milestone-b-c-d-e-f.test.ts`: `DefaultHarnessDiagnoser`, 4-quadrant `DefaultHarnessProposer`, `DefaultCandidateRegularizer` (`BenchmarkSpecificityCritic`, `GeneralizationCritic`, `HarnessPruner`), `IsolatedHarnessProbeRunner` (including held-out split access denial), `DefaultBehavioralContrastAnalyzer`, `DefaultHarnessComposer`, `DefaultMultiObjectiveSelector` (Pareto frontier), `RetentionSuiteRunner` (`retained`, `newly_acquired`, `forgotten`, `unstable`), `FailClosedAdmissionGate`, `FileHarnessExperienceLibrary`, `AdaptiveRecursionBudgetPolicy`, `EightComponentAdapter`, and `EvolutionBenchmarkProtocol`.
  - `cli/evolve-cli.test.ts`: CLI subcommands (`harness`, `evolve`, `evolution`, `library`, `promote`, `rollback-harness`) with `--dry-run` preview verification.

### 2.2. Layer 2: Mutation & Contract-Adequacy Tests (`tests/unit/evolution/mutation-contracts.test.ts`)
- **Scope:** Inspired by *Complex Agents, Shallow Tests (HarnessTester)*, verifies that LLM-dependent harness paths reject corrupted JSON, key-order permutations, forged HMAC admission signatures, high-Pass@1 candidates that introduce policy violations, hallucinated markdown code fences inside executable scripts, and obfuscated constitutional bypass directives.

### 2.3. Layer 3: Machine-Verifiable Architecture Synchronization (`tests/unit/docs/architecture-sync.test.ts`)
- **Scope:** Prevents documentation and architectural drift by asserting at test time that:
  1. `package.json`, `CITATION.cff`, and `src/cli/index.ts` agree on the canonical version (`0.2.0`).
  2. `src/core/` has zero imports from `src/infra/` or `src/runtime/`.
  3. `src/runtime/` has zero concrete imports from `src/infra/evolution/` (preserving the Runtime Plane vs Evolution Plane boundary).
  4. All 12 evolvable surfaces and 6 immutable constitutional surfaces documented in `CURRENT_ARCHITECTURE.md` match `DefaultHarnessSurfaceRegistry` and `DEFAULT_HARNESS_CONSTITUTION`.
  5. All 30 canonical failure signals in `FailureTaxonomyRegistry` and 22 evolution threats (`E-01`..`E-22`) in `THREAT_MODEL.md` are present and verified.

### 2.4. Layer 4: Integration Tests (`tests/integration/`)
- **Key Suites:**
  - `evolution-lifecycle.test.ts`: Full end-to-end Propose–Probe–Compose–Admission lifecycle across `parallel`, `sequential`, and `adaptive` strategies, canonical `H0` reset across consecutive tasks, `.vi-evolution/` disk persistence/resume, TUI tree rendering, and baseline rollback.
  - `meta-harness-production-flow.test.ts`, `git-real-repository.test.ts`, `verification-pipeline.test.ts`, `enterprise-readiness-suite.test.ts`.

### 2.5. Layer 5: Security Red Team & Scientific Benchmark Protocol
- **Security Red Team (`tests/unit/security/red-team-suite.test.ts`):** Active penetration and exploit simulation.
- **Scientific Benchmark Protocol (`EvolutionBenchmarkProtocol`):** Enforces `evolve` / `held_out` / `ood` split separation, matched-budget comparisons (`seed_harness`, `best_of_n_search`, `extra_reasoning_budget`), 95% confidence intervals, statistical power analysis, and explicit separation of `INFRA_ERROR` unscored runs.
