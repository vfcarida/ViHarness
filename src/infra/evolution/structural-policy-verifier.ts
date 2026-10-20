/**
 * Wave 8.3 — Formal Cross-Surface Policy Invariant & Deadlock Verifier
 * (`StructuralPolicyInvariantVerifier`).
 *
 * Statically verifies cross-surface satisfiability and absence of operational deadlocks/livelocks
 * across the declarative structural policies (`contextPolicy`, `routingPolicy`,
 * `verificationPolicy`, `toolSchedulingPolicy`, `guardrails`) and `budgetProfile` of a
 * `HarnessManifest`:
 *
 * - `INV-POL-01`: `contextPolicy.compactionTriggerRatio < contextPolicy.hardEvictionRatio`
 * - `INV-POL-02`: `verificationPolicy.requireTdd` implies `budgetProfile.maxIterationsPerProbe >= 4`
 * - `INV-POL-03`: `guardrails.requireVerificationEvidence` forbids `verificationPolicy.skipAllVerification === true`
 * - `INV-POL-04`: `toolSchedulingPolicy.deterministicSerialMode === true` implies `maxParallelTools === 1`
 * - `INV-POL-05`: `routingPolicy.architectMode === true` implies `budgetProfile.maxTokensPerProbe >= 4000`
 * - `INV-POL-06`: `securityProfile.allowFilesystemEscape === false && allowPrivilegeEscalation === false`
 *
 * Also provides deterministic `autoRepairManifest(manifest)` to resolve repairable cross-surface
 * contradictions before probing.
 */
import { createId } from '../../core/types/identifiers.js';
import { ComponentCapabilityClass } from '../../core/evolution/constitution.js';
import type {
  HarnessComponents,
  HarnessManifest,
} from '../../core/evolution/harness-manifest.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export interface StructuralPolicyViolation {
  readonly invariantId:
    | 'INV-POL-01'
    | 'INV-POL-02'
    | 'INV-POL-03'
    | 'INV-POL-04'
    | 'INV-POL-05'
    | 'INV-POL-06';
  readonly severity: 'CRITICAL_DEADLOCK' | 'POLICY_CONTRADICTION' | 'SECURITY_BREACH';
  readonly implicatedSurfaces: ReadonlyArray<string>;
  readonly counterexampleWitness: Readonly<Record<string, unknown>>;
  readonly message: string;
  readonly autoRepairable: boolean;
}

export interface StructuralPolicyVerificationReport {
  readonly manifestId: string;
  readonly satisfiable: boolean;
  readonly violations: ReadonlyArray<StructuralPolicyViolation>;
  readonly unsatCoreSurfaces: ReadonlyArray<string>;
}

export interface StructuralPolicyAutoRepairResult {
  readonly originalSatisfiable: boolean;
  readonly satisfiableAfterRepair: boolean;
  readonly repairedViolationIds: ReadonlyArray<string>;
  readonly repairedManifest: HarnessManifest;
  readonly verificationAfterRepair: StructuralPolicyVerificationReport;
}

function asRecord(
  val: string | Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return { ...val };
  }
  return {};
}

