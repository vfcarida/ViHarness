/**
 * Default Evolvable Surface Registry.
 *
 * Registers the 12 canonical evolvable surfaces (8 Harness² conceptual surfaces +
 * 4 Vi-Harness native structural policy surfaces) with Zod schema validators,
 * materializers, comparators, and constitutional enforcement.
 */
import { z } from 'zod';
import {
  ComponentCapabilityClass,
  EvidenceLevel,
  DEFAULT_HARNESS_CONSTITUTION,
  ConstitutionValidator,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type { ComponentRef } from '../../core/evolution/harness-manifest.js';
import type {
  EvolvableSurfaceDefinition,
  HarnessSurfaceRegistry,
  SurfaceValidationResult,
  SurfaceComparisonResult,
} from '../../core/evolution/surface-registry.js';
import { PreWriteSyntaxGate } from '../security/pre-write-syntax-gate.js';
import { ExecutableSurfaceAstVerifier } from './executable-surface-ast-verifier.js';

const NonEmptyStringSchema = z.string().min(1).max(64_000);

const RecordContentSchema = z.record(z.string(), z.unknown());

const SubagentItemSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  maxDepth: z.number().int().min(1).max(3).optional(),
  maxTokenBudget: z.number().int().positive().optional(),
  allowedTools: z.array(z.string()).optional(),
});

const SkillItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  instructions: z.string().min(1),
  triggers: z.array(z.string()).optional(),
});

const ScriptItemSchema = z.object({
  name: z.string().min(1),
  language: z.enum(['typescript', 'javascript', 'python', 'json', 'shell']),
  sourceCode: z.string().min(1),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
});

const PluginItemSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1).optional(),
  sourceCode: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ContextPolicySchema = z.object({
  compactionStrategy: z
    .enum(['MULTI_TIER_6_STAGE', 'CACHE_AWARE_5_STAGE', 'FOUR_STAGE_PROGRESSIVE'])
    .optional(),
  compactionThreshold: z.number().min(0.3).max(0.95).optional(),
  enablePrefixCaching: z.boolean().optional(),
  enableMicroCompactor: z.boolean().optional(),
  maxToolResultTokens: z.number().int().min(500).max(32_000).optional(),
});

