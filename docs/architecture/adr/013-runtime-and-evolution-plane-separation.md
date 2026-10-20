# ADR 013: Separation of Runtime Plane and Evolution Plane

- **Status:** Accepted
- **Date:** 2026-10-20
- **Context:** As Vi-Harness evolves from an observational outer-loop tuner into a recursively self-evolving agent harness (synthesizing Harness², AHE, HarnessCompass, RRSI, and Self-Evolving Agent Harness), embedding candidate generation, contrastive probing, or admission logic directly inside `DefaultAgentRuntime` or `IterationExecutor` would violate single-responsibility, complicate deterministic execution, and blur the security boundary between executing a task and mutating the harness that governs execution.
- **Decision:** Separate Vi-Harness into two logical planes:
  1. **Runtime Plane (`src/runtime/`, `src/core/state-machine/`):** Responsible strictly for executing *one* frozen `HarnessManifest` deterministically (`Goal -> DefaultAgentRuntime -> IterationExecutor -> StateMachine -> ContextCompiler -> Model -> Policy -> Tools -> Verification -> Evidence -> Checkpoint/Audit`).
  2. **Evolution Plane (`src/core/evolution/`, `src/infra/evolution/`):** Responsible for improving harnesses across tasks (`Observe -> Diagnose -> Propose -> Regularize -> Probe -> Contrast -> Compose -> Select -> Validate -> Admit/Promote -> Reflect -> Consolidate/Prune`).
  - **Dependency Invariant:** `Evolution Plane -> Runtime interfaces`, never `Runtime core -> concrete Evolution implementation`. Furthermore, `src/core/` maintains zero imports from `src/infra/`.
- **Consequences:**
  - `IterationExecutor` remains lean, deterministic, and focused on single-run execution.
  - `IsolatedHarnessProbeRunner` consumes runtime executors as black-box experimental substrates inside isolated workspaces.
  - Recursive evolution is strictly opt-in (`enabledByDefault: false`) and 100% backward-compatible with legacy non-evolving workflows.