export class StructuralPolicyInvariantVerifier {
  /**
   * Evaluates all 6 formal cross-surface policy & budget satisfiability invariants.
   */
  verifyManifestPolicies(
    manifest: HarnessManifest,
  ): StructuralPolicyVerificationReport {
    const violations: StructuralPolicyViolation[] = [];
    const unsatSurfaces = new Set<string>();

    const contextCfg = asRecord(manifest.components.contextPolicy?.content);
    const routingCfg = asRecord(manifest.components.routingPolicy?.content);
    const verifyCfg = asRecord(manifest.components.verificationPolicy?.content);
    const schedCfg = asRecord(manifest.components.toolSchedulingPolicy?.content);
    const guardCfg = asRecord(manifest.components.guardrails.content);

    // INV-POL-01: Compaction threshold ordering
    const compactionRatio = Number(
      contextCfg['compactionTriggerRatio'] ??
        contextCfg['compactionThreshold'] ??
        0.75,
    );
    const evictionRatio = Number(
      contextCfg['hardEvictionRatio'] ??
        contextCfg['hardEvictionThreshold'] ??
        0.92,
    );
    if (compactionRatio >= evictionRatio || compactionRatio <= 0 || evictionRatio > 1) {
      violations.push({
        invariantId: 'INV-POL-01',
        severity: 'CRITICAL_DEADLOCK',
        implicatedSurfaces: ['contextPolicy'],
        counterexampleWitness: { compactionRatio, evictionRatio },
        message: `Context compaction trigger (${compactionRatio}) must be strictly less than hard eviction ratio (${evictionRatio}) within (0, 1].`,
        autoRepairable: true,
      });
      unsatSurfaces.add('contextPolicy');
    }

    // INV-POL-02: TDD Iteration Feasibility
    const requireTdd = Boolean(verifyCfg['requireTdd']);
    const tddRepeats = Math.max(1, Number(verifyCfg['tddKPassRepeats'] ?? 1));
    const minRequiredIters = requireTdd ? Math.max(4, 2 * tddRepeats + 2) : 1;
    if (
      requireTdd &&
      manifest.budgetProfile.maxIterationsPerProbe < minRequiredIters
    ) {
      violations.push({
        invariantId: 'INV-POL-02',
        severity: 'CRITICAL_DEADLOCK',
        implicatedSurfaces: ['verificationPolicy', 'budgetProfile'],
        counterexampleWitness: {
          requireTdd,
          tddRepeats,
          maxIterationsPerProbe: manifest.budgetProfile.maxIterationsPerProbe,
          minRequiredIters,
        },
        message: `TDD loop requires at least ${minRequiredIters} iterations (write test -> run fail -> implement -> run pass), but maxIterationsPerProbe=${manifest.budgetProfile.maxIterationsPerProbe}.`,
        autoRepairable: true,
      });
      unsatSurfaces.add('verificationPolicy');
      unsatSurfaces.add('budgetProfile');
    }

    // INV-POL-03: Guardrail vs Verification Policy Consistency
    const requireVerificationEvidence =
      guardCfg['requireVerificationEvidence'] !== false;
    const skipAllVerification =
      Boolean(verifyCfg['skipAllVerification']) ||
      (verifyCfg['autoTestAfterWrite'] === false &&
        verifyCfg['autoLintAfterWrite'] === false &&
        verifyCfg['requireTdd'] === false);
    if (requireVerificationEvidence && skipAllVerification) {
      violations.push({
        invariantId: 'INV-POL-03',
        severity: 'POLICY_CONTRADICTION',
        implicatedSurfaces: ['guardrails', 'verificationPolicy'],
        counterexampleWitness: {
          requireVerificationEvidence,
          skipAllVerification,
        },
        message: `Guardrails require verification evidence, but verificationPolicy disables all verification checks (guaranteed admission deadlock).`,
        autoRepairable: true,
      });
      unsatSurfaces.add('guardrails');
      unsatSurfaces.add('verificationPolicy');
    }

    // INV-POL-04: Deterministic Serial Mode vs Parallel Concurrency
    const serialMode = Boolean(schedCfg['deterministicSerialMode']);
    const maxParallel = Number(
      schedCfg['maxParallelTools'] ?? schedCfg['maxConcurrentTools'] ?? 4,
    );
    if ((serialMode && maxParallel > 1) || maxParallel < 1 || maxParallel > 16) {
      violations.push({
        invariantId: 'INV-POL-04',
        severity: 'POLICY_CONTRADICTION',
        implicatedSurfaces: ['toolSchedulingPolicy'],
        counterexampleWitness: {
          deterministicSerialMode: serialMode,
          maxParallelTools: maxParallel,
        },
        message: `Tool scheduling policy contradiction: deterministicSerialMode=${serialMode} with maxParallelTools=${maxParallel}.`,
        autoRepairable: true,
      });
      unsatSurfaces.add('toolSchedulingPolicy');
    }

    // INV-POL-05: Architect Mode Token Budget Feasibility
    const architectMode = Boolean(routingCfg['architectMode']);
    if (architectMode && manifest.budgetProfile.maxTokensPerProbe < 4000) {
      violations.push({
        invariantId: 'INV-POL-05',
        severity: 'CRITICAL_DEADLOCK',
        implicatedSurfaces: ['routingPolicy', 'budgetProfile'],
        counterexampleWitness: {
          architectMode,
          maxTokensPerProbe: manifest.budgetProfile.maxTokensPerProbe,
        },
        message: `Dual-model Architect+Editor routing requires >= 4000 maxTokensPerProbe, but budgetProfile allows only ${manifest.budgetProfile.maxTokensPerProbe}.`,
        autoRepairable: true,
      });
      unsatSurfaces.add('routingPolicy');
      unsatSurfaces.add('budgetProfile');
    }

    // INV-POL-06: Constitutional Zero-Trust Security Invariant
    if (
      manifest.securityProfile.allowFilesystemEscape ||
      manifest.securityProfile.allowPrivilegeEscalation
    ) {
      violations.push({
        invariantId: 'INV-POL-06',
        severity: 'SECURITY_BREACH',
        implicatedSurfaces: ['securityProfile'],
        counterexampleWitness: {
          allowFilesystemEscape: manifest.securityProfile.allowFilesystemEscape,
          allowPrivilegeEscalation:
            manifest.securityProfile.allowPrivilegeEscalation,
        },
        message: `Constitutional security breach: filesystem escape or privilege escalation enabled.`,
        autoRepairable: false,
      });
      unsatSurfaces.add('securityProfile');
    }

    return {
      manifestId: String(manifest.id),
      satisfiable: violations.length === 0,
      violations,
      unsatCoreSurfaces: Array.from(unsatSurfaces),
    };
  }