const RoutingPolicySchema = z.object({
  architectMode: z.boolean().optional(),
  primaryModel: z.string().min(1).optional(),
  architectModel: z.string().min(1).optional(),
  editorModel: z.string().min(1).optional(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
});

const VerificationPolicySchema = z.object({
  autoLintAfterWrite: z.boolean().optional(),
  autoTestAfterWrite: z.boolean().optional(),
  adversarialQa: z.boolean().optional(),
  requireTdd: z.boolean().optional(),
  maxAutoCorrectionsPerFile: z.number().int().min(1).max(5).optional(),
});

const ToolSchedulingPolicySchema = z.object({
  maxParallelCalls: z.number().int().min(1).max(16).optional(),
  spillThresholdChars: z.number().int().min(1000).max(100_000).optional(),
  defaultToolTimeoutMs: z.number().int().min(1000).max(300_000).optional(),
  repeatSimilarityThreshold: z.number().min(0.5).max(1.0).optional(),
});

function defaultCompare(before: unknown, after: unknown): SurfaceComparisonResult {
  const beforeStr = JSON.stringify(before);
  const afterStr = JSON.stringify(after);
  if (beforeStr === afterStr) {
    return { changed: false, magnitude: 0, summary: 'No changes' };
  }
  const lenDiff = Math.abs(afterStr.length - beforeStr.length);
  const magnitude = Math.max(1, Math.ceil(lenDiff / 40));
  return {
    changed: true,
    magnitude,
    summary: `Modified content (delta ${lenDiff} chars, magnitude ${magnitude})`,
  };
}

function validateWithZod(schema: z.ZodTypeAny, value: unknown): SurfaceValidationResult {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return { valid: true, errors: [], warnings: [] };
  }
  return {
    valid: false,
    errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`),
    warnings: [],
  };
}

export class DefaultHarnessSurfaceRegistry implements HarnessSurfaceRegistry {
  private readonly surfaces = new Map<string, EvolvableSurfaceDefinition>();
  private readonly constitutionValidator: ConstitutionValidator;

  constructor(
    private readonly constitution: HarnessConstitution = DEFAULT_HARNESS_CONSTITUTION,
  ) {
    this.constitutionValidator = new ConstitutionValidator(constitution);
    this.registerDefaults();
  }

  register<T>(definition: EvolvableSurfaceDefinition<T>): void {
    const rule = this.constitution.rules[definition.id];
    if (
      rule &&
      (rule.capabilityClass === ComponentCapabilityClass.CONSTITUTIONAL ||
        rule.mutability === 'IMMUTABLE')
    ) {
      throw new Error(
        `Cannot register constitutional surface '${definition.id}' as an evolvable surface.`,
      );
    }
    this.surfaces.set(definition.id, definition as EvolvableSurfaceDefinition);
  }

  get<T = unknown>(surfaceId: string): EvolvableSurfaceDefinition<T> | undefined {
    return this.surfaces.get(surfaceId) as EvolvableSurfaceDefinition<T> | undefined;
  }

  list(): ReadonlyArray<EvolvableSurfaceDefinition> {
    return Array.from(this.surfaces.values());
  }

  isEvolvable(surfaceId: string): boolean {
    if (this.constitution.immutableCoreSurfaces.includes(surfaceId)) {
      return false;
    }
    const rule = this.constitution.rules[surfaceId];
    if (!rule || rule.mutability === 'IMMUTABLE') {
      return false;
    }
    return this.surfaces.has(surfaceId);
  }

  validateComponentRef(ref: ComponentRef): SurfaceValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Check constitution compliance
    const violations = this.constitutionValidator.validateMutation({
      surfaceId: ref.surfaceId,
      requestedPermissions: ref.permissions,
      contentSummary:
        typeof ref.content === 'string' ? ref.content : JSON.stringify(ref.content),
    });
    for (const v of violations) {
      errors.push(v.reason);
    }

    // 2. Check registered surface definition
    const surface = this.surfaces.get(ref.surfaceId);
    if (!surface) {
      if (errors.length === 0) {
        errors.push(`Surface '${ref.surfaceId}' is not registered in HarnessSurfaceRegistry.`);
      }
      return { valid: false, errors, warnings };
    }

    if (ref.capabilityClass !== surface.capabilityClass) {
      errors.push(
        `Capability class mismatch on '${ref.surfaceId}': expected ${surface.capabilityClass}, got ${ref.capabilityClass}.`,
      );
    }

    // 3. Run surface-specific validator
    const surfaceResult = surface.validate(ref.content);
    errors.push(...surfaceResult.errors);
    warnings.push(...surfaceResult.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private registerDefaults(): void {
    // 1. systemPrompt (GUIDANCE)
    this.register({
      id: 'systemPrompt',
      description: 'Core system instructions and invariant operational guidance.',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      requiredTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      allowedCapabilities: ['workspace:read'],
      costModel: { estimatedTokenOverhead: 250, estimatedLatencyOverheadMs: 0 },
      rollbackStrategy: 'SNAPSHOT_RESTORE',
      validate: (val) =>
        typeof val === 'string'
          ? validateWithZod(NonEmptyStringSchema, val)
          : validateWithZod(RecordContentSchema, val),
      materialize: (val, cfg) => ({ ...cfg, systemPromptOverride: val }),
      compare: defaultCompare,
    });

    // 2. guardrails (DECLARATIVE)
    this.register({
      id: 'guardrails',
      description: 'Additive behavioral guardrails and workspace boundary reminders.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['workspace:read'],
      costModel: { estimatedTokenOverhead: 120, estimatedLatencyOverheadMs: 5 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) =>
        typeof val === 'string'
          ? validateWithZod(NonEmptyStringSchema, val)
          : validateWithZod(RecordContentSchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        injectSecurityBoundariesInPrompt: true,
        guardrailsConfig: val,
      }),
      compare: defaultCompare,
    });

    // 3. memoryPolicy (GUIDANCE)
    this.register({
      id: 'memoryPolicy',
      description: 'Memory retrieval, frozen snapshot, and episodic retention guidance.',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      requiredTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      allowedCapabilities: ['memory:read', 'memory:write'],
      costModel: { estimatedTokenOverhead: 100, estimatedLatencyOverheadMs: 5 },
      rollbackStrategy: 'SNAPSHOT_RESTORE',
      validate: (val) =>
        typeof val === 'string'
          ? validateWithZod(NonEmptyStringSchema, val)
          : validateWithZod(RecordContentSchema, val),
      materialize: (val, cfg) => ({ ...cfg, memoryPolicyConfig: val }),
      compare: defaultCompare,
    });

    // 4. toolGuidance (GUIDANCE)
    this.register({
      id: 'toolGuidance',
      description: 'Schema examples, usage heuristics, and error recovery hints for tools.',
      capabilityClass: ComponentCapabilityClass.GUIDANCE,
      requiredTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      allowedCapabilities: ['workspace:read'],
      costModel: { estimatedTokenOverhead: 180, estimatedLatencyOverheadMs: 0 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) =>
        typeof val === 'string'
          ? validateWithZod(NonEmptyStringSchema, val)
          : validateWithZod(RecordContentSchema, val),
      materialize: (val, cfg) => ({ ...cfg, toolGuidanceConfig: val }),
      compare: defaultCompare,
    });

    // 5. subagents (DECLARATIVE)
    this.register({
      id: 'subagents',
      description: 'Declarative subagent role specifications and depth/budget bounds.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['workspace:read', 'workspace:write', 'tool:execute'],
      costModel: { estimatedTokenOverhead: 400, estimatedLatencyOverheadMs: 250 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) => validateWithZod(SubagentItemSchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        subagentDefinitions: [...((cfg['subagentDefinitions'] as unknown[]) ?? []), val],
      }),
      compare: defaultCompare,
    });

    // 6. skills (DECLARATIVE)
    this.register({
      id: 'skills',
      description: 'Reusable procedural skills and domain problem-solving templates.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E1_SINGLE_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      allowedCapabilities: ['workspace:read', 'workspace:write', 'tool:execute'],
      costModel: { estimatedTokenOverhead: 150, estimatedLatencyOverheadMs: 10 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) =>
        typeof val === 'string'
          ? validateWithZod(NonEmptyStringSchema, val)
          : validateWithZod(SkillItemSchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        mountedSkills: [...((cfg['mountedSkills'] as unknown[]) ?? []), val],
      }),
      compare: defaultCompare,
    });

    // 7. scripts (EXECUTABLE)
    this.register({
      id: 'scripts',
      description: 'Sandboxed helper scripts for repository analysis or verification.',
      capabilityClass: ComponentCapabilityClass.EXECUTABLE,
      requiredTaskEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['workspace:read', 'workspace:write', 'tool:execute'],
      costModel: { estimatedTokenOverhead: 100, estimatedLatencyOverheadMs: 150 },
      rollbackStrategy: 'SNAPSHOT_RESTORE',
      validate: (val) => {
        const schemaCheck = validateWithZod(ScriptItemSchema, val);
        if (!schemaCheck.valid) return schemaCheck;
        const parsed = val as z.infer<typeof ScriptItemSchema>;
        const extMap: Record<string, string> = {
          typescript: 'script.ts',
          javascript: 'script.js',
          python: 'script.py',
          json: 'script.json',
          shell: 'script.sh',
        };
        const syntaxGate = new PreWriteSyntaxGate();
        const gateRes = syntaxGate.validate(
          extMap[parsed.language] ?? 'script.ts',
          parsed.sourceCode,
        );
        if (!gateRes.valid) {
          return {
            valid: false,
            errors: [gateRes.error ?? 'Script failed static syntax validation'],
            warnings: [],
          };
        }
        const astVerifier = new ExecutableSurfaceAstVerifier();
        const astRes = astVerifier.verify(parsed.language, parsed.sourceCode);
        if (!astRes.valid) {
          return {
            valid: false,
            errors: [...astRes.violations],
            warnings: [...astRes.warnings],
          };
        }
        return { valid: true, errors: [], warnings: [] };
      },
      materialize: (val, cfg) => ({
        ...cfg,
        registeredScripts: [...((cfg['registeredScripts'] as unknown[]) ?? []), val],
      }),
      compare: defaultCompare,
    });

    // 8. plugins (EXECUTABLE)
    this.register({
      id: 'plugins',
      description: 'Composable capability seam plugins with reversible disposers.',
      capabilityClass: ComponentCapabilityClass.EXECUTABLE,
      requiredTaskEvidenceLevel: EvidenceLevel.E3_VERIFIED,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['workspace:read', 'workspace:write', 'tool:execute'],
      costModel: { estimatedTokenOverhead: 80, estimatedLatencyOverheadMs: 50 },
      rollbackStrategy: 'PLUGIN_DISPOSE',
      validate: (val) => {
        const schemaCheck = validateWithZod(PluginItemSchema, val);
        if (!schemaCheck.valid) return schemaCheck;
        const parsed = val as z.infer<typeof PluginItemSchema>;
        if (parsed.sourceCode) {
          const syntaxGate = new PreWriteSyntaxGate();
          const gateRes = syntaxGate.validate('plugin.ts', parsed.sourceCode);
          if (!gateRes.valid) {
            return {
              valid: false,
              errors: [gateRes.error ?? 'Plugin source failed static syntax validation'],
              warnings: [],
            };
          }
          const astVerifier = new ExecutableSurfaceAstVerifier();
          const astRes = astVerifier.verify('typescript', parsed.sourceCode);
          if (!astRes.valid) {
            return {
              valid: false,
              errors: [...astRes.violations],
              warnings: [...astRes.warnings],
            };
          }
        }
        return { valid: true, errors: [], warnings: [] };
      },
      materialize: (val, cfg) => ({
        ...cfg,
        activePlugins: [...((cfg['activePlugins'] as unknown[]) ?? []), val],
      }),
      compare: defaultCompare,
    });

    // 9. contextPolicy (DECLARATIVE — Vi-Harness Native)
    this.register({
      id: 'contextPolicy',
      description: 'Multi-tier compaction thresholds, prefix caching, and micro-compactor policy.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['context:compile'],
      costModel: { estimatedTokenOverhead: -500, estimatedLatencyOverheadMs: 10 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) => validateWithZod(ContextPolicySchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        ...(val as Record<string, unknown>),
      }),
      compare: defaultCompare,
    });

    // 10. routingPolicy (DECLARATIVE — Vi-Harness Native)
    this.register({
      id: 'routingPolicy',
      description: 'Architect/Editor model routing, reasoning effort, and retry policy.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['model:route'],
      costModel: { estimatedTokenOverhead: 200, estimatedLatencyOverheadMs: 100 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) => validateWithZod(RoutingPolicySchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        ...(val as Record<string, unknown>),
      }),
      compare: defaultCompare,
    });

    // 11. verificationPolicy (DECLARATIVE — Vi-Harness Native)
    this.register({
      id: 'verificationPolicy',
      description: 'Auto-lint, auto-test, TDD gate, and dual-pass adversarial QA policy.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['verification:run'],
      costModel: { estimatedTokenOverhead: 150, estimatedLatencyOverheadMs: 300 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) => validateWithZod(VerificationPolicySchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        ...(val as Record<string, unknown>),
      }),
      compare: defaultCompare,
    });

    // 12. toolSchedulingPolicy (DECLARATIVE — Vi-Harness Native)
    this.register({
      id: 'toolSchedulingPolicy',
      description: 'Parallel tool concurrency, output spill thresholds, and repeat-guard bounds.',
      capabilityClass: ComponentCapabilityClass.DECLARATIVE,
      requiredTaskEvidenceLevel: EvidenceLevel.E2_REPLICATED_CONTRAST,
      requiredPromotionEvidenceLevel: EvidenceLevel.E4_GENERALIZATION,
      allowedCapabilities: ['tool:schedule'],
      costModel: { estimatedTokenOverhead: 0, estimatedLatencyOverheadMs: -50 },
      rollbackStrategy: 'CONFIG_REVERT',
      validate: (val) => validateWithZod(ToolSchedulingPolicySchema, val),
      materialize: (val, cfg) => ({
        ...cfg,
        ...(val as Record<string, unknown>),
      }),
      compare: defaultCompare,
    });
  }
}
