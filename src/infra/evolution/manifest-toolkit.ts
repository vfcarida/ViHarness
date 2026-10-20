/**
 * HarnessManifest Toolkit (ADR-015).
 *
 * Provides deterministic canonical serialization, SHA-256 content addressing,
 * structural & component-level diffing, constitutional validation, immutability
 * freezing, runtime materialization, cryptographic provenance signing, and rollback.
 */
import * as crypto from 'node:crypto';
import { HarnessError } from '../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../core/errors/error-codes.js';
import type {
  HarnessId,
  EvolutionRunId,
  HypothesisId,
} from '../../core/types/identifiers.js';
import {
  ComponentCapabilityClass,
  CAPABILITY_CLASS_RISK_RANK,
  EvidenceLevel,
  DEFAULT_HARNESS_CONSTITUTION,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  ComponentRef,
  HarnessComponents,
  HarnessManifest,
  HarnessManifestDiff,
  ComponentDiffEntry,
  ManifestCreatorRole,
} from '../../core/evolution/harness-manifest.js';
import type {
  HarnessSurfaceRegistry,
  SurfaceValidationResult,
} from '../../core/evolution/surface-registry.js';
import { DefaultHarnessSurfaceRegistry } from './default-surface-registry.js';
import type { AuditIntegritySigner } from '../security/audit-integrity-signer.js';

export const HARNESS_MANIFEST_SCHEMA_VERSION = '1.0.0';

