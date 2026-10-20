# Vi-Harness: Target Architecture Specification

## 1. Target Architecture Overview

The target state of Vi-Harness realizes **Evidence-Gated Recursive Harnessing Under Zero-Trust Constraints**: uniting a deterministic **Runtime Plane** (14-phase state machine, 5-stage context compaction `Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`, zero-trust sandbox) with a governed **Evolution Plane** (Harness² Propose–Probe–Compose, AHE falsifiable observability, RRSI/HarnessCompass regularization, HarnessOpt-Bench held-out admission, and EvoHarnessBench retention testing).

```mermaid
flowchart TB
    subgraph Client [Client & CLI Layer]
        CLI[Execution & Evolution CLI\nsolve / evolve / harness / library / promote / rollback-harness]
        Interop[EightComponentAdapter\nClean-Room Harness² 8-Component Interop]
    end

    subgraph EvolutionPlane [Evolution Plane - Governed Recursive Self-Improvement]
        Diagnoser[HarnessDiagnoser\n30 Typed Failure Signals]
        Proposer[HarnessProposer\nInvariant vs Domain-Specific x Guidance vs Structural]
        Regularizer[CandidateRegularizer\nAnnealed Budget + Novelty + Specificity Critic + Pruner]
        ProbeRunner[IsolatedHarnessProbeRunner\nParallel / Sequential / Adaptive VoI Strategies]
        Contrast[BehavioralContrastAnalyzer]
        Composer[HarnessComposer]
        Selector[MultiObjectiveSelector\nPareto Frontier + 5 Profiles]
        Admission[FailClosedAdmissionGate\nHeld-Out + Retention + Signed Promotion]
        Library[FileHarnessExperienceLibrary\nCanonical H0 Reset + Provenance]

        Diagnoser --> Proposer --> Regularizer --> ProbeRunner --> Contrast --> Composer --> Selector --> Admission --> Library
        Library -.-> Proposer
    end

    subgraph RuntimePlane [Runtime Plane - Trusted Deterministic Execution]
        direction TB
        Runtime[DefaultAgentRuntime]
        LoopExec[IterationExecutor]
        Fingerprinter[LoopFingerprinter]
        Runtime --> LoopExec --> Fingerprinter
    end

    subgraph Subsystems [Modular Domain Subsystems]
        ContextSubsystem[Prefix Caching & 5-Stage Compactor\nSnip -> Micro-compact -> Collapse -> Auto-compact -> Cache-Aware]
        RoutingSubsystem[Utility Model Router - Architect/Editor]
        PolicySubsystem[Unbypassable Policy Engine & Local Sandbox]
        ToolSubsystem[Parallel & Builtin Tool Executor]
        VerificationSubsystem[Selective Impacted Test Selector & QA Gate]
        MemorySubsystem[Frozen Memory Snapshot & Skill/Failure Extractor]
        GitSubsystem[Two-Phase Git Checkpoint & Rollback Manager]
        SecuritySubsystem[HMAC SHA-256 Signer & Shannon Entropy Scrubber]
    end

    Client --> Runtime
    Client --> EvolutionPlane
    Interop --> EvolutionPlane
    Admission -->|Signed Promoted Manifest| Runtime
    LoopExec --> ContextSubsystem
    LoopExec --> RoutingSubsystem
    LoopExec --> PolicySubsystem
    LoopExec --> ToolSubsystem
    LoopExec --> VerificationSubsystem
    LoopExec --> MemorySubsystem
    LoopExec --> GitSubsystem
    LoopExec --> SecuritySubsystem
```

---

## 2. Key Architecture Invariants

1. **The Model Proposes, The Runtime Decides**:
   The LLM never directly executes commands, transitions state, or creates Git commits. All proposals pass through deterministic verification and policy evaluation.
2. **Runtime Plane vs Evolution Plane Separation**:
   The dependency direction is strictly `Evolution Plane -> Runtime interfaces`, never `Runtime core -> concrete Evolution implementation`.
3. **Immutable Harness Constitution**:
   The optimizer is never `root` over the system that evaluates and admits it. Constitutional components (`policy_engine`, `privilege_boundary`, `filesystem_confinement`, `secret_scrubber`, `audit_integrity_signer`, `admission_gate`, `rollback_manager`, `trusted_verification_boundary`) cannot be altered by self-evolution.
4. **Canonical Baseline Reset (`H0`)**:
   Every new task starts from the canonical baseline `H0` by default, using `FileHarnessExperienceLibrary` as retrieved evidence rather than chaining unpromoted task patches (`H0 -> H1 -> H2 -> ...`).
5. **Fail-Closed Held-Out Admission & Retention**:
   Global promotion requires `E4_GENERALIZATION` evidence on an inaccessible held-out partition, zero forgotten capabilities (`RetentionSuiteRunner`), bounded cost/latency regression, and HMAC-SHA256 signature verification.
6. **Sublinear Context Invariant**:
   Context size across long horizons ($N \ge 100$ iterations) is bounded by $O(\log N)$ or constant bounds via the 5-stage compaction pipeline (`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`).
7. **Zero-Loss User Rollback & Tamper-Proof Audit**:
   Both workspace file checkpoints and promoted `HarnessManifest` baselines support instant, cryptographically verified rollback.
