# Changelog

All notable changes to Vi-Harness are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-20

### Wave 9 — Surrogate-Assisted Bayesian Acquisition, 2nd-Order Epistatic Surface Graph, Formal $\text{LTL}_f$ Temporal Contract Monitor, Hypervolume Pareto Selector, Semantic Skill/Subagent Distillation & Chaos Resilience Tester

- **infra/evolution (Wave 9.1)**: `BayesianHarnessSurrogateModel` — online Gaussian Process / Kernel Ridge surrogate over 16D structural `HarnessManifestDiff` embeddings predicting posterior utility delta $\mathcal{N}(\hat{\mu}, \hat{\sigma}^2)$ and computing Expected Improvement ($\text{EI}$) & Upper Confidence Bound ($\text{UCB}$) for zero-probe candidate pre-screening (`preScreenCandidates`).
- **infra/evolution (Wave 9.2)**: `EpistaticSurfaceGraphAnalyzer` — 2nd-order Shapley-Taylor Epistatic Interaction Index ($\mathcal{I}_{i,j}$) analyzer discovering synergistic co-adapted surface modules and filtering antagonistic epistatic conflicts (`filterAntagonisticConflicts`).
- **infra/evolution & cli (Wave 9.3)**: `RuntimeTemporalContractMonitor` — formal Linear Temporal Logic over Finite Traces ($\text{LTL}_f$) verifier checking `LTL-01` (`Verify-After-Write`), `LTL-02` (`Read-Before-Edit`), `LTL-03` (`Bounded-Error-Recovery`), and `LTL-04` (`Monotonic-Loop-Hygiene`) with minimal counterexample witness extraction and `vi-harness evolution ltl-verify`.
- **infra/evolution (Wave 9.4)**: `HypervolumeParetoSelector` — 5D Halton low-discrepancy Dominated Hypervolume ($\text{HV}$) and Marginal Hypervolume Contribution ($\Delta\text{HV}$) calculator paired with Augmented Tchebycheff Scalarization to capture non-convex Pareto frontier regions.
- **infra/evolution (Wave 9.5)**: `SkillSubagentDistiller` — semantic pattern distiller converting high-confidence `ExperienceEntry` records into declarative `skills` and least-privilege `subagents` components (`distillAndEnrichManifest`).
- **infra/evolution & cli (Wave 9.6)**: `ChaosFaultInjectionTester` — deterministic seed-controlled operational fault-injection tester (`TOOL_TIMEOUT_BURST`, `MODEL_429_RATE_LIMIT`, `TRUNCATED_SPILL_OUTPUT`, `CONCURRENT_EDIT_CONFLICT`) computing `autonomousRecoveryRate` and `resilienceScore`, plus `vi-harness evolution chaos-test`.
- **infra/evolution & cli (Conformal Abstention & Reproducibility)**: `ConformalAbstentionGuard` — distribution-free Split Conformal Prediction non-conformity quantile calibration ($\hat{q}_{1-\alpha}$), Honest-by-Construction abstention and fallback to canonical $H_0$, and deterministic SHA-256 Cryptographic Reproducibility Manifest generation, plus `vi-harness evolution conformal-check`.

### Wave 8 — Quality-Diversity (`MAP-Elites`) Illumination, Submodular Curriculum Co-Evolution, Formal Cross-Surface Policy Verifier, Lineage Bisection Excision, Conformal $\text{CVaR}_{\alpha}$ Tail-Risk & Autonomous Self-Healing Daemon

