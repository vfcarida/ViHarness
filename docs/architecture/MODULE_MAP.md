# Module Map

This document describes every module in Vi-Harness, its responsibility, and its location.

## Core Layer (`src/core/`)

The domain layer. Has **zero** dependencies on infrastructure, DI, or runtime.

### `core/types/`
| File | Contents |
|---|---|
| `branded.ts` | `Brand<T, B>` phantom type utility |
| `identifiers.ts` | `Id<T>` branded type, domain & evolution IDs (`TaskId`, `GoalId`, `HarnessId`, `CandidateId`, `ProbeId`, `ContrastId`, `CompositionId`, `AdmissionId`, `ExperienceEntryId`, `EvolutionRunId`, `SurfaceId`), `IdFactory` interface |
| `result.ts` | `Result<T, E>` discriminated union, `ok()`, `fail()` factories |

### `core/errors/`
| File | Contents |
|---|---|
| `error-codes.ts` | `ErrorCode`, `ErrorCategory` (including `EVOLUTION`), `ERROR_CODE_DEFINITIONS` |
| `structured-error.ts` | `StructuredError` class |

### `core/evolution/`
| File | Contents |
|---|---|
| `constitution.ts` | `ComponentCapabilityClass`, `EvidenceLevel` (`E0`..`E4`), `DEFAULT_HARNESS_CONSTITUTION`, `ConstitutionValidator` |
| `harness-manifest.ts` | `HarnessManifest`, `HarnessComponents` (8 Harness² + 4 Vi-Harness native policy surfaces), `HarnessManifestDiff` |
| `surface-registry.ts` | `EvolvableSurfaceDefinition`, `HarnessSurfaceRegistry` |
| `failure-taxonomy.ts` | 30 canonical `FailureSignalType` definitions + extensible `FailureTaxonomyRegistry` |
| `hypothesis.ts` | `HarnessChangeHypothesis`, `HypothesisOutcome`, `EvidenceBundle`, `BehavioralContrast`, `HarnessCompositionRecord` |
| `interfaces.ts` | Ports for `HarnessDiagnoser`, `HarnessProposer`, `CandidateRegularizer`, `HarnessProbeRunner`, `BehavioralContrastAnalyzer`, `HarnessComposer`, `HarnessCandidateSelector`, `HarnessAdmissionGate`, `HarnessReflector`, `HarnessExperienceLibrary`, `RecursionBudgetPolicy`, `RecursionStrategy` |

### `core/interfaces/`
| File | Interface |
|---|---|
| `logger.ts` | `Logger` |
| `clock.ts` | `Clock` |
| `configuration.ts` | `Configuration` |
| `model-provider.ts` | `ModelProvider` |
| `model-router.ts` | `ModelRouter` |
| `context-store.ts` | `ContextStore` |
| `memory-store.ts` | `MemoryStore` |
| `context-compiler.ts` | `ContextCompiler` |
| `tool.ts` | `Tool` |
| `tool-executor.ts` | `ToolExecutor` |
| `policy-engine.ts` | `PolicyEngine` |
| `verification-engine.ts` | `VerificationEngine` |
| `evidence-store.ts` | `EvidenceStore` |
| `checkpoint-store.ts` | `CheckpointStore` |
| `state-store.ts` | `StateStore` |
| `experience-store.ts` | `ExperienceStore` |
| `agent-runtime.ts` | `AgentRuntime` |

---

## Infrastructure Layer (`src/infra/`)

Concrete implementations of core interfaces, including the **Evolution Plane (`src/infra/evolution/`)**:

