/**
 * Immutable Harness Constitution & Capability Class Hierarchy (ADR-014).
 *
 * Defines the constitutional security boundary governing recursive self-evolution:
 * - Four capability classes: GUIDANCE, DECLARATIVE, EXECUTABLE, CONSTITUTIONAL
 * - Five evidence levels: E0_REFLECTION .. E4_GENERALIZATION
 * - Prohibits the optimizer from weakening policy enforcement, audit signing,
 *   sandbox confinement, rollback semantics, test protection, or admission gates.
 */
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export enum ComponentCapabilityClass {
  GUIDANCE = 'GUIDANCE',
  DECLARATIVE = 'DECLARATIVE',
  EXECUTABLE = 'EXECUTABLE',
  CONSTITUTIONAL = 'CONSTITUTIONAL',
}

export enum EvidenceLevel {
  E0_REFLECTION = 'E0_REFLECTION',
  E1_SINGLE_CONTRAST = 'E1_SINGLE_CONTRAST',
  E2_REPLICATED_CONTRAST = 'E2_REPLICATED_CONTRAST',
  E3_VERIFIED = 'E3_VERIFIED',
  E4_GENERALIZATION = 'E4_GENERALIZATION',
}

export const EVIDENCE_LEVEL_RANK: Readonly<Record<EvidenceLevel, number>> = {
  [EvidenceLevel.E0_REFLECTION]: 0,
  [EvidenceLevel.E1_SINGLE_CONTRAST]: 1,
  [EvidenceLevel.E2_REPLICATED_CONTRAST]: 2,
  [EvidenceLevel.E3_VERIFIED]: 3,
  [EvidenceLevel.E4_GENERALIZATION]: 4,
};

export const CAPABILITY_CLASS_RISK_RANK: Readonly<Record<ComponentCapabilityClass, number>> = {
  [ComponentCapabilityClass.GUIDANCE]: 1,
  [ComponentCapabilityClass.DECLARATIVE]: 2,
  [ComponentCapabilityClass.EXECUTABLE]: 3,
  [ComponentCapabilityClass.CONSTITUTIONAL]: 4,
};

export function compareEvidenceLevels(a: EvidenceLevel, b: EvidenceLevel): number {
  return EVIDENCE_LEVEL_RANK[a] - EVIDENCE_LEVEL_RANK[b];
}

export function meetsEvidenceLevel(actual: EvidenceLevel, required: EvidenceLevel): boolean {
  return EVIDENCE_LEVEL_RANK[actual] >= EVIDENCE_LEVEL_RANK[required];
}

export type SurfaceMutability =
  | 'EVOLVABLE'
  | 'EVOLVABLE_VALIDATED'
  | 'EVOLVABLE_GATED'
  | 'IMMUTABLE';

export interface SurfaceCapabilityRule {
  readonly surfaceId: string;
  readonly capabilityClass: ComponentCapabilityClass;
  readonly mutability: SurfaceMutability;
  readonly minTaskEvidenceLevel: EvidenceLevel;
  readonly minGlobalPromotionEvidenceLevel: EvidenceLevel;
  readonly maxAllowedPermissions: ReadonlyArray<string>;
  readonly requiresStaticSyntaxCheck: boolean;
  readonly requiresAdversarialAudit: boolean;
  readonly requiresRetentionCheck: boolean;
}

export interface HarnessConstitution {
  readonly version: string;
  readonly immutableCoreSurfaces: ReadonlyArray<string>;
  readonly rules: Readonly<Record<string, SurfaceCapabilityRule>>;
  readonly allowImplicitPrivilegeEscalation: false;
  readonly allowSelfModificationOfAdmissionGate: false;
}