- **infra/evolution (Wave 8.1)**: `MapElitesHarnessArchive` — 12-cell Quality-Diversity behavioral illumination grid (`CandidateExplorationQuadrant` $\times$ `CostComputeTier`), computing global `qdScore` and `coverageRatio`, and sampling structurally diverse stepping-stone parent manifests (`sampleSteppingStoneParents`).
- **infra/evolution (Wave 8.2)**: `SubmodularBenchmarkCoEvolver` — detects benchmark pool saturation (`detectBenchmarkSaturation`), synthesizes harder multi-constraint compositional tasks (`synthesizeCompositionalTasks`), and selects a budget-constrained probe suite via $(1 - 1/e)$ greedy Submodular Facility-Location maximization (`selectSubmodularSuite`).
- **infra/evolution & cli (Wave 8.3)**: `StructuralPolicyInvariantVerifier` — statically verifies 6 formal cross-surface policy and budget satisfiability invariants (`INV-POL-01`..`INV-POL-06`) across `contextPolicy`, `routingPolicy`, `verificationPolicy`, `toolSchedulingPolicy`, `guardrails`, `budgetProfile`, and `securityProfile`, plus deterministic `autoRepairManifest` and `vi-harness evolution verify-policies`.
- **infra/evolution (Wave 8.4)**: `LineageBisectionDiagnoser` — $\mathcal{O}(\log_2 k)$ binary search over multi-generation lineages $[H_0, \dots, H_k]$ (`bisectAndExcise`) to isolate the exact culprit transition $H_{i^*-1} \to H_{i^*}$ and synthesize a surgically excised manifest $H_k \setminus \Delta_{i^*}$ preserving downstream orthogonal gains.
- **infra/evolution (Wave 8.5)**: `ConformalUtilityCalibrator` — distribution-free finite-sample Split Conformal Prediction intervals (`computeConformalInterval`) and Conditional Value-at-Risk ($\text{VaR}_{\alpha}$, $\text{CVaR}_{\alpha}$) tail-risk utility scoring (`evaluateTailRiskUtility`) wired into `RecursiveEvolutionEngine`.
- **infra/evolution & cli (Wave 8.6)**: `ContinuousEvolutionDaemon` — autonomous self-healing background orchestrator queuing production incidents (`ingestIncident`), executing lineage bisection on canary rollbacks or bounded evolution cycles (`runSelfHealingTick`), updating `MapElitesHarnessArchive`, and staging admitted manifests into `CanaryDeploymentController` at `10%` traffic, plus `vi-harness evolution qd-archive`.

### Wave 7 — Live Runtime Manifest Hot-Swapping, Cryptographic Provenance Ledger, Counterfactual Trace Splicing, Contextual Bandit Meta-Router, Federated Experience Sync & Live Cockpit Server

- **infra/evolution (Wave 7.1)**: `LiveManifestHotSwapOrchestrator` — dynamically resolves per-task manifests via `CanaryDeploymentController` and `MemoHarnessSynthesizer`, materializes all 12 `HarnessManifest` surfaces into `ExecutionOptions` and `Goal` constraints, and feeds real-time execution outcomes back into the sequential CUSUM detector for autonomous fail-closed rollback.
- **infra/evolution (Wave 7.2)**: `CryptographicEvolutionLedger` — append-only SHA-256 hash-chained provenance ledger (`previousEntryHash -> entryHash`) with HMAC-SHA256 signatures and SLSA v1.0 / In-Toto predicates (`verifyLedgerIntegrity`, `verifyManifestProvenance`) integrated into `RecursiveEvolutionEngine`.
- **infra/evolution (Wave 7.3)**: `CounterfactualTraceSplicer` — step-level trajectory fault localization ($t^*$) and checkpoint-resumed counterfactual probe splicing (`runSplicedCounterfactualProbe`) slashing probe token usage by 60–80%.
- **infra/evolution (Wave 7.4)**: `ContextualBanditMetaRouter` — Disjoint LinUCB contextual bandit dynamically selecting `(strategyMode, deploymentProfile, recommendedCandidatePoolSize)` from 5-D context features (`failureEntropy`, `budgetPressure`, `ceilingIndex`, `ratingUncertainty`, `historicalPassRate`) and updating ridge-regression posteriors from observed utility gain.
- **infra/evolution (Wave 7.5)**: `FederatedExperienceSynchronizer` — zero-trust privacy sanitizer redacting host file paths, secret API keys, emails, and benchmark task IDs before cross-repository export, and merging federated bundles via 95% Wilson Score Lower Confidence Bound (LCB) conflict resolution while quarantining unverified executable surfaces.
- **infra/evolution & cli (Wave 7.6)**: `EvolutionCockpitServer` — zero-dependency Node `http` / Server-Sent Events (`text/event-stream`) live Evolution Cockpit with interactive dark-mode glassmorphic UI and one-click emergency canary rollback (`POST /api/evolution/canary/rollback`), plus `vi-harness evolution ledger-verify` and `federated-export` CLI subcommands.

