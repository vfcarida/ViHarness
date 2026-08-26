/**
 * Context Trajectory Generator for Context Efficiency Benchmark.
 *
 * Generates deterministic synthetic long-horizon coding trajectories (10, 25, 50, 100 iterations)
 * with adversarial injections:
 * - Repeated tool outputs
 * - Irrelevant logs
 * - Stale hypotheses
 * - Important decisions / Critical memory items
 * - Contradictory observations
 * - Large file reads
 */
import type {
  TrajectoryStep,
  CriticalMemoryItem,
} from '../../core/model/context-benchmark-types.js';

export class ContextTrajectoryGenerator {
  /**
   * Predefined Canonical Critical Memory Items.
   */
  static readonly CANONICAL_CRITICAL_ITEMS: ReadonlyArray<CriticalMemoryItem> = [
    {
      id: 'CM-001',
      factKey: 'DB_PORT_SCHEMA',
      content:
        'Architecture Invariant: PostgreSQL port 5432 with schema version v4.2 and strict foreign keys.',
      description: 'Database connection configuration and schema version invariant',
      injectedIteration: 2,
      expectedPattern: 'PostgreSQL port 5432',
    },
    {
      id: 'CM-002',
      factKey: 'SECURITY_TOKEN_LOGGING',
      content:
        'Security Invariant: Never log Bearer auth tokens or HMAC secret keys in telemetry pipelines.',
      description: 'Security policy forbidding credential exposure in telemetry',
      injectedIteration: 5,
      expectedPattern: 'Never log Bearer auth tokens',
    },
    {
      id: 'CM-003',
      factKey: 'TAX_EXEMPTION_ORDER',
      content:
        'Business Rule: Tax calculation must apply exempt status before discount tier evaluation.',
      description: 'Billing computation ordering invariant',
      injectedIteration: 15,
      expectedPattern: 'exempt status before discount tier',
    },
    {
      id: 'CM-004',
      factKey: 'API_IDEMPOTENCY_HEADER',
      content:
        'API Contract: PaymentWebhook v2 payload requires X-Idempotency-Key header on all retries.',
      description: 'Webhook idempotency requirement',
      injectedIteration: 30,
      expectedPattern: 'X-Idempotency-Key',
    },
    {
      id: 'CM-005',
      factKey: 'TENANT_ISOLATION_RULE',
      content:
        'Database Isolation: Multi-tenant tenant_id column required on all foreign key references and composite indexes.',
      description: 'Multi-tenant database data isolation invariant',
      injectedIteration: 65,
      expectedPattern: 'tenant_id column required',
    },
  ];

  /**
   * Generate an identical, deterministic trajectory for a given horizon.
   */
  static generateTrajectory(horizon: number): ReadonlyArray<TrajectoryStep> {
    const steps: TrajectoryStep[] = [];
    let stepIndex = 0;

    for (let iter = 1; iter <= horizon; iter++) {
      const iterSteps = this.generateIterationSteps(iter, horizon, stepIndex);
      for (const step of iterSteps) {
        steps.push(step);
        stepIndex++;
      }
    }

    return steps;
  }

  /**
   * Retrieve all critical memory items injected up to a given iteration.
   */
  static getInjectedCriticalItems(maxIteration: number): ReadonlyArray<CriticalMemoryItem> {
    return this.CANONICAL_CRITICAL_ITEMS.filter((item) => item.injectedIteration <= maxIteration);
  }