export class HarnessManifestToolkit {
  /**
   * Deterministic canonical JSON stringification with recursively sorted object keys.
   */
  static canonicalize(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => this.canonicalize(item)).join(',')}]`;
    }
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${this.canonicalize(record[k])}`);
    return `{${entries.join(',')}}`;
  }

  /**
   * Compute deterministic SHA-256 hex digest over canonicalized JSON.
   */
  static computeHash(value: unknown): string {
    return crypto.createHash('sha256').update(this.canonicalize(value)).digest('hex');
  }

  /**
   * Create a canonical ComponentRef with automatically computed contentHash.
   */
  static createComponentRef(params: {
    readonly id: string;
    readonly surfaceId: string;
    readonly capabilityClass: ComponentCapabilityClass;
    readonly version?: string;
    readonly content: string | Readonly<Record<string, unknown>>;
    readonly permissions?: ReadonlyArray<string>;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): ComponentRef {
    const version = params.version ?? '1.0.0';
    const contentHash = this.computeHash({
      surfaceId: params.surfaceId,
      capabilityClass: params.capabilityClass,
      version,
      content: params.content,
      permissions: params.permissions ?? [],
    });

    return {
      id: params.id,
      surfaceId: params.surfaceId,
      capabilityClass: params.capabilityClass,
      version,
      contentHash,
      content: params.content,
      permissions: params.permissions,
      metadata: params.metadata,
    };
  }

  /**
   * Compute deterministic contentHash for a HarnessManifest based on its functional specification.
   */
  static computeManifestHash(
    manifest: Pick<
      HarnessManifest,
      'schemaVersion' | 'components' | 'target' | 'budgetProfile' | 'securityProfile'
    >,
  ): string {
    return this.computeHash({
      schemaVersion: manifest.schemaVersion,
      components: manifest.components,
      target: manifest.target,
      budgetProfile: manifest.budgetProfile,
      securityProfile: manifest.securityProfile,
    });
  }

  /**
   * Construct the canonical seed baseline manifest (H0).
   */
  static createCanonicalBaselineManifest(options?: {
    readonly id?: HarnessId;
    readonly createdAt?: string;
    readonly modelFamily?: string;
    readonly domain?: string;
    readonly language?: string;
    readonly environmentFingerprint?: string;
  }): HarnessManifest {
    const id = (options?.id ?? 'harness-h0-canonical') as HarnessId;
    const createdAt = options?.createdAt ?? '2026-10-20T00:00:00.000Z';

    const components: HarnessComponents = {
      systemPrompt: this.createComponentRef({
        id: 'comp-system-prompt-h0',
        surfaceId: 'systemPrompt',
        capabilityClass: ComponentCapabilityClass.GUIDANCE,
        content:
          'You are Vi-Harness, a stateful, evidence-driven coding agent operating over a 14-phase deterministic state machine. Always verify changes with empirical tests before completion.',
        permissions: ['workspace:read'],
      }),
      guardrails: this.createComponentRef({
        id: 'comp-guardrails-h0',
        surfaceId: 'guardrails',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        content: {
          enforceWorkspaceConfinement: true,
          forbidTestDeletion: true,
          requireVerificationEvidence: true,
        },
        permissions: ['workspace:read'],
      }),
      memoryPolicy: this.createComponentRef({
        id: 'comp-memory-policy-h0',
        surfaceId: 'memoryPolicy',
        capabilityClass: ComponentCapabilityClass.GUIDANCE,
        content: {
          useFrozenMemorySnapshot: true,
          extractSuccessPatterns: true,
          extractFailurePatterns: true,
        },
        permissions: ['memory:read', 'memory:write'],
      }),
      toolGuidance: this.createComponentRef({
        id: 'comp-tool-guidance-h0',
        surfaceId: 'toolGuidance',
        capabilityClass: ComponentCapabilityClass.GUIDANCE,
        content:
          'Prefer batch_find_symbols and search_code for exploration, edit_file for surgical edits, and run_command for targeted test verification.',
        permissions: ['workspace:read'],
      }),
      subagents: [
        this.createComponentRef({
          id: 'comp-subagent-explorer-h0',
          surfaceId: 'subagents',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: {
            name: 'repo-explorer',
            role: 'EXPLORER',
            maxDepth: 2,
            maxTokenBudget: 16000,
            allowedTools: ['read_file', 'search_code', 'batch_find_symbols'],
          },
          permissions: ['workspace:read', 'tool:execute'],
        }),
      ],
      skills: [
        this.createComponentRef({
          id: 'comp-skill-tdd-repair-h0',
          surfaceId: 'skills',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          content: {
            name: 'tdd-iterative-repair',
            description: 'Reproduce failure with targeted test before applying minimal surgical fix.',
            instructions:
              '1. Locate failing test or write minimal reproduction. 2. Apply surgical edit_file change. 3. Re-run impacted test suite.',
            triggers: ['test_failure', 'bug_fix'],
          },
          permissions: ['workspace:read', 'workspace:write', 'tool:execute'],
        }),
      ],
      scripts: [],
      plugins: [],
      contextPolicy: this.createComponentRef({
        id: 'comp-context-policy-h0',
        surfaceId: 'contextPolicy',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        content: {
          compactionStrategy: 'MULTI_TIER_6_STAGE',
          compactionThreshold: 0.8,
          enablePrefixCaching: true,
          enableMicroCompactor: true,
          maxToolResultTokens: 8000,
        },
        permissions: ['context:compile'],
      }),
      routingPolicy: this.createComponentRef({
        id: 'comp-routing-policy-h0',
        surfaceId: 'routingPolicy',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        content: {
          architectMode: false,
          reasoningEffort: 'medium',
          maxRetries: 2,
        },
        permissions: ['model:route'],
      }),
      verificationPolicy: this.createComponentRef({
        id: 'comp-verification-policy-h0',
        surfaceId: 'verificationPolicy',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        content: {
          autoLintAfterWrite: true,
          autoTestAfterWrite: true,
          adversarialQa: true,
          requireTdd: false,
          maxAutoCorrectionsPerFile: 2,
        },
        permissions: ['verification:run'],
      }),
      toolSchedulingPolicy: this.createComponentRef({
        id: 'comp-tool-scheduling-h0',
        surfaceId: 'toolSchedulingPolicy',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        content: {
          maxParallelCalls: 4,
          spillThresholdChars: 10000,
          defaultToolTimeoutMs: 60000,
          repeatSimilarityThreshold: 0.9,
        },
        permissions: ['tool:schedule'],
      }),
    };

    const target = {
      modelFamily: options?.modelFamily ?? 'model-agnostic',
      domain: options?.domain ?? 'general-swe',
      language: options?.language ?? 'typescript',
      environmentFingerprint: options?.environmentFingerprint ?? 'vi-harness-default-env-v1',
    };

    const budgetProfile = {
      maxIterationsPerProbe: 15,
      maxTokensPerProbe: 120_000,
      maxCostDollarsPerProbe: 1.5,
      maxWallTimeMsPerProbe: 180_000,
      maxProbesPerEvolutionRun: 12,
      maxTotalEvolutionCostDollars: 10.0,
    };

    const securityProfile = {
      sandboxMode: 'worktree' as const,
      networkEgressPolicy: 'RESTRICTED_BENCHMARK' as const,
      allowFilesystemEscape: false as const,
      allowPrivilegeEscalation: false as const,
      grantedPermissions: [
        'workspace:read',
        'workspace:write',
        'tool:execute',
        'memory:read',
        'memory:write',
        'context:compile',
        'model:route',
        'verification:run',
        'tool:schedule',
      ],
    };

    const contentHash = this.computeManifestHash({
      schemaVersion: HARNESS_MANIFEST_SCHEMA_VERSION,
      components,
      target,
      budgetProfile,
      securityProfile,
    });

    return this.freeze({
      id,
      schemaVersion: HARNESS_MANIFEST_SCHEMA_VERSION,
      createdAt,
      frozen: true,
      contentHash,
      components,
      target,
      provenance: {
        createdBy: 'baseline',
        lineageIds: [id],
      },
      evidence: {
        highestLevelAchieved: EvidenceLevel.E4_GENERALIZATION,
        bundleIds: [],
        regressionsDetected: 0,
        securityViolations: 0,
        retentionStatus: 'PASS',
      },
      budgetProfile,
      securityProfile,
    });
  }

  /**
   * Deeply freeze a HarnessManifest so it cannot be mutated during or after probing.
   */
  static freeze<T>(obj: T): T {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.freeze(obj);
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        this.freeze((obj as Record<string, unknown>)[key]);
      }
    }
    return obj;
  }

  /**
   * Clone a manifest into a new derived candidate manifest with updated lineage and contentHash.
   */
  static clone(
    base: HarnessManifest,
    params: {
      readonly newId: HarnessId;
      readonly createdBy: ManifestCreatorRole;
      readonly createdAt?: string;
      readonly componentOverrides?: Partial<HarnessComponents>;
      readonly budgetOverride?: Partial<HarnessManifest['budgetProfile']>;
      readonly evolutionRunId?: EvolutionRunId;
      readonly hypothesisId?: HypothesisId;
      readonly evidenceOverride?: Partial<HarnessManifest['evidence']>;
    },
  ): HarnessManifest {
    const components: HarnessComponents = {
      ...base.components,
      ...params.componentOverrides,
    };

    const budgetProfile: HarnessManifest['budgetProfile'] = {
      ...base.budgetProfile,
      ...params.budgetOverride,
    };

    const contentHash = this.computeManifestHash({
      schemaVersion: base.schemaVersion,
      components,
      target: base.target,
      budgetProfile,
      securityProfile: base.securityProfile,
    });

    const lineageIds = [...base.provenance.lineageIds, params.newId];

    const derived: HarnessManifest = {
      id: params.newId,
      parentId: base.id,
      schemaVersion: base.schemaVersion,
      createdAt: params.createdAt ?? new Date().toISOString(),
      frozen: true,
      contentHash,
      components,
      target: { ...base.target },
      provenance: {
        createdBy: params.createdBy,
        parentManifestId: base.id,
        parentContentHash: base.contentHash,
        lineageIds,
        evolutionRunId: params.evolutionRunId,
        hypothesisId: params.hypothesisId,
      },
      evidence: {
        highestLevelAchieved: EvidenceLevel.E0_REFLECTION,
        bundleIds: [],
        regressionsDetected: 0,
        securityViolations: 0,
        retentionStatus: 'UNTESTED',
        ...params.evidenceOverride,
      },
      budgetProfile,
      securityProfile: { ...base.securityProfile },
    };

    return this.freeze(derived);
  }

  /**
   * Validate a HarnessManifest against schema, hash integrity, SurfaceRegistry, and Constitution.
   */
  static validate(
    manifest: HarnessManifest,
    registry: HarnessSurfaceRegistry = new DefaultHarnessSurfaceRegistry(),
    _constitution: HarnessConstitution = DEFAULT_HARNESS_CONSTITUTION,
  ): SurfaceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!manifest.id || typeof manifest.id !== 'string') {
      errors.push('Manifest id must be a non-empty string.');
    }

    if (manifest.schemaVersion !== HARNESS_MANIFEST_SCHEMA_VERSION) {
      errors.push(
        `Unsupported manifest schemaVersion '${manifest.schemaVersion}' (expected '${HARNESS_MANIFEST_SCHEMA_VERSION}').`,
      );
    }

    // Verify contentHash integrity
    const expectedHash = this.computeManifestHash(manifest);
    if (manifest.contentHash !== expectedHash) {
      errors.push(
        `Manifest contentHash mismatch: recorded '${manifest.contentHash}', computed '${expectedHash}'.`,
      );
    }

    // Verify security profile invariants
    if (manifest.securityProfile.allowFilesystemEscape !== false) {
      errors.push('Constitutional violation: securityProfile.allowFilesystemEscape must be false.');
    }
    if (manifest.securityProfile.allowPrivilegeEscalation !== false) {
      errors.push(
        'Constitutional violation: securityProfile.allowPrivilegeEscalation must be false.',
      );
    }

    // Collect all ComponentRefs across singletons and arrays
    const allRefs: ComponentRef[] = [
      manifest.components.systemPrompt,
      manifest.components.guardrails,
      manifest.components.memoryPolicy,
      manifest.components.toolGuidance,
      ...manifest.components.subagents,
      ...manifest.components.skills,
      ...manifest.components.scripts,
      ...manifest.components.plugins,
    ];
    if (manifest.components.contextPolicy) allRefs.push(manifest.components.contextPolicy);
    if (manifest.components.routingPolicy) allRefs.push(manifest.components.routingPolicy);
    if (manifest.components.verificationPolicy)
      allRefs.push(manifest.components.verificationPolicy);
    if (manifest.components.toolSchedulingPolicy)
      allRefs.push(manifest.components.toolSchedulingPolicy);

    const grantedSet = new Set(manifest.securityProfile.grantedPermissions);

    for (const ref of allRefs) {
      const refResult = registry.validateComponentRef(ref);
      for (const err of refResult.errors) {
        errors.push(`[${ref.surfaceId}/${ref.id}] ${err}`);
      }
      warnings.push(...refResult.warnings);

      // Verify component permissions do not exceed manifest securityProfile.grantedPermissions
      if (ref.permissions) {
        for (const perm of ref.permissions) {
          if (!grantedSet.has(perm)) {
            errors.push(
              `[${ref.surfaceId}/${ref.id}] Requested permission '${perm}' is not granted in securityProfile.`,
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Assert that a HarnessManifest is valid, throwing a typed HarnessError if not.
   */
  static assertValid(
    manifest: HarnessManifest,
    registry?: HarnessSurfaceRegistry,
    constitution?: HarnessConstitution,
  ): void {
    const res = this.validate(manifest, registry, constitution);
    if (!res.valid) {
      const isConstitutionError = res.errors.some(
        (e) =>
          e.toLowerCase().includes('constitutional') ||
          e.toLowerCase().includes('permission') ||
          e.toLowerCase().includes('privilege'),
      );
      throw new HarnessError({
        code: isConstitutionError
          ? ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION
          : ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: `Invalid HarnessManifest (${manifest.id}): ${res.errors.join('; ')}`,
        context: {
          manifestId: manifest.id,
          errors: res.errors,
        },
      });
    }
  }

  /**
   * Compute structural and component-level diff between two HarnessManifests.
   */
  static diff(
    base: HarnessManifest,
    candidate: HarnessManifest,
    registry: HarnessSurfaceRegistry = new DefaultHarnessSurfaceRegistry(),
  ): HarnessManifestDiff {
    const componentDiffs: ComponentDiffEntry[] = [];
    const changedSurfacesSet = new Set<string>();
    let highestRiskRank = CAPABILITY_CLASS_RISK_RANK[ComponentCapabilityClass.GUIDANCE];
    let highestRiskClass = ComponentCapabilityClass.GUIDANCE;
    let totalUnitsChanged = 0;

    const recordDiff = (entry: ComponentDiffEntry) => {
      componentDiffs.push(entry);
      if (entry.changeType !== 'UNCHANGED') {
        changedSurfacesSet.add(entry.surfaceId);
        totalUnitsChanged += entry.magnitude;
        const rank = CAPABILITY_CLASS_RISK_RANK[entry.capabilityClass];
        if (rank > highestRiskRank) {
          highestRiskRank = rank;
          highestRiskClass = entry.capabilityClass;
        }
      }
    };

    const singletonSurfaces: Array<keyof HarnessComponents> = [
      'systemPrompt',
      'guardrails',
      'memoryPolicy',
      'toolGuidance',
      'contextPolicy',
      'routingPolicy',
      'verificationPolicy',
      'toolSchedulingPolicy',
    ];

    for (const surfaceKey of singletonSurfaces) {
      const bRef = base.components[surfaceKey] as ComponentRef | undefined;
      const cRef = candidate.components[surfaceKey] as ComponentRef | undefined;
      if (!bRef && !cRef) continue;

      if (!bRef && cRef) {
        recordDiff({
          surfaceId: String(surfaceKey),
          componentId: cRef.id,
          changeType: 'ADDED',
          capabilityClass: cRef.capabilityClass,
          afterHash: cRef.contentHash,
          afterContent: cRef.content,
          magnitude: 1,
          summary: `Added component '${cRef.id}' on surface '${String(surfaceKey)}'`,
        });
      } else if (bRef && !cRef) {
        recordDiff({
          surfaceId: String(surfaceKey),
          componentId: bRef.id,
          changeType: 'REMOVED',
          capabilityClass: bRef.capabilityClass,
          beforeHash: bRef.contentHash,
          beforeContent: bRef.content,
          magnitude: 1,
          summary: `Removed component '${bRef.id}' from surface '${String(surfaceKey)}'`,
        });
      } else if (bRef && cRef) {
        if (bRef.contentHash === cRef.contentHash) {
          recordDiff({
            surfaceId: String(surfaceKey),
            componentId: cRef.id,
            changeType: 'UNCHANGED',
            capabilityClass: cRef.capabilityClass,
            beforeHash: bRef.contentHash,
            afterHash: cRef.contentHash,
            magnitude: 0,
            summary: 'Unchanged',
          });
        } else {
          const surfaceDef = registry.get(String(surfaceKey));
          const cmp = surfaceDef
            ? surfaceDef.compare(bRef.content, cRef.content)
            : { changed: true, magnitude: 1, summary: 'Modified component content' };
          recordDiff({
            surfaceId: String(surfaceKey),
            componentId: cRef.id,
            changeType: 'MODIFIED',
            capabilityClass: cRef.capabilityClass,
            beforeHash: bRef.contentHash,
            afterHash: cRef.contentHash,
            beforeContent: bRef.content,
            afterContent: cRef.content,
            magnitude: cmp.magnitude,
            summary: cmp.summary,
          });
        }
      }
    }

    const arraySurfaces: Array<'subagents' | 'skills' | 'scripts' | 'plugins'> = [
      'subagents',
      'skills',
      'scripts',
      'plugins',
    ];

    for (const surfaceKey of arraySurfaces) {
      const bList = base.components[surfaceKey];
      const cList = candidate.components[surfaceKey];
      const bMap = new Map(bList.map((item) => [item.id, item]));
      const cMap = new Map(cList.map((item) => [item.id, item]));

      for (const [id, cItem] of cMap.entries()) {
        const bItem = bMap.get(id);
        if (!bItem) {
          recordDiff({
            surfaceId: surfaceKey,
            componentId: id,
            changeType: 'ADDED',
            capabilityClass: cItem.capabilityClass,
            afterHash: cItem.contentHash,
            afterContent: cItem.content,
            magnitude: 1,
            summary: `Added '${id}' to '${surfaceKey}'`,
          });
        } else if (bItem.contentHash !== cItem.contentHash) {
          recordDiff({
            surfaceId: surfaceKey,
            componentId: id,
            changeType: 'MODIFIED',
            capabilityClass: cItem.capabilityClass,
            beforeHash: bItem.contentHash,
            afterHash: cItem.contentHash,
            beforeContent: bItem.content,
            afterContent: cItem.content,
            magnitude: 1,
            summary: `Modified '${id}' in '${surfaceKey}'`,
          });
        } else {
          recordDiff({
            surfaceId: surfaceKey,
            componentId: id,
            changeType: 'UNCHANGED',
            capabilityClass: cItem.capabilityClass,
            beforeHash: bItem.contentHash,
            afterHash: cItem.contentHash,
            magnitude: 0,
            summary: 'Unchanged',
          });
        }
      }

      for (const [id, bItem] of bMap.entries()) {
        if (!cMap.has(id)) {
          recordDiff({
            surfaceId: surfaceKey,
            componentId: id,
            changeType: 'REMOVED',
            capabilityClass: bItem.capabilityClass,
            beforeHash: bItem.contentHash,
            beforeContent: bItem.content,
            magnitude: 1,
            summary: `Removed '${id}' from '${surfaceKey}'`,
          });
        }
      }
    }

    const changedSurfaces = Array.from(changedSurfacesSet);

    return {
      baseManifestId: base.id,
      candidateManifestId: candidate.id,
      baseHash: base.contentHash,
      candidateHash: candidate.contentHash,
      identical: changedSurfaces.length === 0 && base.contentHash === candidate.contentHash,
      changedSurfaces,
      highestRiskClassTouched: highestRiskClass,
      componentDiffs,
      totalUnitsChanged,
    };
  }

  /**
   * Materialize a HarnessManifest into a concrete Vi-Harness runtime configuration object.
   */
  static materializeExecutionConfig(
    manifest: HarnessManifest,
    registry: HarnessSurfaceRegistry = new DefaultHarnessSurfaceRegistry(),
  ): Record<string, unknown> {
    this.assertValid(manifest, registry);

    let config: Record<string, unknown> = {
      manifestId: manifest.id,
      manifestHash: manifest.contentHash,
    };

    const applyRef = (ref?: ComponentRef) => {
      if (!ref) return;
      const surface = registry.get(ref.surfaceId);
      if (surface) {
        config = surface.materialize(ref.content, config);
      }
    };

    applyRef(manifest.components.systemPrompt);
    applyRef(manifest.components.guardrails);
    applyRef(manifest.components.memoryPolicy);
    applyRef(manifest.components.toolGuidance);
    for (const s of manifest.components.subagents) applyRef(s);
    for (const s of manifest.components.skills) applyRef(s);
    for (const s of manifest.components.scripts) applyRef(s);
    for (const p of manifest.components.plugins) applyRef(p);
    applyRef(manifest.components.contextPolicy);
    applyRef(manifest.components.routingPolicy);
    applyRef(manifest.components.verificationPolicy);
    applyRef(manifest.components.toolSchedulingPolicy);

    return config;
  }

  /**
   * Cryptographically sign a HarnessManifest using AuditIntegritySigner.
   */
  static signManifest(
    manifest: HarnessManifest,
    signer: AuditIntegritySigner,
  ): HarnessManifest {
    const signed = signer.sign({
      id: manifest.id,
      contentHash: manifest.contentHash,
      parentId: manifest.parentId,
      lineageIds: manifest.provenance.lineageIds,
    });

    return this.freeze({
      ...manifest,
      provenance: {
        ...manifest.provenance,
        signature: signed.signature,
        signedAt: signed.signedAt,
        keyId: signed.keyId,
      },
    });
  }

  /**
   * Verify a signed HarnessManifest's cryptographic provenance signature.
   */
  static verifyManifestSignature(
    manifest: HarnessManifest,
    signer: AuditIntegritySigner,
  ): boolean {
    if (
      !manifest.provenance.signature ||
      !manifest.provenance.signedAt ||
      !manifest.provenance.keyId
    ) {
      return false;
    }

    return signer.verify({
      payload: {
        id: manifest.id,
        contentHash: manifest.contentHash,
        parentId: manifest.parentId,
        lineageIds: manifest.provenance.lineageIds,
      },
      signature: manifest.provenance.signature,
      signedAt: manifest.provenance.signedAt,
      keyId: manifest.provenance.keyId,
      algorithm: 'HMAC-SHA256',
    });
  }

  /**
   * Roll back to a previous manifest version from an ordered promotion history.
   */
  static rollback(
    history: ReadonlyArray<HarnessManifest>,
    targetManifestId?: HarnessId,
  ): HarnessManifest {
    if (history.length === 0) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: 'Cannot rollback: manifest history is empty.',
      });
    }

    if (targetManifestId) {
      const found = history.find((m) => m.id === targetManifestId);
      if (!found) {
        throw new HarnessError({
          code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
          category: ErrorCategory.EVOLUTION,
          message: `Cannot rollback: target manifest '${targetManifestId}' not found in history.`,
        });
      }
      return found;
    }

    // Default to previous manifest if >= 2 entries exist, otherwise first (H0)
    return history.length >= 2 ? history[history.length - 2]! : history[0]!;
  }

  // ---------------------------------------------------------------------------
  // Instance Convenience Wrappers (delegating to static methods)
  // ---------------------------------------------------------------------------

  private readonly surfaceRegistry: HarnessSurfaceRegistry;
  private readonly constitution: HarnessConstitution;
  private readonly hmacSecret: string;

  constructor(options?: {
    readonly surfaceRegistry?: HarnessSurfaceRegistry;
    readonly constitution?: HarnessConstitution;
    readonly hmacSecret?: string;
    readonly clock?: unknown;
  }) {
    this.surfaceRegistry =
      options?.surfaceRegistry ?? new DefaultHarnessSurfaceRegistry();
    this.constitution = options?.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
    this.hmacSecret = options?.hmacSecret ?? 'vi-harness-default-evolution-secret';
  }

  canonicalizeJson(obj: unknown): string {
    return HarnessManifestToolkit.canonicalize(obj);
  }

  computeContentHash(value: unknown): string {
    return HarnessManifestToolkit.computeHash(value);
  }

  createComponentRef(
    surfaceIdOrParams:
      | string
      | {
          readonly id: string;
          readonly surfaceId: string;
          readonly capabilityClass: ComponentCapabilityClass;
          readonly version?: string;
          readonly content: string | Readonly<Record<string, unknown>>;
          readonly permissions?: ReadonlyArray<string>;
          readonly metadata?: Readonly<Record<string, unknown>>;
        },
    capabilityClass?: ComponentCapabilityClass,
    content?: string | Readonly<Record<string, unknown>>,
    version?: string,
  ): ComponentRef {
    if (typeof surfaceIdOrParams === 'string') {
      const baseSurface = surfaceIdOrParams.split(':')[0] ?? surfaceIdOrParams;
      return HarnessManifestToolkit.createComponentRef({
        id: `comp-${surfaceIdOrParams}`,
        surfaceId: baseSurface,
        capabilityClass: capabilityClass ?? ComponentCapabilityClass.GUIDANCE,
        version,
        content: content ?? {},
      });
    }
    return HarnessManifestToolkit.createComponentRef(surfaceIdOrParams);
  }

  createCanonicalBaseline(options?: {
    readonly id?: string;
    readonly target?: Partial<HarnessManifest['target']>;
  }): HarnessManifest {
    return HarnessManifestToolkit.createCanonicalBaselineManifest({
      id: (options?.id ?? 'H0') as HarnessId,
      modelFamily: options?.target?.modelFamily,
      domain: options?.target?.domain,
      language: options?.target?.language,
      environmentFingerprint: options?.target?.environmentFingerprint,
    });
  }

  cloneWithOverrides(
    base: HarnessManifest,
    options: {
      readonly newId: string;
      readonly author?: string;
      readonly createdBy?: string;
      readonly components?: Partial<HarnessComponents>;
      readonly componentOverrides?: Partial<HarnessComponents>;
      readonly budgetOverride?: Partial<HarnessManifest['budgetProfile']>;
      readonly evidence?: Partial<HarnessManifest['evidence']>;
    },
  ): HarnessManifest {
    const roleMap: Record<string, ManifestCreatorRole> = {
      proposer: 'proposer',
      composer: 'composer',
      human_operator: 'human',
      human: 'human',
      baseline: 'baseline',
      imported: 'imported',
    };
    const roleKey = options.author ?? options.createdBy ?? 'proposer';
    return HarnessManifestToolkit.clone(base, {
      newId: options.newId as HarnessId,
      createdBy: roleMap[roleKey] ?? 'proposer',
      componentOverrides: options.components ?? options.componentOverrides,
      budgetOverride: options.budgetOverride,
      evidenceOverride: options.evidence,
    });
  }

  validate(manifest: HarnessManifest): SurfaceValidationResult {
    return HarnessManifestToolkit.validate(
      manifest,
      this.surfaceRegistry,
      this.constitution,
    );
  }

  diff(base: HarnessManifest, candidate: HarnessManifest): HarnessManifestDiff {
    return HarnessManifestToolkit.diff(base, candidate, this.surfaceRegistry);
  }

  exportToJson(manifest: HarnessManifest): string {
    return JSON.stringify(manifest, null, 2);
  }

  importFromJson(jsonString: string): HarnessManifest {
    const parsed = JSON.parse(jsonString) as HarnessManifest;
    if (!parsed || typeof parsed !== 'object' || !parsed.components) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: 'Invalid HarnessManifest JSON: missing components object.',
      });
    }
    const validation = this.validate(parsed);
    if (!validation.valid) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: `Invalid HarnessManifest (${parsed.id}): ${validation.errors.join('; ')}`,
      });
    }
    return HarnessManifestToolkit.freeze(parsed);
  }

  createReplayPlan(manifest: HarnessManifest): {
    readonly manifestId: HarnessId;
    readonly contentHash: string;
    readonly runtimeConfig: Record<string, unknown>;
  } {
    return {
      manifestId: manifest.id,
      contentHash: manifest.contentHash,
      runtimeConfig: HarnessManifestToolkit.materializeExecutionConfig(
        manifest,
        this.surfaceRegistry,
      ),
    };
  }

  signManifest(manifest: HarnessManifest): HarnessManifest {
    const signature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(
        HarnessManifestToolkit.canonicalize({
          id: manifest.id,
          contentHash: manifest.contentHash,
          parentId: manifest.parentId,
        }),
      )
      .digest('hex');

    return HarnessManifestToolkit.freeze({
      ...manifest,
      provenance: {
        ...manifest.provenance,
        signature,
        signedAt: new Date().toISOString(),
        keyId: 'default-hmac-key',
      },
    });
  }
}