### Wave 6 — Production Autonomy, Causal Surface Attribution (`Shapley`), Ephemeral Worktree Isolation, Canary CUSUM Rollback, Bradley-Terry Ranking & Scientific Report Exporter

- **infra/evolution (Wave 6.1)**: `WorktreeProbeSandboxManager` — physical probe workspace isolation via ephemeral Git worktrees (`git worktree add --detach`) and snapshot directories with deterministic `git diff` / SHA-256 patch capture and guaranteed teardown.
- **infra/evolution (Wave 6.2)**: `ShapleyComponentAttributor` — coalitional Shapley value ($\phi_j$) and Leave-One-Out (LOO) counterfactual surface credit assignment across candidate pools, plus `pruneFreeRiderSurfaces` auto-ablation integrated into `RecursiveEvolutionEngine`.
- **infra/evolution (Wave 6.3)**: `CanaryDeploymentController` — staged production traffic routing (`10% -> 25% -> 50% -> 100%`) with a sequential Page-Hinkley / CUSUM change-point detector that triggers automatic `admissionGate.rollbackBaseline()` and `experienceLibrary.quarantine()` on pass-rate degradation, cost inflation, or safety violations.
- **infra/evolution (Wave 6.4)**: `BradleyTerryHarnessRanker` — longitudinal Glicko-2 / Bradley-Terry tournament rating engine ($\mu_H$, $\text{RD}_H$, conservative lower-confidence bound $\mu - 1.96 \cdot \text{RD}$) and active-learning matchup recommender (`suggestNextMatchups`).
- **infra/evolution & mcp (Wave 6.5)**: `createEvolutionMcpTools` and `registerEvolutionMcpTools` wired into `McpServer` (`enableEvolutionTools: true`), exposing 6 native MCP tools (`evolution_synthesize_manifest`, `evolution_inspect_lineage`, `evolution_split_and_transfer`, `evolution_prepare_viforge_handoff`, `evolution_ingest_checkpoint`, `evolution_leaderboard_and_canary`).
- **infra/evolution & cli (Wave 6.6)**: `EvolutionReportExporter` and `vi-harness evolution report <runId> [--format md|html|latex] [--out <file>]` generating Markdown (with Mermaid lineage DAGs), self-contained dark-mode HTML dashboards, and publication-ready LaTeX (`booktabs`) tables.

### Wave 5 — Closed-Loop Autonomous Co-Evolution (`ViForge <-> Vi-Harness`), Sequential Statistical Control (`SPRT` + `Holm-Bonferroni`), AST Sandbox Verifier & ACP/MCP Evolution Endpoints

- **infra/evolution (Wave 5.1)**: Native integration of `MemoHarnessSynthesizer` (zero-search fast path), `DiscriminativeTaskSelector` (entropy micro-probing), `AdversarialProbeGenerator` (counterfactual robustness verification), `ContrastivePreferenceExporter` (capability ceiling diagnosis), `HolmBonferroniMultipleTestingGate`, and `ViForgeCoEvolutionBridge` into `RecursiveEvolutionEngine.runCycle()`.
- **cli & di (Wave 5.2)**: Added `harness split`, `harness transfer`, `harness synthesize`, and `evolution export-viforge` subcommands in `src/cli/commands/evolve.ts`, plus full DI registration in `TOKENS` and `DefaultModule`.
- **infra/evolution & acp (Wave 5.3)**: `EvolutionRpcDispatcher` wired into `AcpHandlers` and `AcpServer` exposing `evolution/synthesizeManifest`, `evolution/inspectLineage`, `evolution/splitAndTransfer`, `evolution/prepareViForgeHandoff`, and `evolution/ingestModelCheckpoint` over JSON-RPC 2.0.
- **infra/evolution (Wave 5.4)**: `WaldSprtStoppingRule` (Sequential Probability Ratio Test for early stopping of inferior/superior probe repetitions in `IsolatedHarnessProbeRunner`) and `HolmBonferroniMultipleTestingGate` (Family-Wise Error Rate control across $M$ candidate hypotheses).
- **infra/evolution (Wave 5.5)**: `ExecutableSurfaceAstVerifier` (TypeScript Compiler API AST sandbox verifier blocking forbidden imports, dynamic `eval`/`Function`/`import()`, restricted globals, prototype escapes, and unseeded `Math.random()`) wired into `DefaultHarnessSurfaceRegistry` (`scripts` and `plugins` surfaces).
- **infra/evolution (Wave 5.6)**: `ViForgeCoEvolutionBridge` (`prepareViForgeHandoff` exporting signed `viforge_handoff_manifest.json` + DPO/GRPO/SPIN datasets, and `ingestUpdatedModelCheckpoint` recombining `TransferableCore` + `EcosystemMargin` and invalidating stale model-specific experiences in `HarnessExperienceLibrary`).