  /**
   * Deterministically repairs repairable cross-surface policy contradictions (`INV-POL-01`..`05`).
   */
  autoRepairManifest(
    manifest: HarnessManifest,
  ): StructuralPolicyAutoRepairResult {
    const initialReport = this.verifyManifestPolicies(manifest);
    if (initialReport.satisfiable) {
      return {
        originalSatisfiable: true,
        satisfiableAfterRepair: true,
        repairedViolationIds: [],
        repairedManifest: manifest,
        verificationAfterRepair: initialReport,
      };
    }

    const componentOverrides: Record<string, unknown> = {};
    let maxIterationsPerProbe = manifest.budgetProfile.maxIterationsPerProbe;
    let maxTokensPerProbe = manifest.budgetProfile.maxTokensPerProbe;
    const repairedViolationIds: string[] = [];

    for (const v of initialReport.violations) {
      if (!v.autoRepairable) continue;

      if (v.invariantId === 'INV-POL-01') {
        const current = asRecord(manifest.components.contextPolicy?.content);
        componentOverrides.contextPolicy =
          HarnessManifestToolkit.createComponentRef({
            id: `${manifest.components.contextPolicy?.id ?? 'comp-context'}-repaired`,
            surfaceId: 'contextPolicy',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              ...current,
              compactionTriggerRatio: 0.72,
              hardEvictionRatio: 0.92,
            },
          });
        repairedViolationIds.push(v.invariantId);
      }

      if (v.invariantId === 'INV-POL-02') {
        const verifyCfg = asRecord(
          manifest.components.verificationPolicy?.content,
        );
        const tddRepeats = Math.max(
          1,
          Number(verifyCfg['tddKPassRepeats'] ?? 1),
        );
        maxIterationsPerProbe = Math.max(
          maxIterationsPerProbe,
          2 * tddRepeats + 4,
        );
        repairedViolationIds.push(v.invariantId);
      }

      if (v.invariantId === 'INV-POL-03') {
        const current = asRecord(
          manifest.components.verificationPolicy?.content,
        );
        componentOverrides.verificationPolicy =
          HarnessManifestToolkit.createComponentRef({
            id: `${manifest.components.verificationPolicy?.id ?? 'comp-verify'}-repaired`,
            surfaceId: 'verificationPolicy',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              ...current,
              skipAllVerification: false,
              autoTestAfterWrite: true,
            },
          });
        repairedViolationIds.push(v.invariantId);
      }

      if (v.invariantId === 'INV-POL-04') {
        const current = asRecord(
          manifest.components.toolSchedulingPolicy?.content,
        );
        const serialMode = Boolean(current['deterministicSerialMode']);
        componentOverrides.toolSchedulingPolicy =
          HarnessManifestToolkit.createComponentRef({
            id: `${manifest.components.toolSchedulingPolicy?.id ?? 'comp-sched'}-repaired`,
            surfaceId: 'toolSchedulingPolicy',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              ...current,
              maxParallelTools: serialMode
                ? 1
                : Math.max(1, Math.min(8, Number(current['maxParallelTools'] ?? 4))),
            },
          });
        repairedViolationIds.push(v.invariantId);
      }

      if (v.invariantId === 'INV-POL-05') {
        maxTokensPerProbe = Math.max(maxTokensPerProbe, 8000);
        repairedViolationIds.push(v.invariantId);
      }
    }

    const cloned = HarnessManifestToolkit.clone(manifest, {
      newId: createId<'Harness'>(`${manifest.id}-smt-repaired`),
      createdBy: 'composer',
      componentOverrides: componentOverrides as Partial<HarnessComponents>,
      budgetOverride: {
        maxIterationsPerProbe,
        maxTokensPerProbe,
      },
    });

    const verificationAfterRepair = this.verifyManifestPolicies(cloned);
    return {
      originalSatisfiable: false,
      satisfiableAfterRepair: verificationAfterRepair.satisfiable,
      repairedViolationIds,
      repairedManifest: cloned,
      verificationAfterRepair,
    };
  }
}
