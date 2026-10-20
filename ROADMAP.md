# Vi-Harness — Product & Engineering Roadmap

> **Architectural North Star:** *"The agent is not a persistent conversation. The agent is a stateful, evidence-driven state machine paired with a zero-trust, falsifiable Recursive Evolution Plane."*

This document tracks the maturity of all architectural capabilities, scientific algorithms, governance guardrails, and ecosystem integrations in **Vi-Harness**. Every capability marked **`Stable`** is implemented in `src/` and continuously verified by automated unit, integration, or mutation-contract suites in `tests/`.

---

## 1. Executive Maturity Matrix (`v0.2.0`)

| Milestone / Track | Domain | Key Modules | Verification Suite | Status |
| :--- | :--- | :--- | :--- | :--- |
| **M1 — Stateful 14-Phase Runtime & Loop Hygiene** | Core Runtime | `DefaultAgentRuntime`, `IterationExecutor`, `LoopFingerprinter` | `tests/unit/runtime/loop-fingerprinter.test.ts` | **Stable** |
| **M2 — 5-Stage Progressive Context Compaction & Prefix Caching** | Context Engineering | `PrefixCachingCompiler`, `ContextCompressor`, `MicroCompactor`, `CachePrefixTracker` | `tests/unit/compiler/multi-tier-compaction.test.ts` | **Stable** |
| **M3 — 7-Layer Zero-Trust Policy Perimeter & Entropy Scrubbing** | Security & Governance | `DefaultPolicyEngine`, `SecretScrubber`, `AuditIntegritySigner`, `PreWriteSyntaxGate` | `tests/unit/security/audit-integrity-signer.test.ts` | **Stable** |
| **M4 — PageRank AST Repo-Map & Two-Phase Git Checkpoints** | Code Intelligence & Git | `SourceCodeIndexer`, `RealGitManager`, `DefaultRollbackManager` | `tests/integration/git-real-repository.test.ts` | **Stable** |
| **M5 — Recursive Subagents, Frozen Memory & Session Trees** | Memory & Delegation | `DefaultSubagentManager`, `FrozenMemorySnapshot`, `SqliteSessionStore` | `tests/unit/infra/subagent-manager.test.ts` | **Stable** |
| **M6 — Autonomous Judge-in-the-Loop & Dual-Pass QA Auditor** | Verification Engine | `JudgeInTheLoopOrchestrator`, `QaAuditorGate`, `ImpactedTestSelector` | `tests/unit/eval/judge-orchestrator.test.ts` | **Stable** |
| **M7 — Coupled Dual-Recursion Evolution Plane (`Harness²` + AHE)** | Evolution Plane (Wave 3) | `RecursiveEvolutionEngine`, `HarnessConstitution`, `FailClosedAdmissionGate`, `RetentionSuiteRunner` | `tests/integration/evolution-lifecycle.test.ts` | **Stable** |
| **M8 — Live Bridges, `Task-CoEvolve`, `MemoHarness` & `ViForge` Co-Evolution** | Evolution Plane (Waves 4–5) | `DiscriminativeTaskSelector`, `MemoHarnessSynthesizer`, `ViForgeCoEvolutionBridge`, `WaldSprtStoppingRule` | `tests/unit/evolution/wave-5-closed-loop-evolution.test.ts` | **Stable** |
| **M9 — Shapley Attribution, Worktree Sandboxes, Canary CUSUM & Glicko-2** | Evolution Plane (Wave 6) | `ShapleyComponentAttributor`, `WorktreeProbeSandboxManager`, `CanaryDeploymentController`, `BradleyTerryHarnessRanker` | `tests/unit/evolution/wave-6-production-autonomy.test.ts` | **Stable** |
| **M10 — Live Hot-Swap, SLSA Hash-Chained Ledger, LinUCB & Federated Sync** | Evolution Plane (Wave 7) | `LiveManifestHotSwapOrchestrator`, `CryptographicEvolutionLedger`, `ContextualBanditMetaRouter`, `FederatedExperienceSynchronizer` | `tests/unit/evolution/wave-7-live-autonomy-and-provenance.test.ts` | **Stable** |
| **M11 — `MAP-Elites` QD Archive, Formal Policy Verifier & Lineage Bisection** | Evolution Plane (Wave 8) | `MapElitesHarnessArchive`, `StructuralPolicyInvariantVerifier`, `LineageBisectionDiagnoser`, `ContinuousEvolutionDaemon` | `tests/unit/evolution/wave-8-qd-formal-and-self-healing.test.ts` | **Stable** |
| **M12 — Bayesian Surrogate, Epistatic Graph, $\text{LTL}_f$ Monitor & Chaos Suite** | Evolution Plane (Wave 9) | `BayesianHarnessSurrogateModel`, `EpistaticSurfaceGraphAnalyzer`, `RuntimeTemporalContractMonitor`, `ChaosFaultInjectionTester` | `tests/unit/evolution/wave-9-surrogate-epistasis-ltl-and-chaos.test.ts` | **Stable** |
| **M13 — Honest-by-Construction Conformal Abstention & Reproducibility** | Statistical Governance | `ConformalAbstentionGuard`, `ConformalUtilityCalibrator` | `tests/unit/evolution/conformal-abstention-and-reproducibility.test.ts` | **Stable** |

---

## 2. Long-Horizon Future Directions (`Planned` — External Infrastructure Scope)

The following tracks require external cluster orchestration, multi-tenant cloud infrastructure, or hardware-specific accelerators and are tracked for future major releases (`v1.0+`):

| Track ID | Capability | Scope & Rationale | Status |
| :--- | :--- | :--- | :--- |
| **F-EXT-01** | **Distributed Kubernetes / Firecracker MicroVM Probe Fleet** | Scaling parallel candidate probes across remote Firecracker microVMs for 1,000+ repository benchmark shards. | **Planned** |
| **F-EXT-02** | **Hardware TEE Enclave Attestation (Intel TDX / AMD SEV-SNP)** | Binding `CryptographicEvolutionLedger` SLSA provenance signatures to hardware Trusted Execution Environment quotes. | **Planned** |
| **F-EXT-03** | **Native IDE Language Server Protocol (LSP) Visual Extension** | Embedding the live `EvolutionCockpitServer` telemetry stream directly inside VS Code and JetBrains IDEs. | **Planned** |

---

*Designed and architected by [Vinicius Caridá](https://github.com/vfcarida).*
