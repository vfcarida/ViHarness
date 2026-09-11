# Vi-Harness Official Benchmark Evaluation Report

> **Experimental Design**: Isolates the agent harness as the primary independent variable
> holding model, task, tools, timeout, budget, and workspace environment constant.

---

## 1. Experiment Control Parameters

- **Suite**: `Canonical Harness Baseline Evaluation Suite v1` (`suite-baseline-v1`)
- **Model**: `mock/gpt-4o` (Temperature: `0.2`)
- **Trials Per Task**: `1` repeated runs per harness
- **Reproducibility Seed**: `reproducible-seed-9876`
- **Environment**: OS `win32` | Node `v24.16.0` | Isolated Workspaces: `true`
- **Generated At**: `2026-09-11T18:29:36.271Z`

---

## 2. Executive Comparison: Pi vs Vi-Harness

| Harness | Version | Runs | Success Rate | Mean Cost | Median Cost | P95 Cost | Mean Iter | Median Iter | P95 Iter | Mean Latency | Median Latency | P95 Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Vi-Harness** | `0.1.0-vi-harness` | 1 | 100.0% | $0.0014 | $0.0014 | $0.0014 | 6.0 | 6.0 | 6.0 | 854ms | 854ms | 854ms |
| **Pi** | `0.1.0-pi-harness` | 1 | 100.0% | $0.0420 | $0.0420 | $0.0420 | 3.0 | 3.0 | 3.0 | 80ms | 80ms | 80ms |

---

## 3. Token Consumption Distributions

| Harness | Prompt Tokens (Mean / Med / P95) | Completion Tokens (Mean / Med / P95) | Total Tokens (Mean / Med / P95) | StdDev Total Tokens |
| :--- | :--- | :--- | :--- | :--- |
| **Vi-Harness** | 1086 / 1086 / 1086 | 153 / 153 / 153 | 1239 / 1239 / 1239 | 0.0 |
| **Pi** | 12600 / 12600 / 12600 | 1050 / 1050 / 1050 | 13650 / 13650 / 13650 | 0.0 |

---

## 4. Task-by-Task Comparison Breakdown

| Task ID | Name | Category | Harness | Success | Mean Cost | Median Cost | P95 Cost | Mean Iter | P95 Iter | Mean Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `task-001-small-bug` | Small Bug Fix | `SMALL_BUG` | **Vi-Harness** | 100% | $0.0014 | $0.0014 | $0.0014 | 6.0 | 6.0 | 854ms |
| `task-001-small-bug` | Small Bug Fix | `SMALL_BUG` | **Pi** | 100% | $0.0420 | $0.0420 | $0.0420 | 3.0 | 3.0 | 80ms |

---

## 5. Statistical Distribution Details

### Harness: Vi-Harness

| Metric: Cost ($) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 0.001392 | 0.001392 | 0.001392 | 0.001392 | 0.001392 | 0 | 1 |

| Metric: Iterations | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 6 | 6 | 6 | 6 | 6 | 0 | 1 |

| Metric: Total Tokens | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 1239 | 1239 | 1239 | 1239 | 1239 | 0 | 1 |

| Metric: Latency (ms) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 854 | 854 | 854 | 854 | 854 | 0 | 1 |

### Harness: Pi

| Metric: Cost ($) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 0.042 | 0.042 | 0.042 | 0.042 | 0.042 | 0 | 1 |

| Metric: Iterations | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 3 | 3 | 3 | 3 | 3 | 0 | 1 |

| Metric: Total Tokens | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 13650 | 13650 | 13650 | 13650 | 13650 | 0 | 1 |

| Metric: Latency (ms) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 80 | 80 | 80 | 80 | 80 | 0 | 1 |
