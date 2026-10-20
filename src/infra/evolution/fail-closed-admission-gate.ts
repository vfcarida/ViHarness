/**
 * Fail-Closed Harness Admission & Promotion Gate.
 *
 * Enforces an independent, fail-closed verification boundary separating:
 * - task-level adoption (`task_only`)
 * - experience library retention (`library_only`)
 * - canonical global baseline promotion (`promoted`)
 * - rejection / quarantine (`rejected` | `inconclusive` | `quarantined`)
 */
import * as crypto from 'node:crypto';
import { createId } from '../../core/types/identifiers.js';
import type { HarnessId } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import {
  ConstitutionValidator,
  DEFAULT_HARNESS_CONSTITUTION,
  EvidenceLevel,
  compareEvidenceLevels,
  getRequiredEvidenceLevel,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  HarnessManifest,
  HarnessManifestDiff,
} from '../../core/evolution/harness-manifest.js';
import type {
  EvidenceBundle,
  ProbeTrialMetrics,
} from '../../core/evolution/hypothesis.js';
import type {
  AdmissionDecision,
  AdmissionGateCriteria,
  AdmissionStatus,
  HarnessAdmissionGate,
  RetentionSuiteResult,
} from '../../core/evolution/interfaces.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import { RetentionSuiteRunner } from './retention-suite-runner.js';

export interface FailClosedAdmissionGateOptions {
  readonly initialBaseline?: HarnessManifest;
  readonly toolkit?: HarnessManifestToolkit;
  readonly constitution?: HarnessConstitution;
  readonly retentionRunner?: RetentionSuiteRunner;
  readonly hmacSecret?: string;
  readonly clock?: Clock;
}

const DEFAULT_CLOCK: Clock = {
  now: () => new Date(),
  timestamp: () => Date.now(),
};

function meanTrialScore(trials: ReadonlyArray<ProbeTrialMetrics>): number {
  if (trials.length === 0) return 0;
  return trials.reduce((sum, t) => sum + t.partialScore, 0) / trials.length;
}

function sumPolicyViolations(bundle?: EvidenceBundle): number {
  if (!bundle) return 0;
  return bundle.candidateTrials.reduce((sum, t) => sum + t.policyViolations, 0);
}

export class FailClosedAdmissionGate implements HarnessAdmissionGate {
  private readonly toolkit: HarnessManifestToolkit;
  private readonly constitution: HarnessConstitution;
  private readonly retentionRunner: RetentionSuiteRunner;
  private readonly hmacSecret: string;
  private readonly clock: Clock;
  private readonly baselineHistory: HarnessManifest[] = [];

  constructor(options: FailClosedAdmissionGateOptions = {}) {
    this.clock = options.clock ?? DEFAULT_CLOCK;
    this.constitution = options.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
    this.toolkit =
      options.toolkit ??
      new HarnessManifestToolkit({
        clock: this.clock,
        constitution: this.constitution,
        hmacSecret: options.hmacSecret,
      });
    this.retentionRunner = options.retentionRunner ?? new RetentionSuiteRunner();
    this.hmacSecret = options.hmacSecret ?? 'vi-harness-default-evolution-secret';

    const h0 = options.initialBaseline ?? this.toolkit.createCanonicalBaseline();
    this.baselineHistory.push(h0);
  }

  getCanonicalBaseline(): HarnessManifest {
    return this.baselineHistory[this.baselineHistory.length - 1]!;
  }

  getBaselineHistory(): ReadonlyArray<HarnessManifest> {
    return [...this.baselineHistory];
  }

