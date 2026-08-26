/**
 * Standard Baseline Scenarios.
 *
 * Defines 7 canonical scenarios for evaluating the harness independently from the model.
 */
import type { TaskSuite, BenchmarkTask } from '../../core/model/benchmark-types.js';
import { BaselineScenarioCategory } from '../../core/model/benchmark-types.js';

export const BASELINE_SCENARIOS: ReadonlyArray<BenchmarkTask> = [
  {
    id: 'task-001-small-bug',
    name: 'Small Bug Fix',
    category: BaselineScenarioCategory.SMALL_BUG,
    description: 'Fix single-line logic error in pricing engine calculation',
    repositoryPath: 'fixtures/scenarios/small-bug',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
    },
    evidenceCriteria: {
      minConfidence: 0.9,
      allowWarnings: true,
      requiredEvidenceTypes: ['TEST_RESULT'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-pricing'],
    },
    budget: {
      maxTokens: 10000,
      maxCostUSD: 0.1,
      maxIterations: 5,
    },
    timeout: {
      perIterationMs: 30000,
      totalTaskMs: 120000,
    },
  },
  {
    id: 'task-002-medium-feature',
    name: 'Medium Feature Implementation',
    category: BaselineScenarioCategory.MEDIUM_FEATURE,
    description: 'Add tax exemption coupon validation to shopping cart service',
    repositoryPath: 'fixtures/scenarios/medium-feature',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
      requiredArtifacts: ['src/services/coupon.ts'],
    },
    evidenceCriteria: {
      minConfidence: 0.85,
      allowWarnings: true,
      requiredEvidenceTypes: ['TEST_RESULT', 'STATIC_ANALYSIS'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-cart-service'],
    },
    budget: {
      maxTokens: 25000,
      maxCostUSD: 0.25,
      maxIterations: 10,
    },
    timeout: {
      perIterationMs: 45000,
      totalTaskMs: 240000,
    },
  },
  {
    id: 'task-003-multi-file-refactor',
    name: 'Multi-File Refactoring',
    category: BaselineScenarioCategory.MULTI_FILE_REFACTOR,
    description: 'Decouple pricing calculator into isolated strategy pattern modules',
    repositoryPath: 'fixtures/scenarios/multi-file-refactor',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
      requiredArtifacts: ['src/strategies/tax-strategy.ts', 'src/strategies/discount-strategy.ts'],
    },
    evidenceCriteria: {
      minConfidence: 0.9,
      allowWarnings: false,
      requiredEvidenceTypes: ['TEST_RESULT', 'TYPE_CHECK'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-pricing-strategies'],
    },
    budget: {
      maxTokens: 50000,
      maxCostUSD: 0.5,
      maxIterations: 15,
    },
    timeout: {
      perIterationMs: 60000,
      totalTaskMs: 360000,
    },
  },
  {
    id: 'task-004-test-repair',
    name: 'Flaky / Broken Test Repair',
    category: BaselineScenarioCategory.TEST_REPAIR,
    description: 'Fix broken integration test mock setup caused by API contract updates',
    repositoryPath: 'fixtures/scenarios/test-repair',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
    },
    evidenceCriteria: {
      minConfidence: 0.95,
      allowWarnings: true,
      requiredEvidenceTypes: ['TEST_RESULT'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-integration-suite'],
    },
    budget: {
      maxTokens: 20000,
      maxCostUSD: 0.2,
      maxIterations: 8,
    },
    timeout: {
      perIterationMs: 30000,
      totalTaskMs: 180000,
    },
  },
  {
    id: 'task-005-long-debugging-task',
    name: 'Long-Horizon Memory Debugging',
    category: BaselineScenarioCategory.LONG_DEBUGGING_TASK,
    description: 'Diagnose intermittent race condition across 12-iteration execution trajectory',
    repositoryPath: 'fixtures/scenarios/long-debugging',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
    },
    evidenceCriteria: {
      minConfidence: 0.85,
      allowWarnings: true,
      requiredEvidenceTypes: ['TEST_RESULT', 'LOG_TRACE'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-concurrency-suite'],
    },
    budget: {
      maxTokens: 80000,
      maxCostUSD: 0.8,
      maxIterations: 20,
    },
    timeout: {
      perIterationMs: 60000,
      totalTaskMs: 600000,
    },
  },
  {
    id: 'task-006-security-sensitive-change',
    name: 'Security-Sensitive Permission Modification',
    category: BaselineScenarioCategory.SECURITY_SENSITIVE_CHANGE,
    description: 'Update secret token sanitizer without exposing raw authorization credentials',
    repositoryPath: 'fixtures/scenarios/security-change',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
    },
    evidenceCriteria: {
      minConfidence: 1.0,
      allowWarnings: false,
      requiredEvidenceTypes: ['SECURITY_SCAN', 'TEST_RESULT'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-security-sanitizer'],
    },
    budget: {
      maxTokens: 30000,
      maxCostUSD: 0.3,
      maxIterations: 10,
    },
    timeout: {
      perIterationMs: 45000,
      totalTaskMs: 300000,
    },
  },
  {
    id: 'task-007-regression-repair',
    name: 'Regression Repair under Precedence Rules',
    category: BaselineScenarioCategory.REGRESSION_REPAIR,
    description: 'Resolve introduced billing regression while maintaining newly added feature',
    repositoryPath: 'fixtures/scenarios/regression-repair',
    successCriteria: {
      expectedFinalState: 'DONE',
      minTestPassRate: 1.0,
    },
    evidenceCriteria: {
      minConfidence: 0.9,
      allowWarnings: true,
      requiredEvidenceTypes: ['TEST_RESULT'],
    },
    regressionCriteria: {
      zeroRegressionsRequired: true,
      baselineChecks: ['check-billing-suite', 'check-auth-suite'],
    },
    budget: {
      maxTokens: 35000,
      maxCostUSD: 0.35,
      maxIterations: 12,
    },
    timeout: {
      perIterationMs: 45000,
      totalTaskMs: 300000,
    },
  },
];

export const CANONICAL_BASELINE_SUITE: TaskSuite = {
  suiteId: 'suite-baseline-v1',
  name: 'Canonical Harness Baseline Evaluation Suite v1',
  description:
    'Standard 7-scenario suite for model-agnostic evaluation of Vi-Harness agent runtime capabilities.',
  tasks: BASELINE_SCENARIOS,
};
