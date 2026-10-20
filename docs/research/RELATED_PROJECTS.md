# Vi-Harness: Related Projects & Comparative Analysis

## 1. Feature & Architectural Comparison Matrix

| Architectural Feature | Vi-Harness | Google Research Harness² | Claude Code | Pi | Aider | OpenHands |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **State Machine Axiom** | ✅ 14 Canonical Phases | ⚠️ Outer/Inner Loop | ⚠️ Partial | ❌ Raw Session Tree | ❌ Chat Loop | ⚠️ Event Stream |
| **Evidence-Driven DONE Gate** | ✅ Explicit Verifier Evidence | ✅ Paired Probes | ✅ Tool Verification | ❌ Conversational | ❌ Git Commit | ⚠️ Evaluation Run |
| **Recursive Evolution (`Propose–Probe–Compose`)** | ✅ `RecursiveEvolutionEngine` (8+4 Surfaces) | ✅ 8-Component Dual Recursion ([arXiv:2610.14224v1](https://arxiv.org/html/2610.14224v1)) | ❌ Static Harness | ❌ Static Harness | ❌ Static Harness | ❌ Static Harness |
| **Canonical `H0` Baseline Reset & Experience Library** | ✅ `FileHarnessExperienceLibrary` + `SqliteHarnessExperienceLibrary` | ✅ Experience Library + `H0` Reset | ❌ None | ❌ None | ❌ None | ❌ None |
| **Zero-Trust Constitutional Evolution Boundary** | ✅ `HarnessConstitution` + `FailClosedAdmissionGate` | ⚠️ Unrestricted Egress in Reference Repo | ✅ 7-Layer Runtime Only | ❌ Basic | ❌ Prompt Only | ⚠️ Docker Only |
| **Prefix Caching Segregation** | ✅ `PrefixCachingCompiler` | ❌ Uncached Prompts | ✅ Ephemeral Caching | ❌ Monolithic | ❌ Full Map | ❌ Monolithic |
| **5-Stage Compaction** | ✅ Snip/Micro/Collapse/Auto/Cache | ❌ None | ✅ 5-Stage Engine | ❌ Truncation Only | ❌ Fixed Window | ❌ Truncation |
| **Loop Fingerprint & Oscillation Breaker** | ✅ SHA-256 State Hashing + $\text{LTL}_f$ Monitor | ❌ None | ⚠️ Max Steps | ❌ None | ❌ None | ⚠️ Basic Steps |
| **Causal Trace Distillation (Meta-Harness)** | ✅ JSONL Distiller + Surrogate + Epistatic Graph | ✅ Contrastive Reflection | ❌ None | ❌ None | ❌ None | ❌ None |
| **HMAC SHA-256 & SLSA Provenance Ledger** | ✅ `AuditIntegritySigner` + `CryptographicEvolutionLedger` | ❌ None | ❌ None | ❌ None | ❌ None | ❌ None |
| **Zero-Loss Git Rollback & Worktree Probes** | ✅ `RealGitManager` + `WorktreeProbeSandboxManager` | ❌ None | ⚠️ Git Checkout | ❌ None | ✅ Git Commits | ⚠️ Git Patch |
| **Model-Agnostic Routing** | ✅ Architect / Editor + LinUCB Meta-Router | ✅ Multi-Model | ❌ Anthropic Only | ✅ Multi-Provider | ✅ Multi-Provider | ✅ Multi-Provider |

---

## 2. Summary of Competitive Differentiation

1. **Deterministic State Machine + Governed Self-Evolution**: Unlike static harnesses (Claude Code, Aider, Pi) or unconstrained self-modifying prototypes, Vi-Harness unites a deterministic 14-phase **Runtime Plane** with a governed **Recursive Evolution Plane** grounded in **Google Research's Harness²** ([`google-research/harness2`](https://github.com/google-research/harness2), [`arXiv:2610.14224v1`](https://arxiv.org/html/2610.14224v1)).
2. **Sublinear Context Scaling**: By combining AST symbol mapping, prefix caching segregation, and 5-stage progressive compaction, Vi-Harness bounds context growth to $O(\log N)$ rather than linear unbounded blowup.
3. **Enterprise Defense-in-Depth & Formal Guarantees**: From Shannon entropy credential scrubbing and SHA-256 SLSA provenance ledgers to formal cross-surface policy verification (`StructuralPolicyInvariantVerifier`), finite-trace $\text{LTL}_f$ monitors (`RuntimeTemporalContractMonitor`), and Split Conformal Abstention (`ConformalAbstentionGuard`), Vi-Harness provides verifiable safety controls for regulated production codebases.