  async evaluate(params: {
    readonly baseManifest: HarnessManifest;
    readonly candidateManifest: HarnessManifest;
    readonly diffFromBase: HarnessManifestDiff;
    readonly evolveEvidence: EvidenceBundle;
    readonly heldOutEvidence?: EvidenceBundle;
    readonly oodEvidence?: EvidenceBundle;
    readonly retentionResult?: RetentionSuiteResult;
    readonly criteria: AdmissionGateCriteria;
  }): Promise<AdmissionDecision> {
    const reasons: string[] = [];
    const decidedAt = this.clock.now().toISOString();

    try {
      // 1. Structural & schema validation
      const validation = this.toolkit.validate(params.candidateManifest);
      const structuralValidationPassed = validation.valid;
      if (!structuralValidationPassed) {
        reasons.push(...validation.errors);
      }

      // 2. Constitutional & privilege boundary validation
      const mutatedSurfaceIds = params.diffFromBase.changedSurfaces;
      const constCheck = ConstitutionValidator.validateProposedSurfaces(
        mutatedSurfaceIds,
        this.constitution,
      );
      const directiveCheck = ConstitutionValidator.validateDirectivePayload(
        JSON.stringify(params.candidateManifest.components),
      );
      const privilegeCheckPassed =
        params.candidateManifest.securityProfile.allowFilesystemEscape === false &&
        params.candidateManifest.securityProfile.allowPrivilegeEscalation === false &&
        directiveCheck.valid;

      const constitutionalCheckPassed = constCheck.valid && privilegeCheckPassed;
      if (!constCheck.valid) {
        reasons.push(...constCheck.violations);
      }
      if (!directiveCheck.valid) {
        reasons.push(...directiveCheck.violations);
      }
      if (!privilegeCheckPassed) {
        reasons.push(
          'Candidate violates privilege boundary (filesystem escape, privilege escalation, or constitutional bypass).',
        );
      }

      const totalPolicyViolations =
        sumPolicyViolations(params.evolveEvidence) +
        sumPolicyViolations(params.heldOutEvidence) +
        sumPolicyViolations(params.oodEvidence);

      if (
        !constitutionalCheckPassed ||
        (params.criteria.requireZeroSecurityViolations && totalPolicyViolations > 0)
      ) {
        if (totalPolicyViolations > 0) {
          reasons.push(
            `Candidate triggered ${totalPolicyViolations} security/policy violation(s) during probe execution.`,
          );
        }
        return this.signDecision({
          id: createId<'Admission'>(`adm_${Date.now()}`),
          candidateManifestId: params.candidateManifest.id,
          candidateManifestHash: params.candidateManifest.contentHash,
          baseManifestId: params.baseManifest.id,
          status: 'quarantined',
          evidenceLevelVerified: params.evolveEvidence.evidenceLevel,
          structuralValidationPassed,
          constitutionalCheckPassed,
          evolveSplitPassed: false,
          heldOutSplitPassed: false,
          oodSplitPassed: false,
          retentionResult: params.retentionResult,
          costRegressionPassed: false,
          latencyRegressionPassed: false,
          privilegeCheckPassed,
          reasons,
          decidedAt,
        });
      }

      // 3. Determine highest capability class touched and required evidence level
      const isGlobalPromotion = params.criteria.targetScope === 'global_promotion';
      const requiredEvidenceLevel = getRequiredEvidenceLevel(
        params.diffFromBase.highestRiskClassTouched,
        isGlobalPromotion,
      );

      let highestVerifiedLevel = params.evolveEvidence.evidenceLevel;
      if (params.heldOutEvidence) {
        const hoBase = meanTrialScore(params.heldOutEvidence.baseTrials);
        const hoCand = meanTrialScore(params.heldOutEvidence.candidateTrials);
        if (hoCand - hoBase >= params.criteria.minHeldOutPassDelta) {
          highestVerifiedLevel = EvidenceLevel.E4_GENERALIZATION;
        }
      }

      const evidenceLevelSatisfied =
        compareEvidenceLevels(highestVerifiedLevel, requiredEvidenceLevel) >= 0;
      if (!evidenceLevelSatisfied) {
        reasons.push(
          `Insufficient evidence level: verified ${highestVerifiedLevel}, required ${requiredEvidenceLevel} for capability class ${params.diffFromBase.highestRiskClassTouched}.`,
        );
      }

      // 4. Evolve split evaluation
      const evBaseScore = meanTrialScore(params.evolveEvidence.baseTrials);
      const evCandScore = meanTrialScore(params.evolveEvidence.candidateTrials);
      const evolveSplitPassed =
        params.evolveEvidence.candidateTrials.length > 0 &&
        evCandScore >= evBaseScore;
      if (!evolveSplitPassed) {
        reasons.push(
          `Evolve split check failed: candidate score (${evCandScore.toFixed(2)}) vs baseline (${evBaseScore.toFixed(2)}).`,
        );
      }

      // 5. Cost & latency regression checks
      const baseTrials = params.evolveEvidence.baseTrials;
      const candTrials = params.evolveEvidence.candidateTrials;
      const baseCost =
        baseTrials.reduce((s, r) => s + r.costDollars, 0) / Math.max(1, baseTrials.length);
      const candCost =
        candTrials.reduce((s, r) => s + r.costDollars, 0) / Math.max(1, candTrials.length);
      const costRatio = baseCost > 0 ? (candCost - baseCost) / baseCost : 0;
      const costRegressionPassed = costRatio <= params.criteria.maxCostRegressionRatio;
      if (!costRegressionPassed) {
        reasons.push(
          `Cost regression ratio ${(costRatio * 100).toFixed(1)}% exceeds maximum allowed ${(params.criteria.maxCostRegressionRatio * 100).toFixed(1)}%.`,
        );
      }

      const baseLatency =
        baseTrials.reduce((s, r) => s + r.durationMs, 0) / Math.max(1, baseTrials.length);
      const candLatency =
        candTrials.reduce((s, r) => s + r.durationMs, 0) / Math.max(1, candTrials.length);
      const latencyRatio =
        baseLatency > 0 ? (candLatency - baseLatency) / baseLatency : 0;
      const latencyRegressionPassed =
        latencyRatio <= params.criteria.maxLatencyRegressionRatio;
      if (!latencyRegressionPassed) {
        reasons.push(
          `Latency regression ratio ${(latencyRatio * 100).toFixed(1)}% exceeds maximum allowed ${(params.criteria.maxLatencyRegressionRatio * 100).toFixed(1)}%.`,
        );
      }

      // 6. Retention suite check
      const retentionResult =
        params.retentionResult ??
        (await this.retentionRunner.runSuite({
          baseManifest: params.baseManifest,
          candidateManifest: params.candidateManifest,
          diff: params.diffFromBase,
        }));
      const retentionPassed = params.criteria.requireZeroForgottenCapabilities
        ? retentionResult.forgottenCount === 0
        : true;
      if (!retentionPassed) {
        reasons.push(
          `Retention suite detected ${retentionResult.forgottenCount} forgotten capability(ies) (harness-induced forgetting).`,
        );
      }

      // 7. Held-out and OOD evaluation checks
      let heldOutSplitPassed = false;
      if (params.heldOutEvidence) {
        const delta =
          meanTrialScore(params.heldOutEvidence.candidateTrials) -
          meanTrialScore(params.heldOutEvidence.baseTrials);
        heldOutSplitPassed =
          params.heldOutEvidence.candidateTrials.length > 0 &&
          delta >= params.criteria.minHeldOutPassDelta;
        if (!heldOutSplitPassed) {
          reasons.push(
            `Held-out split delta (${delta.toFixed(3)}) is below minimum required (${params.criteria.minHeldOutPassDelta.toFixed(3)}).`,
          );
        }
      } else if (isGlobalPromotion) {
        reasons.push(
          'Global promotion requires held-out evaluation evidence (fail-closed when heldOutEvidence is missing).',
        );
      } else {
        heldOutSplitPassed = true;
      }

      let oodSplitPassed = true;
      if (params.oodEvidence) {
        oodSplitPassed =
          meanTrialScore(params.oodEvidence.candidateTrials) >=
          meanTrialScore(params.oodEvidence.baseTrials) - 0.05;
        if (!oodSplitPassed) {
          reasons.push('OOD transfer evaluation showed significant regression (> 5%).');
        }
      }

      // 8. Determine final AdmissionStatus
      let status: AdmissionStatus;
      if (!structuralValidationPassed || !evolveSplitPassed || !retentionPassed) {
        status = 'rejected';
      } else if (!costRegressionPassed || !latencyRegressionPassed || !oodSplitPassed) {
        status = 'rejected';
      } else if (isGlobalPromotion) {
        if (heldOutSplitPassed && evidenceLevelSatisfied) {
          status = 'promoted';
        } else if (!params.heldOutEvidence) {
          status = 'library_only';
        } else {
          status = 'rejected';
        }
      } else if (params.criteria.targetScope === 'library') {
        status = evidenceLevelSatisfied ? 'library_only' : 'task_only';
      } else {
        status = evidenceLevelSatisfied ? 'task_only' : 'inconclusive';
      }

      if (status === 'promoted') {
        reasons.push(
          `Candidate ${params.candidateManifest.id} passed all structural, constitutional, evolve, held-out, retention, and cost/latency gates for global promotion.`,
        );
      }

      return this.signDecision({
        id: createId<'Admission'>(`adm_${Date.now()}`),
        candidateManifestId: params.candidateManifest.id,
        candidateManifestHash: params.candidateManifest.contentHash,
        baseManifestId: params.baseManifest.id,
        status,
        evidenceLevelVerified: highestVerifiedLevel,
        structuralValidationPassed,
        constitutionalCheckPassed,
        evolveSplitPassed,
        heldOutSplitPassed,
        oodSplitPassed,
        retentionResult,
        costRegressionPassed,
        latencyRegressionPassed,
        privilegeCheckPassed,
        reasons,
        decidedAt,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return this.signDecision({
        id: createId<'Admission'>(`adm_err_${Date.now()}`),
        candidateManifestId: params.candidateManifest.id,
        candidateManifestHash: params.candidateManifest.contentHash,
        baseManifestId: params.baseManifest.id,
        status: 'inconclusive',
        evidenceLevelVerified: EvidenceLevel.E0_REFLECTION,
        structuralValidationPassed: false,
        constitutionalCheckPassed: false,
        evolveSplitPassed: false,
        heldOutSplitPassed: false,
        oodSplitPassed: false,
        costRegressionPassed: false,
        latencyRegressionPassed: false,
        privilegeCheckPassed: false,
        reasons: [`Fail-closed evaluation error: ${errMsg}`],
        decidedAt,
      });
    }
  }

  async promoteToCanonicalBaseline(
    candidateManifest: HarnessManifest,
    decision: AdmissionDecision,
  ): Promise<HarnessManifest> {
    if (
      decision.status !== 'promoted' ||
      decision.candidateManifestId !== candidateManifest.id ||
      decision.candidateManifestHash !== candidateManifest.contentHash
    ) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_ADMISSION_DENIED,
        category: ErrorCategory.EVOLUTION,
        message: `Cannot promote candidate ${candidateManifest.id}: admission decision status is '${decision.status}' (reasons: ${decision.reasons.join('; ')})`,
      });
    }