export const DEFAULT_HARNESS_CONSTITUTION: HarnessConstitution = Object.freeze({
  version: '1.0.0',
  immutableCoreSurfaces: Object.freeze([
    'policyEngine',
    'auditSigner',
    'sandboxConfinement',
    'admissionGate',
    'rollbackSemantics',
    'testProtectionGate',
  ]),
  allowImplicitPrivilegeEscalation: false,
  allowSelfModificationOfAdmissionGate: false,
  rules: Object.freeze<Record<string, SurfaceCapabilityRule>>({
    // Class 1: Guidance components
    systemPrompt: {
      surfaceId: 'systemPrompt',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      mutability: 'EVOLVABLE',
      minTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      maxAllowedPermissions: ['workspace:read'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    toolGuidance: {
      surfaceId: 'toolGuidance',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      mutability: 'EVOLVABLE',
      minTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      maxAllowedPermissions: ['workspace:read'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    memoryPolicy: {
      surfaceId: 'memoryPolicy',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      mutability: 'EVOLVABLE',
      minTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      maxAllowedPermissions: ['memory:read', 'memory:write'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    guardrails: {
      surfaceId: 'guardrails',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['workspace:read'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },

    // Class 2: Declarative behavioral components
    subagents: {
      surfaceId: 'subagents',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['workspace:read', 'workspace:write', 'tool:execute'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    skills: {
      surfaceId: 'skills',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      maxAllowedPermissions: ['workspace:read', 'workspace:write', 'tool:execute'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    contextPolicy: {
      surfaceId: 'contextPolicy',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['context:compile'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    routingPolicy: {
      surfaceId: 'routingPolicy',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['model:route'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },
    verificationPolicy: {
      surfaceId: 'verificationPolicy',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['verification:run'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    toolSchedulingPolicy: {
      surfaceId: 'toolSchedulingPolicy',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      mutability: 'EVOLVABLE_VALIDATED',
      minTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['tool:schedule'],
      requiresStaticSyntaxCheck: false,
      requiresAdversarialAudit: false,
      requiresRetentionCheck: true,
    },

    // Class 3: Executable components
    scripts: {
      surfaceId: 'scripts',
      capabilityClass: ComponentCapabilityClass.EXECUTABLE,
      mutability: 'EVOLVABLE_GATED',
      minTaskEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['workspace:read', 'workspace:write', 'tool:execute'],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    plugins: {
      surfaceId: 'plugins',
      capabilityClass: ComponentCapabilityClass.EXECUTABLE,
      mutability: 'EVOLVABLE_GATED',
      minTaskEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: ['workspace:read', 'workspace:write', 'tool:execute'],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },

    // Class 4: Constitutional components (IMMUTABLE)
    policyEngine: {
      surfaceId: 'policyEngine',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    auditSigner: {
      surfaceId: 'auditSigner',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    sandboxConfinement: {
      surfaceId: 'sandboxConfinement',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    admissionGate: {
      surfaceId: 'admissionGate',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    rollbackSemantics: {
      surfaceId: 'rollbackSemantics',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
    testProtectionGate: {
      surfaceId: 'testProtectionGate',
      capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
      mutability: 'IMMUTABLE',
      minTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      minGlobalPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      maxAllowedPermissions: [],
      requiresStaticSyntaxCheck: true,
      requiresAdversarialAudit: true,
      requiresRetentionCheck: true,
    },
  }),
});

export interface ConstitutionViolation {
  readonly surfaceId: string;
  readonly reason: string;
  readonly code: ErrorCode;
}

export interface ConstitutionalCheckRequest {
  readonly surfaceId: string;
  readonly requestedPermissions?: ReadonlyArray<string>;
  readonly baselineGrantedPermissions?: ReadonlyArray<string>;
  readonly contentSummary?: string;
  readonly externalHumanAuthorizationToken?: string;
}

export class ConstitutionValidator {
  constructor(
    private readonly constitution: HarnessConstitution = DEFAULT_HARNESS_CONSTITUTION,
  ) {}

  getConstitution(): HarnessConstitution {
    return this.constitution;
  }

  validateMutation(request: ConstitutionalCheckRequest): ReadonlyArray<ConstitutionViolation> {
    const violations: ConstitutionViolation[] = [];
    const rule = this.constitution.rules[request.surfaceId];

    // 1. Reject unregistered surfaces
    if (!rule) {
      violations.push({
        surfaceId: request.surfaceId,
        reason: `Surface '${request.surfaceId}' is not registered in the Harness Constitution.`,
        code: ErrorCode.EVOLUTION_SURFACE_LOCKED,
      });
      return violations;
    }

    // 2. Reject mutations to CONSTITUTIONAL / IMMUTABLE surfaces
    if (
      rule.capabilityClass === ComponentCapabilityClass.CONSTITUTIONAL ||
      rule.mutability === 'IMMUTABLE' ||
      this.constitution.immutableCoreSurfaces.includes(request.surfaceId)
    ) {
      violations.push({
        surfaceId: request.surfaceId,
        reason: `Constitutional surface '${request.surfaceId}' is immutable by the self-evolution optimizer.`,
        code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
      });
    }

    // 3. Reject implicit privilege escalation beyond surface maxAllowedPermissions and baseline permissions
    if (request.requestedPermissions && request.requestedPermissions.length > 0) {
      const allowedSet = new Set(rule.maxAllowedPermissions);
      const baselineSet = request.baselineGrantedPermissions
        ? new Set(request.baselineGrantedPermissions)
        : allowedSet;

      for (const perm of request.requestedPermissions) {
        if (!allowedSet.has(perm) || !baselineSet.has(perm)) {
          violations.push({
            surfaceId: request.surfaceId,
            reason: `Component on surface '${request.surfaceId}' requested unauthorized privilege '${perm}'. Optimizer cannot grant itself additional permissions.`,
            code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
          });
        }
      }
    }

    // 4. Reject content that attempts to weaken guardrails or bypass admission/policy
    if (request.contentSummary) {
      const lower = request.contentSummary.toLowerCase();
      const forbiddenPatterns = [
        'disable_policy_engine',
        'bypass_admission_gate',
        'disable_sandbox',
        'skip_audit_signature',
        'override_constitution',
        'allow_unrestricted_network',
      ];
      for (const pattern of forbiddenPatterns) {
        if (lower.includes(pattern)) {
          violations.push({
            surfaceId: request.surfaceId,
            reason: `Proposed mutation on '${request.surfaceId}' contains forbidden constitutional bypass directive '${pattern}'.`,
            code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
          });
        }
      }
    }

    return violations;
  }

  assertCompliance(request: ConstitutionalCheckRequest): void {
    const violations = this.validateMutation(request);
    if (violations.length > 0) {
      const first = violations[0]!;
      throw new HarnessError({
        code: first.code,
        category: ErrorCategory.EVOLUTION,
        message: first.reason,
        context: {
          surfaceId: request.surfaceId,
          violations,
        },
      });
    }
  }

  static validateProposedSurfaces(
    surfaceIds: ReadonlyArray<string>,
    constitution: HarnessConstitution = DEFAULT_HARNESS_CONSTITUTION,
  ): { readonly valid: boolean; readonly violations: ReadonlyArray<string> } {
    const validator = new ConstitutionValidator(constitution);
    const violations: string[] = [];
    for (const surfaceId of surfaceIds) {
      const baseSurface = surfaceId.split(':')[0] ?? surfaceId;
      const res = validator.validateMutation({ surfaceId: baseSurface });
      for (const v of res) {
        violations.push(v.reason);
      }
    }
    return {
      valid: violations.length === 0,
      violations,
    };
  }

  static validateDirectivePayload(payload: string): {
    readonly valid: boolean;
    readonly violations: ReadonlyArray<string>;
  } {
    const lower = payload.toLowerCase();
    const forbiddenPatterns = [
      'disable_policy_engine',
      'bypass_admission_gate',
      'disable_sandbox',
      'sandbox_mode = none',
      'sandboxmode": "none"',
      'skip_audit_signature',
      'override_constitution',
      'allow_unrestricted_network',
      'grant_root_privilege',
    ];
    const violations: string[] = [];
    for (const pattern of forbiddenPatterns) {
      if (lower.includes(pattern)) {
        violations.push(
          `Payload contains forbidden constitutional bypass directive '${pattern}'.`,
        );
      }
    }
    return {
      valid: violations.length === 0,
      violations,
    };
  }
}

export const IMMUTABLE_CONSTITUTIONAL_SURFACES: ReadonlyArray<string> =
  DEFAULT_HARNESS_CONSTITUTION.immutableCoreSurfaces;

export function getRequiredEvidenceLevel(
  capabilityClass: ComponentCapabilityClass,
  isGlobalPromotion: boolean,
): EvidenceLevel {
  if (isGlobalPromotion) {
    return EvidenceLevel.E4_GENERALIZATION;
  }
  switch (capabilityClass) {
    case ComponentCapabilityClass.GUIDANCE:
      return EvidenceLevel.E1_SINGLE_CONTRAST;
    case ComponentCapabilityClass.DECLARATIVE:
      return EvidenceLevel.E2_REPLICATED_CONTRAST;
    case ComponentCapabilityClass.EXECUTABLE:
      return EvidenceLevel.E3_VERIFIED;
    case ComponentCapabilityClass.CONSTITUTIONAL:
      return EvidenceLevel.E4_GENERALIZATION;
  }
}

