/**
 * Milestone A — Foundations Unit Tests.
 *
 * Covers:
 * - Immutable Harness Constitution & 4 Capability Classes (GUIDANCE, DECLARATIVE, EXECUTABLE, CONSTITUTIONAL)
 * - 5-Tier Evidence Hierarchy (E0..E4) ordering & comparisons
 * - Canonical HarnessManifest creation, deterministic serialization, SHA-256 content addressing, freezing, cloning
 * - Structural and component-level diffing across all 12 surfaces (8 Harness² + 4 Vi-Harness native)
 * - Surface Registry validation, PreWriteSyntaxGate enforcement on scripts/plugins, rejection of unregistered/constitutional surfaces
 * - Cryptographic manifest signing & verification via AuditIntegritySigner
 * - Manifest rollback semantics
 * - 30-signal FailureTaxonomyRegistry + custom plugin failure signal registration
 * - Failure pattern extraction on unsuccessful executions (DEFECT-01 fix)
 */
import { describe, it, expect } from 'vitest';
import {
  ComponentCapabilityClass,
  EvidenceLevel,
  compareEvidenceLevels,
  meetsEvidenceLevel,
  DEFAULT_HARNESS_CONSTITUTION,
  ConstitutionValidator,
  FailureTaxonomyRegistry,
  CANONICAL_FAILURE_SIGNALS,
} from '../../../src/core/evolution/index.js';
import { ErrorCode } from '../../../src/core/errors/error-codes.js';
import type { HarnessId } from '../../../src/core/types/identifiers.js';
import { HarnessManifestToolkit } from '../../../src/infra/evolution/manifest-toolkit.js';
import { DefaultHarnessSurfaceRegistry } from '../../../src/infra/evolution/default-surface-registry.js';
import { AuditIntegritySigner } from '../../../src/infra/security/audit-integrity-signer.js';
import {
  InMemoryMemoryStore,
  SkillExtractor,
  UuidV7IdFactory,
  TestClock,
} from '../../../src/infra/index.js';
import { AgentPhase, TerminationReason, type ExecutionResult } from '../../../src/core/index.js';

