# Vi-Harness Official Benchmark Evaluation Report

> **Experimental Design**: Isolates the agent harness as the primary independent variable
> holding model, task, tools, timeout, budget, and workspace environment constant.

---

## 1. Experiment Control Parameters

- **Suite**: `Canonical Harness Baseline Evaluation Suite v1` (`suite-baseline-v1`)
- **Model**: `openai/gpt-4o` (Temperature: `0.2`)
- **Trials Per Task**: `3` repeated runs per harness
- **Reproducibility Seed**: `reproducible-seed-9876`
- **Environment**: OS `win32` | Node `v24.16.0` | Isolated Workspaces: `true`
- **Generated At**: `2026-08-26T14:12:23.485Z`

---

## 2. Executive Comparison: Pi vs Vi-Harness

| Harness | Version | Runs | Success Rate | Mean Cost | Median Cost | P95 Cost | Mean Iter | Median Iter | P95 Iter | Mean Latency | Median Latency | P95 Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Vi-Harness** | `0.1.0-vi-harness` | 21 | 100.0% | $0.0015 | $0.0015 | $0.0018 | 6.0 | 6.0 | 6.0 | 355ms | 351ms | 446ms |
| **Pi** | `0.1.0-pi-harness` | 21 | 100.0% | $0.0604 | $0.0635 | $0.0635 | 3.9 | 4.0 | 4.0 | 80ms | 80ms | 80ms |

---

## 3. Token Consumption Distributions

| Harness | Prompt Tokens (Mean / Med / P95) | Completion Tokens (Mean / Med / P95) | Total Tokens (Mean / Med / P95) | StdDev Total Tokens |
| :--- | :--- | :--- | :--- | :--- |
| **Vi-Harness** | 1171 / 1134 / 1478 | 160 / 159 / 165 | 1331 / 1299 / 1635 | 129.7 |
| **Pi** | 18771 / 19800 / 19800 | 1350 / 1400 / 1400 | 20121 / 21200 / 21200 | 2707.2 |

---

## 4. Task-by-Task Comparison Breakdown

| Task ID | Name | Category | Harness | Success | Mean Cost | Median Cost | P95 Cost | Mean Iter | P95 Iter | Mean Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `task-001-small-bug` | Small Bug Fix | `SMALL_BUG` | **Vi-Harness** | 100% | $0.0014 | $0.0014 | $0.0014 | 6.0 | 6.0 | 376ms |
| `task-001-small-bug` | Small Bug Fix | `SMALL_BUG` | **Pi** | 100% | $0.0420 | $0.0420 | $0.0420 | 3.0 | 3.0 | 80ms |
| `task-002-medium-feature` | Medium Feature Implementation | `MEDIUM_FEATURE` | **Vi-Harness** | 100% | $0.0014 | $0.0014 | $0.0014 | 6.0 | 6.0 | 373ms |
| `task-002-medium-feature` | Medium Feature Implementation | `MEDIUM_FEATURE` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |
| `task-003-multi-file-refactor` | Multi-File Refactoring | `MULTI_FILE_REFACTOR` | **Vi-Harness** | 100% | $0.0018 | $0.0018 | $0.0018 | 6.0 | 6.0 | 340ms |
| `task-003-multi-file-refactor` | Multi-File Refactoring | `MULTI_FILE_REFACTOR` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |
| `task-004-test-repair` | Flaky / Broken Test Repair | `TEST_REPAIR` | **Vi-Harness** | 100% | $0.0014 | $0.0014 | $0.0014 | 6.0 | 6.0 | 287ms |
| `task-004-test-repair` | Flaky / Broken Test Repair | `TEST_REPAIR` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |
| `task-005-long-debugging-task` | Long-Horizon Memory Debugging | `LONG_DEBUGGING_TASK` | **Vi-Harness** | 100% | $0.0015 | $0.0015 | $0.0015 | 6.0 | 6.0 | 469ms |
| `task-005-long-debugging-task` | Long-Horizon Memory Debugging | `LONG_DEBUGGING_TASK` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |
| `task-006-security-sensitive-change` | Security-Sensitive Permission Modification | `SECURITY_SENSITIVE_CHANGE` | **Vi-Harness** | 100% | $0.0015 | $0.0015 | $0.0015 | 6.0 | 6.0 | 322ms |
| `task-006-security-sensitive-change` | Security-Sensitive Permission Modification | `SECURITY_SENSITIVE_CHANGE` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |
| `task-007-regression-repair` | Regression Repair under Precedence Rules | `REGRESSION_REPAIR` | **Vi-Harness** | 100% | $0.0015 | $0.0015 | $0.0015 | 6.0 | 6.0 | 317ms |
| `task-007-regression-repair` | Regression Repair under Precedence Rules | `REGRESSION_REPAIR` | **Pi** | 100% | $0.0635 | $0.0635 | $0.0635 | 4.0 | 4.0 | 80ms |

---

## 5. Statistical Distribution Details

### Harness: Vi-Harness

| Metric: Cost ($) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 0.001491 | 0.001464 | 0.001792 | 0.001392 | 0.001792 | 0.000129 | 21 |

| Metric: Iterations | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 6 | 6 | 6 | 6 | 6 | 0 | 21 |

| Metric: Total Tokens | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 1331 | 1299 | 1635 | 1239 | 1635 | 129.713145 | 21 |

| Metric: Latency (ms) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 354.904762 | 351 | 446 | 249 | 660 | 86.853845 | 21 |

### Harness: Pi

| Metric: Cost ($) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 0.060429 | 0.0635 | 0.0635 | 0.042 | 0.0635 | 0.007709 | 21 |

| Metric: Iterations | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 3.857143 | 4 | 4 | 3 | 4 | 0.358569 | 21 |

| Metric: Total Tokens | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 20121.428571 | 21200 | 21200 | 13650 | 21200 | 2707.1928 | 21 |

| Metric: Latency (ms) | Mean | Median | P95 | Min | Max | StdDev | Samples |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Value | 80 | 80 | 80 | 80 | 80 | 0 | 21 |
