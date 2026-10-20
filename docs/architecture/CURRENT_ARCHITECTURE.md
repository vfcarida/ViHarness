# Vi-Harness: Current Architecture Specification

## 1. Architectural Philosophy

Vi-Harness is built on two foundational theses:
1. **"The agent is not a persistent conversation. The agent is a stateful, evidence-driven state machine."**
2. **"Evidence-Gated Recursive Harnessing Under Zero-Trust Constraints."**

Vi-Harness separates execution from self-evolution into two distinct planes:
- **Runtime Plane (`src/runtime/`, `src/core/state-machine/`):** Executes a single frozen `HarnessManifest` deterministically through a 14-phase state machine, 5-stage progressive context compaction (`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`, backed by `ContextCompressor`'s 6 internal execution tiers), parallel tool execution with mutation barriers, and verification-first completion.
- **Evolution Plane (`src/core/evolution/`, `src/infra/evolution/`):** Recursively improves harnesses via **Propose–Probe–Compose**, regularized candidate filtering (RRSI / HarnessCompass), isolated paired probes, multi-objective Pareto selection, capability retention testing (EvoHarnessBench), and a fail-closed admission gate (`FailClosedAdmissionGate`) governed by an immutable `HarnessConstitution`.

---

## 2. High-Level Dual-Plane System Architecture

```mermaid
flowchart TD
    subgraph EvolutionPlane [Vi-Harness Evolution Plane]
        Library[Harness Experience Library\nFull Manifests + Evidence + Provenance]
        Diagnoser[DefaultHarnessDiagnoser\n30 Typed Failure Signals]
        Proposer[DefaultHarnessProposer\n4-Quadrant Candidate Matrix]
        Regularizer[DefaultCandidateRegularizer\nEdit Budget + Novelty + Specificity Critic + Pruner]
        ProbeRunner[IsolatedHarnessProbeRunner\nSandboxed Paired Probes]
        ContrastEngine[DefaultBehavioralContrastAnalyzer\nHypothesis Outcome + Redundancy]
        Composer[DefaultHarnessComposer\nComponent-Wise Evidence Composition]
        Selector[DefaultMultiObjectiveSelector\n5 Objectives + Pareto Frontier]
        AdmissionGate[FailClosedAdmissionGate\nHeld-Out + Retention + Cost + Signature]

        Library --> Proposer
        Diagnoser --> Proposer --> Regularizer --> ProbeRunner
        ProbeRunner --> ContrastEngine --> Composer --> Selector --> AdmissionGate
        AdmissionGate -->|Reflect Positive & Negative Evidence| Library
    end

    subgraph Constitution [Immutable Constitutional Boundary]
        ConstCore[HarnessConstitution\nPolicy Enforcement • Audit Integrity • Admission Gate • Rollback]
    end

    subgraph RuntimePlane [Vi-Harness Runtime Plane]
        RuntimeEngine[DefaultAgentRuntime]
        LoopExecutor[IterationExecutor]
        StateMachine[Agent State Machine - 14 Phases]
        Compiler[PrefixCaching & 5-Stage Compactor\nSnip -> Micro-compact -> Collapse -> Auto-compact -> Cache-Aware]
        Router[Utility Model Router]
        Policy[Zero-Trust Policy Engine & Sandbox]
        Tools[Parallel & Builtin Tool Executor]
        Verifier[Verification Engine & Impacted Selector]
        Git[Two-Phase Git Checkpoint & Rollback]
        Audit[AuditIntegritySigner - HMAC-SHA256]

        RuntimeEngine --> LoopExecutor
        LoopExecutor --> StateMachine
        LoopExecutor --> Compiler
        LoopExecutor --> Router
        LoopExecutor --> Policy
        LoopExecutor --> Tools
        LoopExecutor --> Verifier
        LoopExecutor --> Git
        LoopExecutor --> Audit
    end

    AdmissionGate -->|Signed Promoted Manifest| RuntimeEngine
    ProbeRunner -.->|Isolated Probe Execution| RuntimeEngine
    ConstCore === AdmissionGate
    ConstCore === Policy
```

---

## 3. Immutable Harness Constitution & Capability Classes

| Capability Class | Surfaces | Task Evidence Required | Global Promotion Required | Mutability |
| :--- | :--- | :--- | :--- | :--- |
| **GUIDANCE** | `systemPrompt`, `toolGuidance` | `E1_SINGLE_CONTRAST` | `E4_GENERALIZATION` | Evolvable in sandbox |
| **DECLARATIVE** | `guardrails`, `memoryPolicy`, `subagents`, `skills`, `contextPolicy`, `routingPolicy`, `verificationPolicy`, `toolSchedulingPolicy` | `E2_REPLICATED_CONTRAST` | `E4_GENERALIZATION` | Evolvable with Zod schema + regression checks |
| **EXECUTABLE** | `scripts`, `plugins` | `E3_VERIFIED` | `E4_GENERALIZATION` | Evolvable under `PreWriteSyntaxGate` + sandbox + zero privilege escalation |
| **CONSTITUTIONAL** | `policyEngine`, `auditSigner`, `sandboxConfinement`, `admissionGate`, `rollbackSemantics`, `testProtectionGate` | Immutable | Immutable | **Immutable by any optimizer** |

---

## 4. The 5-Tier Evidence Hierarchy (`E0`–`E4`)

| Level | Identifier | Meaning |
| :--- | :--- | :--- |
| **E0** | `E0_REFLECTION` | Observation or hypothesis inferred from traces only. |
| **E1** | `E1_SINGLE_CONTRAST` | Base and candidate executed on the same task and seed. |
| **E2** | `E2_REPLICATED_CONTRAST` | Multiple matched executions showing a repeatable behavioral difference. |
| **E3** | `E3_VERIFIED` | External verifier, tests, and zero policy violations independently sustain the effect. |
| **E4** | `E4_GENERALIZATION` | Inaccessible held-out/OOD evaluation and capability retention suites sustain the change. |

---

## 5. The 14 Canonical Agent Phases (Runtime Plane)

```mermaid
stateDiagram-v2
    [*] --> INIT: Goal Accepted
    INIT --> EXPLORE: Discover Problem Space
    EXPLORE --> PLAN: Formulate Hypothesis
    PLAN --> IMPLEMENT: Propose Tool Actions
    IMPLEMENT --> VERIFY: Execute Impacted Tests
    VERIFY --> REPAIR: Tests Failed
    REPAIR --> IMPLEMENT: Apply Fix
    VERIFY --> DONE: All Acceptance Checks Pass
    
    EXPLORE --> BLOCKED: External Dependency Missing
    PLAN --> BLOCKED: Unresolvable Resource
    IMPLEMENT --> HUMAN_REQUIRED: Irreversible / Security Trigger
    
    IMPLEMENT --> OSCILLATION_DETECTED: Loop Trap Detected
    REPAIR --> OSCILLATION_DETECTED: Stagnant Failure Loop
    
    VERIFY --> REGRESSION_DETECTED: Prior Passing Tests Broke
    IMPLEMENT --> BUDGET_EXCEEDED: Token/Cost Exceeded
    
    DONE --> [*]
    OSCILLATION_DETECTED --> [*]
    REGRESSION_DETECTED --> [*]
    BUDGET_EXCEEDED --> [*]
    CANCELLED --> [*]
    FAILED --> [*]
```

---

## 6. The Four-Tier Context Model (L0 - L3) & 5-Stage Compaction

| Tier | Name | Persistence | Typical Token Budget | Contents |
| :--- | :--- | :--- | :--- | :--- |
| **L0** | **Hot State** | Current Turn | 35-45% | Active goal, modified file buffers, immediate error stack traces, compiler output. |
| **L1** | **Working Memory** | Active Task | 20-30% | Execution plan checklist, current working hypothesis, recent decision records. |
| **L2** | **Episodic History** | Session | 10-15% | Condensed prior attempts, failed tool invocations, summarized branch outcomes. |
| **L3** | **Repository Knowledge** | Permanent | 20-40% | Coding standards, architectural rules, AST Repo-Map symbol graph. |

Progressive Compaction Pipeline (`ContextCompressor` + `CachePrefixTracker`):
`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware` (with internal `BUDGET_REDUCTION` and `TOOL_PRUNE` pre-stages).