| File | Implements / Provides | Description |
|---|---|---|
| `evolution/default-surface-registry.ts` | `DefaultHarnessSurfaceRegistry` | 12 registered evolvable surfaces with Zod & `PreWriteSyntaxGate` validators |
| `evolution/manifest-toolkit.ts` | `HarnessManifestToolkit` | Canonical JSON, SHA-256 hash, H0 factory, clone, diff, materialize, replay, rollback, HMAC signing |
| `evolution/default-harness-diagnoser.ts` | `DefaultHarnessDiagnoser` | Maps traces and failures to the 30-signal `FailureTaxonomyRegistry` |
| `evolution/default-harness-proposer.ts` | `DefaultHarnessProposer` | 4-quadrant candidate generator (`INVARIANT`/`DOMAIN_SPECIFIC` × `GUIDANCE`/`STRUCTURAL`) |
| `evolution/candidate-regularizer.ts` | `DefaultCandidateRegularizer` | Edit budget annealing, novelty, `BenchmarkSpecificityCritic`, `GeneralizationCritic`, `HarnessPruner`, complexity penalty |
| `evolution/isolated-probe-runner.ts` | `IsolatedHarnessProbeRunner` | Sandboxed paired probe execution with held-out access boundary enforcement |
| `evolution/behavioral-contrast-analyzer.ts` | `DefaultBehavioralContrastAnalyzer` | Evaluates `HypothesisOutcome` (`supported`/`contradicted`/`inconclusive`) and behavioral redundancy |
| `evolution/default-harness-composer.ts` | `DefaultHarnessComposer` | Evidence-linked component-wise composition |
| `evolution/multi-objective-selector.ts` | `DefaultMultiObjectiveSelector` | 5 objective dimensions, Pareto frontier, 5 deployment profiles |
| `evolution/retention-suite-runner.ts` | `RetentionSuiteRunner` | EvoHarnessBench capability retention testing (`retained`, `newly_acquired`, `forgotten`, `unstable`) |
| `evolution/fail-closed-admission-gate.ts` | `FailClosedAdmissionGate` | Fail-closed admission, held-out check, signed global promotion, and baseline rollback |
| `evolution/file-experience-library.ts` | `FileHarnessExperienceLibrary`, `DefaultHarnessReflector` | Persistent library with canonical `H0` reset invariant, deduplication, conflict quarantine, and pruning |
| `evolution/adaptive-recursion-policy.ts` | `AdaptiveRecursionBudgetPolicy` | Expected Value of Information stopping/expansion and resource accounting |
| `evolution/strategies/*` | `ParallelRecursionStrategy`, `SequentialRecursionStrategy`, `AdaptiveRecursionStrategy` | Pluggable recursion strategies |
| `evolution/recursive-evolution-engine.ts` | `RecursiveEvolutionEngine` | End-to-end Evolution Plane orchestrator with `.vi-evolution/` persistence & resume |
| `evolution/interop/eight-component-adapter.ts` | `EightComponentAdapter` | Clean-room Harness² 8-component import/export adapter |
| `evolution/live-evolution-bridges.ts` | `ModelDrivenCandidateGenerator`, `ModelDrivenHarnessComposer`, `createRuntimeMaterializedProbeExecutor` | Live `ModelProvider` and `AgentRuntime` bridges with progressive trace disclosure and fail-closed fallback |
| `evolution/discriminative-task-selector.ts` | `DiscriminativeTaskSelector` | `Task-CoEvolve` binary Shannon entropy, partial-score variance, and surface-alignment task subset selector |
| `evolution/contrastive-preference-exporter.ts` | `ContrastivePreferenceExporter` | `HarnessX` / `ViForge` DPO, GRPO, and SPIN post-training trajectory exporter + Model Capability Ceiling detector |
| `evolution/sqlite-experience-library.ts` | `SqliteHarnessExperienceLibrary`, `MemoHarnessSynthesizer` | SQLite WAL experience library and `MemoHarness` O(1) zero-search test-time manifest synthesis |
| `evolution/ecosystem-margin.ts` | `EcosystemMarginSplitter` | `One Recipe, Many Harnesses` `TransferableCore` + `EcosystemMargin` splitter and cross-model recombiner |
| `evolution/adversarial-probe-generator.ts` | `AdversarialProbeGenerator` | Counterfactual perturbation generator and coincidental-pass robustness evaluator |
| `evolution/statistical-admission-control.ts` | `WaldSprtStoppingRule`, `HolmBonferroniMultipleTestingGate` | Sequential Probability Ratio Test (SPRT) early probe stopping and Holm-Bonferroni FWER multiple-testing control |
| `evolution/executable-surface-ast-verifier.ts` | `ExecutableSurfaceAstVerifier` | TypeScript Compiler API static AST sandbox verifier for `EXECUTABLE` (`scripts`, `plugins`) surfaces |
| `evolution/viforge-coevolution-bridge.ts` | `ViForgeCoEvolutionBridge` | Closed-loop `HarnessX` co-evolution bridge (`prepareViForgeHandoff` & `ingestUpdatedModelCheckpoint`) |
| `evolution/evolution-rpc-dispatcher.ts` | `EvolutionRpcDispatcher` | ACP & MCP JSON-RPC 2.0 endpoints (`evolution/synthesizeManifest`, `evolution/inspectLineage`, `evolution/splitAndTransfer`, `evolution/prepareViForgeHandoff`, `evolution/ingestModelCheckpoint`) |
| `evolution/worktree-probe-sandbox.ts` | `WorktreeProbeSandboxManager` | Ephemeral Git worktree (`git worktree add --detach`) and snapshot probe isolation with patch digest capture |
| `evolution/shapley-component-attributor.ts` | `ShapleyComponentAttributor` | Coalitional Shapley value & Leave-One-Out counterfactual surface credit attribution + free-rider ablation pruning |
| `evolution/canary-deployment-controller.ts` | `CanaryDeploymentController` | Staged production canary rollout (`10% -> 25% -> 50% -> 100%`) with Page-Hinkley / CUSUM auto-rollback & quarantine |
| `evolution/bradley-terry-ranker.ts` | `BradleyTerryHarnessRanker` | Longitudinal Glicko-2 / Bradley-Terry tournament rating engine with uncertainty RD and active-learning matchup selector |
| `evolution/evolution-mcp-tools.ts` | `createEvolutionMcpTools`, `registerEvolutionMcpTools` | Native Model Context Protocol (`McpServer`) `tools/list` and `tools/call` registration for the Evolution Plane |
| `evolution/evolution-report-exporter.ts` | `EvolutionReportExporter` | Publication- and governance-ready Markdown (Mermaid DAG), interactive HTML, and LaTeX (`booktabs`) report exporter |
| `evolution/live-manifest-hot-swap.ts` | `LiveManifestHotSwapOrchestrator` | Per-task canary/memo manifest resolution, 12-surface runtime materialization, and closed-loop online CUSUM feedback |
| `evolution/cryptographic-evolution-ledger.ts` | `CryptographicEvolutionLedger` | Append-only SHA-256 hash-chained provenance ledger with SLSA v1.0 / In-Toto predicates and fail-closed verification |
| `evolution/counterfactual-trace-splicer.ts` | `CounterfactualTraceSplicer` | Step-level fault localization ($t^*$) and checkpoint-resumed counterfactual probe splicing |
| `evolution/contextual-bandit-meta-router.ts` | `ContextualBanditMetaRouter` | Disjoint LinUCB contextual bandit for dynamic `(strategyMode, deploymentProfile, explorationBudget)` selection |
| `evolution/federated-experience-sync.ts` | `FederatedExperienceSynchronizer` | Zero-trust privacy sanitizer and Wilson Score LCB federated cross-repository experience synchronizer |
| `evolution/evolution-cockpit-server.ts` | `EvolutionCockpitServer` | Real-time Node HTTP/SSE Evolution Cockpit server with dark-mode dashboard and emergency canary rollback |
| `evolution/map-elites-archive.ts` | `MapElitesHarnessArchive` | Quality-Diversity (MAP-Elites) 12-cell illumination archive (`qdScore`, `coverageRatio`, `sampleSteppingStoneParents`) |
| `evolution/submodular-benchmark-coevolver.ts` | `SubmodularBenchmarkCoEvolver` | Benchmark saturation detector, compositional task synthesizer, and $(1 - 1/e)$ greedy Submodular Facility-Location selector |
| `evolution/structural-policy-verifier.ts` | `StructuralPolicyInvariantVerifier` | Formal cross-surface satisfiability & deadlock verifier (`INV-POL-01`..`06`) with deterministic `autoRepairManifest` |
| `evolution/lineage-bisection-diagnoser.ts` | `LineageBisectionDiagnoser` | $\mathcal{O}(\log_2 k)$ binary search lineage regression bisector and surgical excision patcher ($H_k \setminus \Delta_{i^*}$) |
| `evolution/conformal-utility-calibrator.ts` | `ConformalUtilityCalibrator` | Distribution-free Split Conformal Prediction intervals and tail-risk $\text{VaR}_{\alpha}$ / $\text{CVaR}_{\alpha}$ utility calibrator |
| `evolution/continuous-evolution-daemon.ts` | `ContinuousEvolutionDaemon` | Autonomous self-healing operations daemon connecting incident ingestion, lineage bisection, QD archiving, and 10% canary staging |
| `evolution/bayesian-surrogate-model.ts` | `BayesianHarnessSurrogateModel` | Surrogate-assisted Bayesian acquisition (`EI`, `UCB`) over 16D `HarnessManifestDiff` features for zero-probe candidate pre-screening |
| `evolution/epistatic-surface-graph.ts` | `EpistaticSurfaceGraphAnalyzer` | 2nd-order Shapley-Taylor epistatic interaction index ($\mathcal{I}_{i,j}$) analyzer identifying co-adapted modules and antagonistic conflicts |
| `evolution/temporal-contract-monitor.ts` | `RuntimeTemporalContractMonitor` | Linear Temporal Logic over Finite Traces ($\text{LTL}_f$) monitor (`LTL-01`..`LTL-04`) with counterexample witness extraction |
| `evolution/hypervolume-pareto-selector.ts` | `HypervolumeParetoSelector` | 5D Dominated Hypervolume contribution ($\Delta\text{HV}$) and Augmented Tchebycheff non-convex Pareto selector |
| `evolution/skill-subagent-distiller.ts` | `SkillSubagentDistiller` | Semantic distiller synthesizing declarative `skills` and least-privilege `subagents` from supported `ExperienceEntry` records |
| `evolution/chaos-fault-injection-tester.ts` | `ChaosFaultInjectionTester` | Deterministic operational chaos & fault-injection tester (`TOOL_TIMEOUT_BURST`, `MODEL_429_RATE_LIMIT`, `TRUNCATED_SPILL_OUTPUT`, `CONCURRENT_EDIT_CONFLICT`) |
| `evolution/conformal-abstention-guard.ts` | `ConformalAbstentionGuard` | Split Conformal Prediction non-conformity quantile calibration ($\hat{q}_{1-\alpha}$), Honest-by-Construction abstention guard, and SHA-256 Cryptographic Reproducibility Manifest generator |
| `eval/evolution-benchmark-protocol.ts` | `EvolutionBenchmarkProtocol` | Matched-budget scientific evaluation protocol with CI95, power analysis, and cross-model transfer matrix |
| `tui/evolution-tree-renderer.ts` | `EvolutionTreeRenderer` | ASCII/ANSI visualization of Propose–Probe–Compose–Admission DAG, live telemetry stream, and Pareto frontier tables |
