import { describe, it, expect } from 'vitest';
import { AcceptanceEvaluator } from '../../../src/infra/verification/acceptance-evaluator.js';
import { ContradictoryEvidenceResolver } from '../../../src/infra/evidence/contradictory-evidence-resolver.js';
import { EvidenceCache } from '../../../src/infra/optimization/evidence-cache.js';
import { EvidenceType, EvidenceOutcome } from '../../../src/core/model/evidence.js';
import type { Evidence } from '../../../src/core/model/evidence.js';
import type { AcceptancePolicy } from '../../../src/core/model/acceptance-policy.js';
import { PolicyDecisionType } from '../../../src/core/model/policy.js';
import type { PolicyDecision } from '../../../src/core/model/policy.js';
import type { Regression } from '../../../src/core/model/regression.js';
import type { EvidenceId, TaskId } from '../../../src/core/types/identifiers.js';

describe('Verification & Acceptance Evaluation Unit Suite', () => {
  const taskId = 'task-1' as TaskId;

  function createEvidence(overrides: Partial<Evidence> = {}): Evidence {
    return {
      id: 'ev-1' as EvidenceId,
      taskId,
      type: EvidenceType.TEST_RESULT,
      outcome: EvidenceOutcome.PASS,
      summary: 'Unit tests passed',
      data: {},
      createdAt: new Date(),
      pass: true,
      checkId: 'check-unit-tests',
      confidence: 0.95,
      affectedFiles: ['src/app.ts'],
      ...overrides,
    };
  }

  describe('AcceptanceEvaluator', () => {
    const basePolicy: AcceptancePolicy = {
      requiredChecks: ['check-unit-tests'],
      zeroRegressionsRequired: true,
      minConfidence: 0.8,
      allowWarnings: true,
    };

    it('1. Satisfied evaluation when all required checks pass and no regressions exist', () => {
      const evidence = [createEvidence({ checkId: 'check-unit-tests', pass: true })];
      const evaluation = AcceptanceEvaluator.evaluate({
        policy: basePolicy,
        evidence,
      });

      expect(evaluation.satisfied).toBe(true);
      expect(evaluation.missingRequirements).toHaveLength(0);
    });

    it('2. Blocks completion if required checks are missing or failing', () => {
      const failingEvidence = [
        createEvidence({ checkId: 'check-unit-tests', pass: false, outcome: EvidenceOutcome.FAIL }),
      ];
      const evaluation = AcceptanceEvaluator.evaluate({
        policy: basePolicy,
        evidence: failingEvidence,
      });

      expect(evaluation.satisfied).toBe(false);
      expect(
        evaluation.missingRequirements.some((r) => r.includes('Required check [check-unit-tests]')),
      ).toBe(true);
    });

    it('3. Blocks completion if regressions are detected', () => {
      const evidence = [
        createEvidence({ id: 'ev-pass' as EvidenceId, checkId: 'check-unit-tests', pass: true }),
        createEvidence({
          id: 'ev-reg' as EvidenceId,
          checkId: 'check-billing',
          pass: false,
          outcome: EvidenceOutcome.FAIL,
        }),
      ];

      const regressions: Regression[] = [
        {
          checkId: 'check-billing',
          baselineEvidenceId: 'ev-base' as EvidenceId,
          currentFailEvidenceId: 'ev-reg' as EvidenceId,
          detectedAt: new Date(),
          description: 'Billing suite regression',
        },
      ];

      const evaluation = AcceptanceEvaluator.evaluate({
        policy: basePolicy,
        evidence,
        regressions,
      });

      expect(evaluation.satisfied).toBe(false);
      expect(
        evaluation.missingRequirements.some((r) => r.includes('Zero regressions required')),
      ).toBe(true);
      expect(evaluation.regressionsDetected).toHaveLength(1);
    });

    it('4. Blocks completion if unresolved policy violations exist', () => {
      const evidence = [createEvidence({ checkId: 'check-unit-tests', pass: true })];
      const policyDecisions: PolicyDecision[] = [
        {
          decision: PolicyDecisionType.DENY,
          reason: 'Access to /etc/shadow is denied',
          evaluatedAt: new Date(),
        },
      ];

      const evaluation = AcceptanceEvaluator.evaluate({
        policy: basePolicy,
        evidence,
        policyDecisions,
      });

      expect(evaluation.satisfied).toBe(false);
      expect(
        evaluation.missingRequirements.some((r) => r.includes('unresolved policy violation')),
      ).toBe(true);
    });

    it('5. Blocks completion if confidence falls below minConfidence', () => {
      const lowConfidenceEvidence = [
        createEvidence({ checkId: 'check-unit-tests', pass: true, confidence: 0.5 }),
      ];

      const evaluation = AcceptanceEvaluator.evaluate({
        policy: { ...basePolicy, minConfidence: 0.9 },
        evidence: lowConfidenceEvidence,
      });

      expect(evaluation.satisfied).toBe(false);
      expect(evaluation.missingRequirements.some((r) => r.includes('Evidence confidence'))).toBe(
        true,
      );
    });
  });

  describe('ContradictoryEvidenceResolver', () => {
    it('6. Detects contradiction when functional tests pass but linter or static verification fails', () => {
      const evidenceList: Evidence[] = [
        createEvidence({
          id: 'e1' as EvidenceId,
          type: EvidenceType.TEST_RESULT,
          outcome: EvidenceOutcome.PASS,
          pass: true,
        }),
        createEvidence({
          id: 'e2' as EvidenceId,
          type: EvidenceType.LINT_RESULT,
          outcome: EvidenceOutcome.FAIL,
          pass: false,
        }),
      ];

      const resolution = ContradictoryEvidenceResolver.evaluate(evidenceList);
      expect(resolution.hasContradiction).toBe(true);
      expect(resolution.requiresEscalation).toBe(true);
      expect(resolution.conflictingEvidence).toHaveLength(2);
    });

    it('7. Detects contradiction when same checkId reports both PASS and FAIL', () => {
      const evidenceList: Evidence[] = [
        createEvidence({
          id: 'e1' as EvidenceId,
          checkId: 'suite-core',
          outcome: EvidenceOutcome.PASS,
          pass: true,
        }),
        createEvidence({
          id: 'e2' as EvidenceId,
          checkId: 'suite-core',
          outcome: EvidenceOutcome.FAIL,
          pass: false,
        }),
      ];

      const resolution = ContradictoryEvidenceResolver.evaluate(evidenceList);
      expect(resolution.hasContradiction).toBe(true);
      expect(resolution.requiresEscalation).toBe(true);
      expect(resolution.rationale).toContain('suite-core');
    });

    it('8. Returns no contradiction for consistent evidence', () => {
      const evidenceList: Evidence[] = [
        createEvidence({
          id: 'e1' as EvidenceId,
          checkId: 'suite-1',
          outcome: EvidenceOutcome.PASS,
          pass: true,
        }),
        createEvidence({
          id: 'e2' as EvidenceId,
          checkId: 'suite-2',
          outcome: EvidenceOutcome.PASS,
          pass: true,
        }),
      ];

      const resolution = ContradictoryEvidenceResolver.evaluate(evidenceList);
      expect(resolution.hasContradiction).toBe(false);
      expect(resolution.requiresEscalation).toBe(false);
    });
  });

  describe('EvidenceCache', () => {
    it('9. Caches evidence and returns hit when file hashes match; returns null on modification or clear', () => {
      const cache = new EvidenceCache();
      const ev = createEvidence({ checkId: 'test-hash' });

      cache.put('test-hash', ev, { 'src/index.ts': 'hash-aaa' });

      // Cache hit
      const hit = cache.get('test-hash', { 'src/index.ts': 'hash-aaa' });
      expect(hit).toBeDefined();
      expect(hit?.id).toBe(ev.id);

      // Cache miss on modified hash
      const missModified = cache.get('test-hash', { 'src/index.ts': 'hash-bbb' });
      expect(missModified).toBeNull();

      // Cache miss on unknown check
      const missUnknown = cache.get('unknown-check', { 'src/index.ts': 'hash-aaa' });
      expect(missUnknown).toBeNull();

      // Cache clear
      cache.clear();
      expect(cache.get('test-hash', { 'src/index.ts': 'hash-aaa' })).toBeNull();
    });
  });
});