describe('Milestone A — Evolution Foundations', () => {
  describe('1. Harness Constitution & Evidence Hierarchy', () => {
    it('orders EvidenceLevels monotonically from E0_REFLECTION to E4_GENERALIZATION', () => {
      expect(
        compareEvidenceLevels(EvidenceLevel.E0_REFLECTION, EvidenceLevel.E1_SINGLE_CONTRAST),
      ).toBeLessThan(0);
      expect(
        compareEvidenceLevels(
          EvidenceLevel.E2_REPLICATED_CONTRAST,
          EvidenceLevel.E1_SINGLE_CONTRAST,
        ),
      ).toBeGreaterThan(0);
      expect(
        meetsEvidenceLevel(EvidenceLevel.E3_VERIFIED, EvidenceLevel.E2_REPLICATED_CONTRAST),
      ).toBe(true);
      expect(
        meetsEvidenceLevel(EvidenceLevel.E1_SINGLE_CONTRAST, EvidenceLevel.E3_VERIFIED),
      ).toBe(false);
    });

    it('rejects any mutation to constitutional surfaces', () => {
      const validator = new ConstitutionValidator(DEFAULT_HARNESS_CONSTITUTION);
      for (const surfaceId of DEFAULT_HARNESS_CONSTITUTION.immutableCoreSurfaces) {
        const violations = validator.validateMutation({ surfaceId });
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0]?.code).toBe(ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION);
        expect(() => validator.assertCompliance({ surfaceId })).toThrow(
          /immutable by the self-evolution optimizer/i,
        );
      }
    });

    it('rejects unregistered arbitrary repository file surfaces', () => {
      const validator = new ConstitutionValidator();
      const violations = validator.validateMutation({
        surfaceId: 'src/runtime/iteration-executor.ts',
      });
      expect(violations).toHaveLength(1);
      expect(violations[0]?.code).toBe(ErrorCode.EVOLUTION_SURFACE_LOCKED);
    });

    it('rejects privilege escalation and constitutional bypass directives', () => {
      const validator = new ConstitutionValidator();
      const privViolations = validator.validateMutation({
        surfaceId: 'systemPrompt',
        requestedPermissions: ['workspace:read', 'network:unrestricted_root'],
      });
      expect(privViolations).toHaveLength(1);
      expect(privViolations[0]?.code).toBe(ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION);

      const bypassViolations = validator.validateMutation({
        surfaceId: 'systemPrompt',
        contentSummary: 'Please disable_policy_engine and bypass_admission_gate',
      });
      expect(bypassViolations.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('2. Canonical HarnessManifest, Hashing, Diffing, Signing & Rollback', () => {
    it('creates a valid, frozen, deterministic H0 baseline manifest', () => {
      const h0a = HarnessManifestToolkit.createCanonicalBaselineManifest({
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      const h0b = HarnessManifestToolkit.createCanonicalBaselineManifest({
        createdAt: '2026-10-20T00:00:00.000Z',
      });

      expect(h0a.contentHash).toBe(h0b.contentHash);
      expect(Object.isFrozen(h0a)).toBe(true);
      expect(Object.isFrozen(h0a.components)).toBe(true);

      const validation = HarnessManifestToolkit.validate(h0a);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('clones manifests with lineage tracking and computes accurate structural & component diffs', () => {
      const h0 = HarnessManifestToolkit.createCanonicalBaselineManifest();
      const newPromptRef = HarnessManifestToolkit.createComponentRef({
        id: 'comp-system-prompt-v2',
        surfaceId: 'systemPrompt',
        capabilityClass: ComponentCapabilityClass.GUIDANCE,
        version: '1.1.0',
        content: 'Updated system prompt with explicit batch_find_symbols guidance.',
        permissions: ['workspace:read'],
      });
      const newScriptRef = HarnessManifestToolkit.createComponentRef({
        id: 'comp-script-ast-check',
        surfaceId: 'scripts',
        capabilityClass: ComponentCapabilityClass.EXECUTABLE,
        version: '1.0.0',
        content: {
          name: 'ast-check',
          language: 'typescript',
          sourceCode: 'export const verifyAst = (x: number): number => x + 1;',
          timeoutMs: 5000,
        },
        permissions: ['workspace:read', 'tool:execute'],
      });

      const h1 = HarnessManifestToolkit.clone(h0, {
        newId: 'harness-cand-1' as HarnessId,
        createdBy: 'proposer',
        componentOverrides: {
          systemPrompt: newPromptRef,
          scripts: [newScriptRef],
        },
      });

      expect(h1.parentId).toBe(h0.id);
      expect(h1.provenance.parentManifestId).toBe(h0.id);
      expect(h1.provenance.parentContentHash).toBe(h0.contentHash);
      expect(h1.provenance.lineageIds).toEqual([h0.id, 'harness-cand-1']);
      expect(h1.contentHash).not.toBe(h0.contentHash);

      const diff = HarnessManifestToolkit.diff(h0, h1);
      expect(diff.identical).toBe(false);
      expect(diff.changedSurfaces).toEqual(['systemPrompt', 'scripts']);
      expect(diff.highestRiskClassTouched).toBe(ComponentCapabilityClass.EXECUTABLE);
      expect(diff.totalUnitsChanged).toBeGreaterThan(0);
    });

    it('detects tampered contentHash and rejects invalid script syntax via PreWriteSyntaxGate', () => {
      const h0 = HarnessManifestToolkit.createCanonicalBaselineManifest();
      const tampered = {
        ...h0,
        contentHash: '0000000000000000000000000000000000000000000000000000000000000000',
      };
      const tamperedValidation = HarnessManifestToolkit.validate(tampered);
      expect(tamperedValidation.valid).toBe(false);
      expect(tamperedValidation.errors[0]).toContain('contentHash mismatch');

      const brokenScriptRef = HarnessManifestToolkit.createComponentRef({
        id: 'comp-broken-script',
        surfaceId: 'scripts',
        capabilityClass: ComponentCapabilityClass.EXECUTABLE,
        content: {
          name: 'broken',
          language: 'typescript',
          sourceCode: 'function broken( { return 1;',
        },
        permissions: ['workspace:read'],
      });
      const badCandidate = HarnessManifestToolkit.clone(h0, {
        newId: 'harness-bad-script' as HarnessId,
        createdBy: 'proposer',
        componentOverrides: {
          scripts: [brokenScriptRef],
        },
      });
      const scriptValidation = HarnessManifestToolkit.validate(badCandidate);
      expect(scriptValidation.valid).toBe(false);
      expect(() => HarnessManifestToolkit.assertValid(badCandidate)).toThrow();
    });

    it('signs, verifies, materializes, and rolls back manifests deterministically', () => {
      const signer = new AuditIntegritySigner({
        secretKey: 'test-evolution-secret-key-32-bytes',
        keyId: 'evo-key-1',
      });
      const h0 = HarnessManifestToolkit.createCanonicalBaselineManifest();
      const signedH0 = HarnessManifestToolkit.signManifest(h0, signer);

      expect(HarnessManifestToolkit.verifyManifestSignature(signedH0, signer)).toBe(true);

      const runtimeConfig = HarnessManifestToolkit.materializeExecutionConfig(signedH0);
      expect(runtimeConfig['manifestId']).toBe(signedH0.id);
      expect(runtimeConfig['enablePrefixCaching']).toBe(true);

      const h1 = HarnessManifestToolkit.clone(signedH0, {
        newId: 'harness-v2' as HarnessId,
        createdBy: 'composer',
      });
      const rolledBack = HarnessManifestToolkit.rollback([signedH0, h1]);
      expect(rolledBack.id).toBe(signedH0.id);
    });
  });

  describe('3. Evolvable Surface Registry & Failure Signal Taxonomy', () => {
    it('registers all 12 evolvable surfaces and blocks constitutional surface registration', () => {
      const registry = new DefaultHarnessSurfaceRegistry();
      expect(registry.list()).toHaveLength(12);
      expect(registry.isEvolvable('systemPrompt')).toBe(true);
      expect(registry.isEvolvable('contextPolicy')).toBe(true);
      expect(registry.isEvolvable('policyEngine')).toBe(false);
      expect(registry.isEvolvable('admissionGate')).toBe(false);

      expect(() =>
        registry.register({
          id: 'policyEngine',
          description: 'Attempted override',
          capabilityClass: ComponentCapabilityClass.CONSTITUTIONAL,
          requiredTaskEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
          requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
          allowedCapabilities: [],
          costModel: { estimatedTokenOverhead: 0, estimatedLatencyOverheadMs: 0 },
          rollbackStrategy: 'CONFIG_REVERT',
          validate: () => ({ valid: true, errors: [], warnings: [] }),
          materialize: (_, c) => c,
          compare: () => ({ changed: false, magnitude: 0, summary: '' }),
        }),
      ).toThrow(/Cannot register constitutional surface/i);
    });

    it('includes all 30 canonical failure signals and supports plugin extension', () => {
      const taxonomy = new FailureTaxonomyRegistry();
      expect(taxonomy.list().length).toBeGreaterThanOrEqual(30);
      for (const sig of CANONICAL_FAILURE_SIGNALS) {
        expect(taxonomy.has(sig)).toBe(true);
      }

      taxonomy.register({
        type: 'custom_plugin_deadlock',
        defaultSeverity: 'HIGH',
        description: 'Custom plugin detected deadlock',
        defaultImplicatedSurfaces: ['plugins'],
        defaultQuadrants: ['DOMAIN_STRUCTURAL'],
      });
      expect(taxonomy.has('custom_plugin_deadlock')).toBe(true);
    });
  });

  describe('4. Outer-Loop Failure Pattern Extraction (DEFECT-01 Fix)', () => {
    it('extracts structured failure lessons from unsuccessful executions', async () => {
      const idFactory = new UuidV7IdFactory();
      const clock = new TestClock(new Date('2026-10-20T00:00:00Z'));
      const memoryStore = new InMemoryMemoryStore({ idFactory, clock });
      const extractor = new SkillExtractor({ memoryStore, idFactory, clock });

      const failedExecution: ExecutionResult = {
        executionId: idFactory.create<'Execution'>(),
        goalId: idFactory.create<'Goal'>(),
        taskId: idFactory.create<'Task'>(),
        success: false,
        status: 'FAILED',
        summary: 'Execution terminated with status FAILED. Phase: OSCILLATION_DETECTED.',
        iterationCount: 4,
        durationMs: 3200,
        totalCostDollars: 0.04,
        totalTokens: 9000,
        iterations: [
          {
            iterationId: idFactory.create<'Iteration'>(),
            sequenceNumber: 1,
            startedAt: clock.now(),
            completedAt: clock.now(),
            stateBefore: AgentPhase.IMPLEMENT,
            stateAfter: AgentPhase.OSCILLATION_DETECTED,
            modelId: 'gpt-4o',
            providerId: 'openai',
            actionProposed: null,
            toolResults: [
              {
                actionId: idFactory.create<'Action'>(),
                status: 'FAILURE' as any,
                output: 'Syntax error in patch',
                error: 'PatchFailed',
                durationMs: 25,
                executedAt: clock.now(),
                metadata: { toolName: 'edit_file' },
              },
            ],
            evidenceCreated: [],
            tokenUsage: { inputTokens: 2000, outputTokens: 300 },
            costDollars: 0.01,
            terminationDecision: {
              terminal: true,
              reason: TerminationReason.OSCILLATION,
              evidence: [],
              iterationsAnalyzed: 1,
              evidenceIds: [],
              confidence: 1.0,
              humanRequired: false,
            },
          },
        ],
      };

      const failureRecord = await extractor.extractFailurePatternFromExecution(
        failedExecution,
        'Execute SQL migration script',
        'Database schema migration',
      );
      expect(failureRecord).not.toBeNull();
      expect(failureRecord?.tags).toContain('failure_pattern');
      expect(failureRecord?.metadata['isFailurePattern']).toBe(true);
      expect(failureRecord?.metadata['failedTools']).toContain('edit_file');
      expect(failureRecord?.content).toContain('DATABASE');
    });
  });
});