    if (!this.verifyDecisionSignature(decision)) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_ADMISSION_DENIED,
        category: ErrorCategory.EVOLUTION,
        message: `AdmissionDecision signature verification failed for ${decision.id}.`,
      });
    }

    const signedManifest = this.toolkit.signManifest({
      ...candidateManifest,
      evidence: {
        ...candidateManifest.evidence,
        highestLevelAchieved: decision.evidenceLevelVerified,
        retentionStatus: decision.retentionResult?.passed ? 'PASS' : 'FAIL',
      },
    });

    this.baselineHistory.push(signedManifest);
    return signedManifest;
  }

  async rollbackBaseline(targetManifestId?: HarnessId): Promise<HarnessManifest> {
    if (this.baselineHistory.length <= 1) {
      return this.baselineHistory[0]!;
    }

    if (!targetManifestId) {
      this.baselineHistory.pop();
      return this.getCanonicalBaseline();
    }

    const targetIndex = this.baselineHistory.findIndex((m) => m.id === targetManifestId);
    if (targetIndex === -1) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: `Rollback target manifest '${targetManifestId}' not found in canonical baseline history.`,
      });
    }

    this.baselineHistory.splice(targetIndex + 1);
    return this.getCanonicalBaseline();
  }

  verifyDecisionSignature(decision: AdmissionDecision): boolean {
    if (!decision.signature) return false;
    const expected = this.computeDecisionHmac(decision);
    return expected === decision.signature;
  }

  private signDecision(unsigned: Omit<AdmissionDecision, 'signature'>): AdmissionDecision {
    const signature = this.computeDecisionHmac(unsigned);
    return Object.freeze({
      ...unsigned,
      signature,
    });
  }

  private computeDecisionHmac(
    decision: Omit<AdmissionDecision, 'signature'>,
  ): string {
    const payload = JSON.stringify({
      id: decision.id,
      candidateManifestId: decision.candidateManifestId,
      candidateManifestHash: decision.candidateManifestHash,
      baseManifestId: decision.baseManifestId,
      status: decision.status,
      evidenceLevelVerified: decision.evidenceLevelVerified,
      decidedAt: decision.decidedAt,
    });
    return crypto.createHmac('sha256', this.hmacSecret).update(payload).digest('hex');
  }
}
