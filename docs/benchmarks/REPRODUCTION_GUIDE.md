# Vi-Harness Benchmark Reproduction Guide

> **Standardized Verification Protocol for Empirical Evaluation Claims**  
> *Targeted for researchers, practitioners, and independent evaluators.*

---

## 1. Overview & Evaluation Principles

Vi-Harness adopts an evidence-first, hypothesis-driven evaluation methodology. In standard coding-agent benchmarks, model capability is frequently conflated with harness efficiency. Our benchmark architecture **strictly isolates the agent harness as the independent variable**, holding the following parameters constant:

| Variable | Control Specification |
|:---|:---|
| **Model** | Identical model endpoint (`openai/gpt-4o` or mock simulation) |
| **Sampling** | Temperature = `0.0` (or `0.2` for stochastic robustness sweeps) |
| **Workspace** | Isolated ephemeral directories per trial (`mkdtemp`) |
| **Tool Surface** | Identical tool registry, schemas, and execution timeout |
| **Verification** | Empirical exit-code and test-runner oracle verification |
| **Budget** | Pinned maximum iterations and dollar cost limits |

---

## 2. Experimental Environment Specification

All official published benchmark numbers were generated under the following baseline specification:

- **Operating System**: Linux (Ubuntu 22.04 LTS / Debian 12) or Windows 11 (tested on `win32` x64)
- **Node.js Runtime**: `>= 20.0.0` (baseline established on Node `v24.16.0` LTS)
- **TypeScript**: `5.7.x`
- **Memory**: 16 GB minimum recommended (isolated workspaces reside in tempfs or OS temp directory)
- **Network**: Offline simulation for deterministic runs; stable internet access for live API providers

---

## 3. Reproduction Commands

### A. Canonical Baseline Suite (Pi vs. Vi-Harness)

Evaluates the 7 canonical coding-agent tasks comparing transcript accumulation (Pi) against compiled-context state-machine architecture (Vi-Harness).

#### Dry Run (Task Inspection & Schema Verification)
```bash
npm run benchmark -- --dry-run
```

#### Deterministic Offline Run (Mock Provider)
```bash
npm run benchmark -- --suite canonical --provider mock --runs 3
```

#### Live Evaluation (OpenAI GPT-4o)
```bash
export OPENAI_API_KEY="sk-..."
npm run benchmark -- --suite canonical --provider openai --model gpt-4o --runs 3 --output ./benchmark-results
```

Expected output:
- `benchmark-results/benchmark-report.json`
- `benchmark-results/benchmark-report.md`

---

### B. Multi-Horizon Context Efficiency Benchmark

Measures context token growth and critical domain memory retention across increasing iteration horizons (10, 25, 50, 100 turns).

```bash
npm run benchmark:context -- --horizons 10,25,50,100 --output ./benchmark-results/context
```

Expected output:
- `benchmark-results/context/context-benchmark-report.json`
- `benchmark-results/context/context-benchmark-report.md`

---

### C. ProjDevBench (Repository Construction & End-to-End Development)

Evaluates multi-file project scaffolding, package initialization, and test suite greenfield generation.

```bash
npm run bench:projdevbench -- --output ./benchmark-results/projdevbench
```

Expected output:
- `benchmark-results/projdevbench/projdevbench-report.json`
- `benchmark-results/projdevbench/projdevbench-report.md`

---

### D. Terminal-Bench / Harbor Execution Suite (TBench)

Evaluates shell tool command execution, stderr recovery, and terminal toolchain interactions.

```bash
npm run bench:tbench -- --output ./benchmark-results/tbench
```

Expected output:
- `benchmark-results/tbench/tbench-report.json`
- `benchmark-results/tbench/tbench-report.md`

---

## 4. Expected Reproducibility Envelope

When reproducing benchmarks, observed metrics should fall within the following tolerances:

| Metric | Tolerance Envelope | Rationale |
|:---|:---|:---|
| **Success Rate** | **100% (Exact)** | With deterministic seeds and mock provider, all 7 tasks pass. |
| **Iteration Count** | **±0% (Exact)** | State-machine transitions follow fixed deterministic phases. |
| **Token Consumption** | **±5% Variance** | Due to provider-side tokenizer token boundary differences and system prompt timestamps. |
| **Total Cost** | **±5% Variance** | Proportional to token variance based on model pricing matrix. |
| **Latency / Duration** | **Hardware-dependent** | Local I/O speed, CPU, and network roundtrips introduce natural timing variance. |

---

## 5. Interpreting Results

Compare generated reports against reference data in `benchmark-results/`:

1. **Token Savings**: Vi-Harness maintains sublinear context token consumption through the 6-stage Context Compiler (`MicroCompactor`, `Pruning`, `Deduplication`). Total token consumption is typically **75% to 85% lower** than uncompressed transcript accumulation.
2. **Cost Reduction**: Proportional to prompt token compression, cost reduction averages **~95%** on extended trajectories.
3. **Zero False Positives**: All successful outcomes are corroborated by verifiable evidence stored in `DefaultEvidenceStore` and validated by `VerificationEngine`.

---

## 6. Continuous Benchmarking CI Integration

The benchmark suite is continuously exercised in GitHub Actions via:
- `.github/workflows/ci.yml` (smoke test with dry-run and mock provider verification)
- Scheduled regression sweeps verifying token budgets and memory retention invariants.