### Wave 4 — Live Runtime Bridges, `Task-CoEvolve`, `HarnessX` (`ViForge`), `MemoHarness`, `EcosystemMargin` & Counterfactual Probes

- **infra/evolution (Wave 4.1)**: `ModelDrivenCandidateGenerator` (with progressive trace disclosure and Zod validation), `ModelDrivenHarnessComposer` (with `DefaultHarnessComposer` fail-closed fallback), and `createRuntimeMaterializedProbeExecutor` (materializing `HarnessManifest` into live `AgentRuntime` probe trials).
- **infra/evolution (Wave 4.2)**: `DiscriminativeTaskSelector` (`Task-CoEvolve` binary Shannon entropy, partial-score variance, and surface-relevance micro-subset selection).
- **infra/evolution (Wave 4.3)**: `ContrastivePreferenceExporter` (`HarnessX` / `ViForge` DPO preference pairs, GRPO group rollouts with normalized advantages, Model Capability Ceiling detector, and SPIN self-play JSONL exporter).
- **infra/evolution (Wave 4.4)**: `SqliteHarnessExperienceLibrary` (`better-sqlite3` WAL persistence + Jaccard/TF-IDF semantic retrieval) and `MemoHarnessSynthesizer` (zero-search test-time manifest synthesis from `E3_VERIFIED` / `E4_GENERALIZATION` memories).
- **infra/evolution & eval (Wave 4.5)**: `EcosystemMarginSplitter` (`TransferableCore` vs `EcosystemMargin` decomposition & cross-model recombination) and `EvolutionBenchmarkProtocol.runCrossModelTransferMatrix`.
- **infra/evolution & tui (Wave 4.6)**: `AdversarialProbeGenerator` (counterfactual `EDGE_CASE_INJECTION`, `IDENTIFIER_RENAMING_TRAP`, `STRICT_REGRESSION_ASSERTION` probes and coincidental-pass detection) plus `EvolutionTreeRenderer.renderLiveEvent` and `renderParetoFrontierTable`.

### Wave 3 — Evidence-Gated Recursive Harness Evolution Under Zero-Trust (Milestones A–F)