  private static generateIterationSteps(
    iter: number,
    totalHorizon: number,
    startingStepIndex: number,
  ): TrajectoryStep[] {
    const steps: TrajectoryStep[] = [];
    let currentStepIndex = startingStepIndex;

    // Check for Critical Memory injection at this iteration
    const criticalItem = this.CANONICAL_CRITICAL_ITEMS.find((c) => c.injectedIteration === iter);

    if (criticalItem) {
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'user',
        category: 'CRITICAL_MEMORY',
        content: `IMPORTANT ARCHITECTURE DECISION [${criticalItem.factKey}]: ${criticalItem.content}`,
        rawTokens: Math.ceil(criticalItem.content.length / 4) + 20,
        criticalItem,
      });
    }

    // 1. Stale Hypothesis Injection
    if (iter === 3 || iter === 12 || iter === 28 || iter === 55) {
      const staleContent = `Hypothesis #${iter}: Suspected concurrency race condition in Redis cache TTL invalidation during batch update. (Later disproven by logs - disregard)`;
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'assistant',
        category: 'STALE_HYPOTHESIS',
        content: staleContent,
        rawTokens: Math.ceil(staleContent.length / 4) + 15,
      });
    }

    // 2. Large File Read Injection
    if (iter === 4 || iter === 18 || iter === 40 || iter === 75) {
      const largeFileContent = this.generateLargeFileContent(iter);
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'assistant',
        category: 'LARGE_FILE',
        content: `Reading file src/domain/schema_${iter}.ts to inspect type definitions`,
        toolName: 'read_file',
        toolInput: { path: `src/domain/schema_${iter}.ts` },
        toolOutput: largeFileContent,
        rawTokens: Math.ceil(largeFileContent.length / 4) + 50,
      });
    }

    // 3. Repeated Tool Output (e.g. repetitive compiler warnings)
    if (iter % 4 === 0) {
      const repeatedWarning = this.getRepeatedCompilerWarnings();
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'tool',
        category: 'REPEATED_TOOL_OUTPUT',
        content: repeatedWarning,
        toolName: 'run_command',
        toolInput: { command: 'npm run lint' },
        toolOutput: repeatedWarning,
        rawTokens: Math.ceil(repeatedWarning.length / 4) + 30,
      });
    }

    // 4. Irrelevant Logs Injection (e.g. verbose build/test traces)
    if (iter % 6 === 0) {
      const noisyLogs = this.generateNoisyLogs(iter);
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'tool',
        category: 'IRRELEVANT_LOGS',
        content: noisyLogs,
        toolName: 'run_command',
        toolInput: { command: 'npm test -- --verbose' },
        toolOutput: noisyLogs,
        rawTokens: Math.ceil(noisyLogs.length / 4) + 40,
      });
    }

    // 5. Contradictory Observation
    if (iter === 8 || iter === 22 || iter === 45 || iter === 80) {
      const flakyError = `[ERROR 503] Transient network timeout on localhost:8080 during warm-up phase (Attempt 1 failed).`;
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'tool',
        category: 'CONTRADICTORY_OBSERVATION',
        content: flakyError,
        toolName: 'run_command',
        toolInput: { command: 'curl -I http://localhost:8080/health' },
        toolOutput: flakyError,
        rawTokens: Math.ceil(flakyError.length / 4) + 20,
      });

      const retryPass = `[SUCCESS 200 OK] Health check passed on retry (Attempt 2 succeeded after connection pool ready).`;
      steps.push({
        stepIndex: currentStepIndex++,
        iteration: iter,
        role: 'tool',
        category: 'REGULAR_STEP',
        content: retryPass,
        toolName: 'run_command',
        toolInput: { command: 'curl -I http://localhost:8080/health' },
        toolOutput: retryPass,
        rawTokens: Math.ceil(retryPass.length / 4) + 20,
      });
    }

    // 6. Regular Iteration Execution Step
    const regularContent = `Iteration ${iter}/${totalHorizon}: Analyzing function calculateTotal() in src/services/pricing.ts, implementing boundary checks for null discounts.`;
    steps.push({
      stepIndex: currentStepIndex++,
      iteration: iter,
      role: 'assistant',
      category: 'REGULAR_STEP',
      content: regularContent,
      toolName: 'write_file',
      toolInput: {
        path: 'src/services/pricing.ts',
        content: `export function calculateTotal(base: number, discount?: number): number { return base - (discount ?? 0); }`,
      },
      toolOutput: 'File written successfully: 85 bytes.',
      rawTokens: Math.ceil(regularContent.length / 4) + 80,
    });

    return steps;
  }

  private static generateLargeFileContent(iter: number): string {
    const lines: string[] = [
      `// Auto-generated Enterprise Schema Definition - Iteration ${iter}`,
      `export interface EnterpriseModelV${iter} {`,
      `  id: string;`,
      `  tenantId: string;`,
      `  createdAt: Date;`,
      `  updatedAt: Date;`,
      `  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';`,
    ];

    for (let i = 1; i <= 60; i++) {
      lines.push(`  attributeField_${i}: string; // Data field ${i} with metadata descriptions`);
      lines.push(`  metricValue_${i}: number; // Computed aggregate metric ${i}`);
      lines.push(`  flagEnabled_${i}: boolean; // Feature flag toggle state ${i}`);
    }
    lines.push('}');
    return lines.join('\n');
  }

  private static getRepeatedCompilerWarnings(): string {
    return [
      `[Linter Warning] src/legacy/util.ts:14:3 - 'unusedVar' is declared but its value is never read.`,
      `[Linter Warning] src/legacy/util.ts:28:5 - Use 'const' instead of 'let' for variable never reassigned.`,
      `[Linter Warning] src/services/auth.ts:92:12 - Missing explicit return type on public method.`,
      `[Linter Warning] src/services/auth.ts:104:1 - File has trailing whitespace.`,
      `[Linter Warning] src/config/index.ts:5:2 - Import order is not alphabetical.`,
      `[Linter Summary] Found 5 warnings across 3 files. (0 errors).`,
    ].join('\n');
  }

  private static generateNoisyLogs(iter: number): string {
    const logLines: string[] = [
      `[INFO 2026-08-13T16:00:00.00${iter}Z] Initializing test runner context for suite-${iter}...`,
      `[DEBUG 2026-08-13T16:00:00.01${iter}Z] Connecting to memory mock database at localhost:6379`,
      `[DEBUG 2026-08-13T16:00:00.02${iter}Z] Connection established (latency 0.8ms)`,
    ];

    for (let i = 1; i <= 40; i++) {
      logLines.push(
        `[TRACE 2026-08-13T16:00:00.${100 + i}Z] Executing test case ${i}: test_item_${i}_validation... PASS`,
      );
      logLines.push(
        `[DEBUG 2026-08-13T16:00:00.${100 + i}Z] Memory usage: ${24.5 + (i % 5) * 0.4}MB, Event loop lag: 0.12ms`,
      );
    }

    logLines.push(
      `[INFO 2026-08-13T16:00:01.000Z] Test suite completed: 40 passed, 0 failed, 0 skipped.`,
    );
    return logLines.join('\n');
  }
}
