import { describe, it, expect } from 'vitest';
import { DefaultVerificationEngine } from '../../src/infra/verification/default-verification-engine.js';
import { AcceptanceEvaluator } from '../../src/infra/verification/acceptance-evaluator.js';
import { DefaultEvidenceStore } from '../../src/infra/evidence/default-evidence-store.js';
import { UuidV7IdFactory } from '../../src/infra/id/uuid-id-factory.js';
import { SystemClock } from '../../src/infra/time/system-clock.js';
import { VerificationProfile, VerificationStatus, EvidenceOutcome } from '../../src/core/index.js';
import type { AcceptancePolicy } from '../../src/core/index.js';

describe('Real Verification Pipeline Integration Suite (No Mocks)', () => {
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();
  const evidenceStore = new DefaultEvidenceStore();

  function createEngine() {
    return new DefaultVerificationEngine({
      evidenceStore,
      idFactory,
      clock,
      workingDirectory: process.cwd(),
    });
  }

  it('1. Empirical Command Execution: Executes real process and produces PASSED result with artifacts', async () => {
    const engine = createEngine();
    const result = await engine.verify({
      type: 'unit-test',
      content: 'node -e "console.log(\'empirical verification stdout\'); process.exit(0);"',
    });

    expect(result.status).toBe(VerificationStatus.PASSED);
    expect(result.checkExecutions).toHaveLength(1);

    const exec = result.checkExecutions![0]!;
    expect(exec.exitCode).toBe(0);
    expect(exec.stdoutArtifact).toContain('empirical verification stdout');
    expect(exec.durationMs).toBeGreaterThan(0);
    expect(exec.status).toBe(VerificationStatus.PASSED);
  });

  it('2. Failing Execution: Executes real failing command and produces FAILED result with stderr artifact', async () => {
    const engine = createEngine();
    const result = await engine.verify({
      type: 'unit-test',
      content: 'node -e "console.error(\'fatal verifier error\'); process.exit(1);"',
    });

    expect(result.status).toBe(VerificationStatus.FAILED);
    const exec = result.checkExecutions![0]!;
    expect(exec.exitCode).toBe(1);
    expect(exec.stderrArtifact).toContain('fatal verifier error');
    expect(exec.status).toBe(VerificationStatus.FAILED);
  });

  it('3. Real FAST Verification Profile: Executes TypeScript compilation check', async () => {
    const engine = createEngine();
    const result = await engine.verify({}, VerificationProfile.FAST);

    expect(result.status).toBe(VerificationStatus.PASSED);
    expect(result.checkExecutions).toHaveLength(1);
    expect(result.checkExecutions![0]?.command).toBeDefined();
    expect(result.checkExecutions![0]?.status).toBe(VerificationStatus.PASSED);
  });

  it('4. Real Regression Detection: Detects when a previously passing check now fails', async () => {
    const engine = createEngine();
    const taskId = idFactory.create<'Task'>();

    // Baseline: passing check
    const baselineEvidence = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: 'VERIFICATION' as any,
        outcome: EvidenceOutcome.PASS,
        summary: 'Check passed in baseline',
        data: {},
        createdAt: new Date(),
        pass: true,
        checkId: 'check-unit-tests',
        confidence: 0.95,
        affectedFiles: ['src/index.ts'],
      },
    ];

    // Candidate: failing check
    const candidateEvidence = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: 'VERIFICATION' as any,
        outcome: EvidenceOutcome.FAIL,
        summary: 'Check failed in candidate',
        data: {},
        createdAt: new Date(),
        pass: false,
        checkId: 'check-unit-tests',
        confidence: 0.2,
        affectedFiles: ['src/index.ts'],
      },
    ];

    const regressions = engine.detectRegressions(baselineEvidence, candidateEvidence, taskId);

    expect(regressions).toHaveLength(1);
    expect(regressions[0]?.description).toContain(
      'Regression detected in check [check-unit-tests]',
    );
  });

  it('5. Acceptance Policy Evaluation: Gated DONE state requires zero regressions and required checks', () => {
    const taskId = idFactory.create<'Task'>();
    const policy: AcceptancePolicy = {
      requiredChecks: ['check-typecheck', 'check-unit-tests'],
      zeroRegressionsRequired: true,
      minConfidence: 0.8,
    };

    const evidence = [
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: 'VERIFICATION' as any,
        outcome: EvidenceOutcome.PASS,
        summary: 'Typecheck passed',
        data: { checkId: 'check-typecheck' },
        createdAt: new Date(),
        pass: true,
        checkId: 'check-typecheck',
        confidence: 0.95,
        affectedFiles: [],
      },
      {
        id: idFactory.create<'Evidence'>(),
        taskId,
        type: 'VERIFICATION' as any,
        outcome: EvidenceOutcome.PASS,
        summary: 'Unit tests passed',
        data: { checkId: 'check-unit-tests' },
        createdAt: new Date(),
        pass: true,
        checkId: 'check-unit-tests',
        confidence: 0.95,
        affectedFiles: [],
      },
    ];

    const evaluation = AcceptanceEvaluator.evaluate({ policy, evidence });

    expect(evaluation.satisfied).toBe(true);
    expect(evaluation.missingRequirements).toHaveLength(0);
  });
});
