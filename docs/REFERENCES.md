# Vi-Harness — Consolidated Scientific, Executive & Open-Source References

This document consolidates the verified academic literature, frontier AI lab research, executive governance frameworks, and open-source reference architectures that inform the design and verification of **Vi-Harness**.

---

## 1. Academic Papers & Frontier AI Lab Research

1. **Meta-Harness (Stanford IRIS Lab, 2026):** *Meta-Harness: Automated Outer-Loop Agent Engineering* (`arXiv:2603.28052`). Informs `MetaHarnessTraceLogger`, `TraceDistiller`, and `HarnessDiagnosticEngine`.
2. **Claude Code Architecture (Anthropic, 2026):** *Claude Code: An Agentic Operating System Layer* (`arXiv:2604.14228`). Informs the 5-stage progressive compaction pipeline (`ContextCompressor`, `MicroCompactor`), virtual context projection (`ContextCollapse`), and 7-layer security perimeter (`DefaultPolicyEngine`).
3. **Harness² (Google Research, 2026):** *Harness²: Recursive Agent Harnessing for an Open World* ([`arXiv:2610.14224v1`](https://arxiv.org/html/2610.14224v1), [`https://github.com/google-research/harness2`](https://github.com/google-research/harness2)). Informs the coupled dual-recursion Propose–Probe–Compose loop (`RecursiveEvolutionEngine`), explicit 8+4 component tuple representation (`HarnessManifest`, `EightComponentAdapter`), and canonical baseline $H_0$ reset invariant.
4. **SWE-bench (Jimenez et al., Princeton University, ICLR 2024):** *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?* (`arXiv:2310.06770`). Informs `SweBenchTaskLoader` and multi-turn patch verification.
5. **Sequential Probability Ratio Test (Wald, 1945):** *Sequential Tests of Statistical Hypotheses*, Annals of Mathematical Statistics. Informs `WaldSprtStoppingRule` in `src/infra/evolution/statistical-admission-control.ts`.
6. **Holm-Bonferroni Step-Down Procedure (Holm, 1979):** *A Simple Sequentially Rejective Multiple Test Procedure*, Scandinavian Journal of Statistics. Informs `HolmBonferroniMultipleTestingGate` for Family-Wise Error Rate (FWER) control across candidate hypotheses.
7. **Shapley Value & Shapley-Taylor Interaction Index (Shapley, 1953; Sundararajan et al., ICML 2020):** *The Shapley-Taylor Interaction Index*. Informs `ShapleyComponentAttributor` and `EpistaticSurfaceGraphAnalyzer`.
8. **MAP-Elites Quality-Diversity Illumination (Mouret & Clune, 2015):** *Illuminating Search Spaces by Mapping Elites* (`arXiv:1504.04909`). Informs `MapElitesHarnessArchive`.
9. **Submodular Facility-Location Maximization (Nemhauser, Wolsey & Fisher, 1978):** *An Analysis of Approximations for Maximizing Submodular Set Functions*. Informs the $(1 - 1/e)$ greedy curriculum selector in `SubmodularBenchmarkCoEvolver`.
10. **Linear Temporal Logic over Finite Traces — $\text{LTL}_f$ (De Giacomo & Vardi, IJCAI 2013):** *Linear Temporal Logic and Linear Dynamic Logic on Finite Traces*. Informs `RuntimeTemporalContractMonitor`.
11. **Split Conformal Prediction & Distribution-Free Uncertainty (Vovk, Gammerman & Shafer, 2005; Angelopoulos & Bates, 2021):** *A Gentle Introduction to Conformal Prediction and Distribution-Free Uncertainty Quantification*. Informs `ConformalUtilityCalibrator` and `ConformalAbstentionGuard`.
12. **Gaussian Process Expected Improvement & Bayesian Optimization (Mockus, 1978; Snoek, Larochelle & Adams, NeurIPS 2012):** *Practical Bayesian Optimization of Machine Learning Algorithms*. Informs `BayesianHarnessSurrogateModel`.
13. **Multi-Objective Hypervolume & Augmented Tchebycheff Scalarization (Zitzler & Thiele, 1998; Miettinen, 1999):** *Nonlinear Multiobjective Optimization*. Informs `HypervolumeParetoSelector`.
14. **Contextual Bandits with Linear Payoffs — LinUCB (Li et al., WWW 2010):** *A Contextual-Bandit Approach to Personalized News Article Recommendation*. Informs `ContextualBanditMetaRouter`.

---

## 2. Standards, Security & Executive Governance Frameworks

1. **NIST AI Risk Management Framework (AI RMF 1.0, NIST, 2023):** *Artificial Intelligence Risk Management Framework (Govern, Map, Measure, Manage)*. Embedded via `HarnessConstitution`, `FailClosedAdmissionGate`, and `ConformalAbstentionGuard`.
2. **OWASP Top 10 for Large Language Model Applications (OWASP, 2025):** Mitigates prompt injection, sensitive information disclosure (`SecretScrubber` Shannon entropy redaction), and excessive agency (`DefaultPolicyEngine` & `ExecutableSurfaceAstVerifier`).
3. **SLSA v1.0 & In-Toto Supply-Chain Attestation Specification (Linux Foundation / OpenSSF):** Implemented in `CryptographicEvolutionLedger` for tamper-evident hash-chained provenance of promoted harness manifests.
4. **Gartner AI TRiSM (AI Trust, Risk, and Security Management) & Executive Agentic ROI Governance (BCG Henderson Institute / McKinsey / MIT Sloan Management Review):** Operationalized via matched-budget token ROI accounting (`AdaptiveRecursionBudgetPolicy`, `EvolutionBenchmarkProtocol`), staged canary CUSUM rollback (`CanaryDeploymentController`), and deterministic fault-injection testing (`ChaosFaultInjectionTester`).

---

## 3. Open-Source Ecosystem Exemplars

1. **Claude Code** (`https://github.com/anthropics/claude-code`) — Multi-stage context compaction and layered permission gates.
2. **Aider** (`https://github.com/Aider-AI/aider`) — PageRank AST repository map indexing and two-phase Git commit attribution.
3. **Cline / Prime Agent** (`https://github.com/cline/cline`) — Context-isolated subagents and hierarchical token budget attribution.
4. **Hermes Agent** (`https://hermes-agent.org`) — Frozen memory snapshots and autonomous skill extraction.
5. **Pi Agent** (`https://pi.dev`) — Provider abstraction layer and tree-structured session branching.
6. **DeepSeek Harness** (`https://github.com/deepseek-ai/deepseek-harness`) — Replaceable capability seams, parallel tool barriers, and Agent Client Protocol (ACP) JSON-RPC 2.0 server.
7. **Google Research — Harness²** (`https://github.com/google-research/harness2` | `https://arxiv.org/html/2610.14224v1`) — Reference implementation and specification of coupled dual-recursion agent harness evolution (`Propose–Probe–Compose`) and 8-component harness tuple representation.

See also [docs/research/REFERENCE_MATRIX.md](research/REFERENCE_MATRIX.md) and [docs/research/RESEARCH_REPORT.md](research/RESEARCH_REPORT.md) for detailed module-to-reference traceability.