- **core/evolution**: Canonical `HarnessManifest` (8 Harness² components + 4 Vi-Harness native structural policy surfaces), `HarnessConstitution` (4 capability classes & 6 immutable core surfaces), `EvidenceLevel` (`E0_REFLECTION`..`E4_GENERALIZATION`), 12-surface `HarnessSurfaceRegistry`, 30-signal extensible `FailureTaxonomyRegistry`, and pre-declared `HarnessChangeHypothesis` / `BehavioralContrast` / `EvidenceBundle` models.
- **infra/evolution**: `HarnessManifestToolkit`, `DefaultHarnessDiagnoser`, 4-quadrant `DefaultHarnessProposer`, `DefaultCandidateRegularizer` (`BenchmarkSpecificityCritic`, `GeneralizationCritic`, `HarnessPruner`), `IsolatedHarnessProbeRunner` (enforcing held-out split inaccessibility and restricted network egress), `DefaultBehavioralContrastAnalyzer`, `DefaultHarnessComposer`, `ParallelRecursionStrategy`, `SequentialRecursionStrategy`, `AdaptiveRecursionStrategy` (`AdaptiveRecursionBudgetPolicy`), `DefaultMultiObjectiveSelector` (Pareto frontier), `RetentionSuiteRunner` (`EvoHarnessBench` capability retention tracking), `FailClosedAdmissionGate` (HMAC-signed promotion & rollback), `FileHarnessExperienceLibrary` (with canonical `H0` baseline reset invariant), `EightComponentAdapter`, and `RecursiveEvolutionEngine`.
- **eval & tui**: `EvolutionBenchmarkProtocol` (matched-budget baselines, 95% CIs, statistical power analysis, and `INFRA_ERROR` separation) and `EvolutionTreeRenderer`.
- **cli**: New `harness`, `evolve`, `evolution`, `library`, `promote`, and `rollback-harness` commands with `--dry-run` preview mode.
- **outer-loop fixes**: `SkillExtractor` now extracts failure anti-pattern lessons from unsuccessful runs (`DEFECT-01`), and `HarnessAutoTuner` enforces transactional, HMAC-signed, fail-closed persistence (`DEFECT-02`).
- **docs & tests**: Added ADRs `013`–`018`, 22 Evolution Plane threats (`E-01`..`E-22`) in `THREAT_MODEL.md`, mutation-adequacy suite (`mutation-contracts.test.ts`), and machine-verifiable architecture drift guard (`architecture-sync.test.ts`). Total suite: **1,373 passing tests across 203 test files**.


---

### Wave 2 — SOTA 2026 Next-Generation Tracks (A–E)

#### 🔁 Track A (P0): Autonomous Judge-in-the-Loop Iterative Repair Engine
- **runtime**: `JudgeInTheLoopOrchestrator` — executes external judge commands in the target workspace, captures execution output, parses verdicts (`AC`, `WA`, `CE`, `TLE`, `MLE`, `RE`), and extracts compiler error / test failure snippets.
- **cli**: New `solve` flags `--judge-command <cmd>` and `--max-judge-retries <n>` (default: 3) — drives autonomous iterative repair loops against ACMOJ, SWE-bench Docker, Codeforces, or any local judge command.
- **tests**: +15 unit tests in `tests/unit/eval/judge-orchestrator.test.ts`.

#### 🛡️ Track B (P0): Pre-Write In-Memory AST Syntax & Parse Gate
- **security**: `PreWriteSyntaxGate` — intercepts all `write_file` and `edit_file` calls before disk flush and validates syntax in-memory across TypeScript/JavaScript (TypeScript Compiler API `ts.createSourceFile`), JSON (`JSON.parse` with exact line/column extraction), Python (block delimiter inspection), and all languages (universal bracket balance invariant).
- **infra**: Returns rich, actionable syntax error messages to the model so it self-corrects without polluting the workspace or Git tree.
- **tests**: +15 unit tests in `tests/unit/security/pre-write-syntax-gate.test.ts`.

#### 🔍 Track C (P1): Batch Semantic Discovery & High-Throughput Code Search
- **tools**: `batch_find_symbols` — resolves multiple symbol declarations, signatures, and AST locations in a single model turn; reduces exploration overhead by up to 70%.
- **tools**: `search_code` — concurrent multi-pattern regex search with path globbing (`includePattern`, `excludePattern`), context-bounded line snippet windows, and configurable max match limits.
- **tests**: +7 unit tests in `tests/unit/tools/batch-semantic-tools.test.ts`.

#### 🔬 Track D (P1): Dual-Pass Adversarial QA Auditor Gate
- **verification**: `QaAuditorGate` — dual-pass adversarial inspection engine analysing patch hunks for multi-line command injections, unescaped shell concatenations, hardcoded secrets (Shannon entropy thresholding), unchecked `as any` type bypasses, resource leaks (unclosed streams, unhandled file handles), and empty catch blocks swallowing exceptions.
- **cli**: New `solve` flag `--adversarial-qa` — rejects flawed solutions and mandates targeted repair iterations before patch export.
- **tests**: +8 unit tests in `tests/unit/verification/qa-auditor-gate.test.ts`.

#### 🗜️ Track E (P2): Multi-Tier Dynamic Context Pruning & Micro-Compaction Pipeline
- **compiler**: `MicroCompactor` — dynamic stale-read tombstoning (replaces obsolete `read_file` results with compact tombstones once the file is modified in a later iteration) and resolved-failure compaction (collapses error logs once a subsequent command or test run succeeds).
- **compiler**: Integrated as Stage 2 of the 5-stage compaction pipeline (`Snip → Micro-compact → Collapse → Auto-compact → Cache-Aware`), seamlessly reducing token bloat in long-horizon tasks (20–50 iterations).
- **tests**: +11 unit tests in `tests/unit/compiler/micro-compactor.test.ts`.

#### 📊 Wave 2 Quality Gate Results
- **Total test suite**: 1,304 passed / 193 files / 0 failures (+56 tests, +28 files from Wave 2).
- **TypeScript typecheck**: 0 errors.
- **ESLint**: 0 errors.
- **Production build**: Clean.
- **Tarball size**: 2,030.4 KB (< 2 MB limit).

---

### Wave 1 — Core CLI & Workspace Tools

#### 🚀 Features
- **cli**: Native standalone `solve` command (`vi-harness solve -p "<task>"` / `vi-harness -p "<task>"` / `vih solve`) for executing autonomous coding tasks headlessly on any repository workspace without out-of-tree wrappers.
- **cli**: Machine-readable JSONL streaming mode (`--mode jsonl`) for clean CI/CD and automated benchmark harness orchestration.
- **tools**: Precision targeted file editing tool (`edit_file`) using search-and-replace block replacement to eliminate whole-file overwriting and prevent signature regression bugs.
- **tools**: Git rollback tool (`revert_file`) enabling agents to discard changes and recover from catastrophic build errors.
- **tools**: Shell execution (`run_command`) with automatic compiler warning detection (`-Wall -Wextra -Werror`), notifying the agent to eliminate all warnings prior to completion.
- **tools**: Real filesystem tools (`read_file`, `write_file`, `list_directory`) with path traversal denial and directory creation.
- **syntax**: Automatic RepoMap context injection on startup in `solve`, including C and C++ AST/regex symbol extraction (`SourceCodeIndexer`).
- **model**: OpenRouter generation ID (`x-openrouter-generation-id`) and exact provider-reported cost tracking.
- **reliability**: Post-edit syntax integrity alert hook detecting unclosed braces (`{ }`, `( )`, `[ ]`) and malformed JSON before compiler invocation.
- **runtime**: Configurable request timeouts (`VI_HARNESS_REQUEST_TIMEOUT_MS`, default 180s) and retries (`VI_HARNESS_MAX_RETRIES`).

## [0.1.0] - 2026-08-19

### 🚀 Features
- **runtime**: Architect Mode (Dual-Model Plan→Execute) with pre-step interception waterfalls.
- **goal**: Event-sourced goal lifecycle with token budgets, round limits, and hierarchical child attribution.
- **memory**: Frozen memory snapshot, skills catalog, and background self-improvement loop.
- **session**: Tree-structured session branching, derived model history, crash recovery, and JSONL persistence.
- **telemetry**: Outer-loop experience accumulation and auto-tuning diagnostics (Meta-Harness pattern).
- **eval**: First-class ProjDevBench generative project benchmark integration.
- **eval**: Terminal-Bench (TBench 2.0 / Harbor framework) containerized evaluation suite.
- **mcp**: Production stdio and HTTP/SSE MCP transports with JSON-RPC 2.0.
- **acp**: Agent Client Protocol (ACP) automation server for headless CI and multi-agent orchestrators.
- **storage**: Persistent SQLite storage with WAL mode, generic KV with TTL, and Hermes memory lifecycle curation.
- **distribution**: Distribution profiles (`web`, `headless`, `ci`, `eval`), npm packaging, and auto-update checker.
