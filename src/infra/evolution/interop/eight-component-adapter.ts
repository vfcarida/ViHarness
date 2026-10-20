/**
 * Clean-Room Eight-Component Tree Interoperability Adapter (Harness² Interop).
 *
 * Translates between an external conceptual 8-component tree:
 *   1. systemPrompt
 *   2. guardrails
 *   3. memory
 *   4. toolGuidance
 *   5. subagents
 *   6. skills
 *   7. scripts
 *   8. plugins
 * and a ViHarness-native `HarnessManifest`.
 *
 * Security Invariant:
 * Importing an external component tree NEVER bypasses ViHarness's zero-trust
 * security constitution, sandbox confinement, network egress restriction, or
 * PreWriteSyntaxGate validation.
 */
import { HarnessError } from '../../../core/errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../../../core/errors/error-codes.js';
import {
  ComponentCapabilityClass,
  ConstitutionValidator,
  DEFAULT_HARNESS_CONSTITUTION,
  type HarnessConstitution,
} from '../../../core/evolution/constitution.js';
import type {
  HarnessManifest,
  HarnessTargetProfile,
} from '../../../core/evolution/harness-manifest.js';
import { HarnessManifestToolkit } from '../manifest-toolkit.js';

export interface ExternalEightComponentTree {
  readonly id?: string;
  readonly schemaVersion?: string;
  readonly systemPrompt: {
    readonly template: string;
    readonly maxTokens?: number;
  };
  readonly guardrails: {
    readonly maxIterations?: number;
    readonly requireVerificationBeforeDone?: boolean;
    readonly disallowDestructiveCommands?: boolean;
  };
  readonly memory: {
    readonly enableFrozenSnapshot?: boolean;
    readonly maxRetrievedRecords?: number;
    readonly extractFailureLessons?: boolean;
  };
  readonly toolGuidance: {
    readonly preferParallelReads?: boolean;
    readonly spillThresholdBytes?: number;
    readonly guidanceNotes?: string;
  };
  readonly subagents?: ReadonlyArray<{
    readonly name: string;
    readonly role: string;
    readonly maxDepth?: number;
    readonly allowedTools: ReadonlyArray<string>;
  }>;
  readonly skills?: ReadonlyArray<{
    readonly name: string;
    readonly triggerCondition: string;
    readonly instructions: string;
  }>;
  readonly scripts?: ReadonlyArray<{
    readonly name: string;
    readonly language: 'typescript' | 'javascript' | 'python' | 'json' | 'shell';
    readonly sourceCode: string;
    readonly timeoutMs?: number;
  }>;
  readonly plugins?: ReadonlyArray<{
    readonly pluginId: string;
    readonly hookTarget: 'before_tool' | 'after_tool' | 'context_compile' | 'verify';
    readonly config?: Readonly<Record<string, unknown>>;
    readonly reversible?: boolean;
  }>;
  /**
   * Optional untrusted execution flags from external substrates (e.g., disabled sandbox
   * or unrestricted network). These are explicitly inspected and rejected/sanitized.
   */
  readonly requestedExecutionFlags?: {
    readonly disableSandbox?: boolean;
    readonly unrestrictedNetwork?: boolean;
  };
}

export class EightComponentAdapter {
  private readonly toolkit: HarnessManifestToolkit;
  private readonly constitution: HarnessConstitution;

  constructor(options?: {
    readonly toolkit?: HarnessManifestToolkit;
    readonly constitution?: HarnessConstitution;
  }) {
    this.constitution = options?.constitution ?? DEFAULT_HARNESS_CONSTITUTION;
    this.toolkit =
      options?.toolkit ??
      new HarnessManifestToolkit({ constitution: this.constitution });
  }

  /**
   * Exports a ViHarness `HarnessManifest` to a portable 8-component tree.
   */
  exportTree(manifest: HarnessManifest): ExternalEightComponentTree {
    const c = manifest.components;
    const sysContent = c.systemPrompt.content;
    const toolContent = c.toolGuidance.content;
    return {
      id: String(manifest.id),
      schemaVersion: manifest.schemaVersion,
      systemPrompt:
        typeof sysContent === 'string'
          ? { template: sysContent, maxTokens: 4096 }
          : (sysContent as ExternalEightComponentTree['systemPrompt']),
      guardrails: c.guardrails.content as ExternalEightComponentTree['guardrails'],
      memory: c.memoryPolicy.content as ExternalEightComponentTree['memory'],
      toolGuidance:
        typeof toolContent === 'string'
          ? { preferParallelReads: true, spillThresholdBytes: 32768, guidanceNotes: toolContent }
          : (toolContent as ExternalEightComponentTree['toolGuidance']),
      subagents: c.subagents.map(
        (s) => s.content as NonNullable<ExternalEightComponentTree['subagents']>[number],
      ),
      skills: c.skills.map((s) => {
        const content = s.content as Record<string, unknown>;
        return {
          name: String(content['name'] ?? s.id),
          triggerCondition: String(
            content['triggerCondition'] ??
              (Array.isArray(content['triggers']) ? content['triggers'][0] : 'always'),
          ),
          instructions: String(content['instructions'] ?? content),
        };
      }),
      scripts: c.scripts.map(
        (s) => s.content as NonNullable<ExternalEightComponentTree['scripts']>[number],
      ),
      plugins: c.plugins.map((p) => {
        const content = p.content as Record<string, unknown>;
        const cfg = (content['config'] as Record<string, unknown>) ?? {};
        return {
          pluginId: String(content['name'] ?? content['pluginId'] ?? p.id),
          hookTarget: (cfg['hookTarget'] as 'before_tool' | 'after_tool' | 'context_compile' | 'verify') ?? 'before_tool',
          config: cfg,
          reversible: Boolean(cfg['reversible'] ?? true),
        };
      }),
    };
  }

  /**
   * Imports an external 8-component tree into a frozen, validated `HarnessManifest`.
   * Rejects any attempt to disable sandboxing, open unrestricted network egress,
   * or inject constitutional bypass directives.
   */
  importTree(
    tree: ExternalEightComponentTree,
    target?: Partial<HarnessTargetProfile>,
  ): HarnessManifest {
    if (
      tree.requestedExecutionFlags?.disableSandbox === true ||
      tree.requestedExecutionFlags?.unrestrictedNetwork === true
    ) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
        category: ErrorCategory.EVOLUTION,
        message:
          'Imported component tree requested disabled sandbox or unrestricted network egress, which is forbidden by the ViHarness Constitution.',
      });
    }

    const directiveCheck = ConstitutionValidator.validateDirectivePayload(
      JSON.stringify(tree),
    );
    if (!directiveCheck.valid) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_CONSTITUTION_VIOLATION,
        category: ErrorCategory.EVOLUTION,
        message: `Imported component tree violated constitutional directives: ${directiveCheck.violations.join('; ')}`,
      });
    }

    const base = this.toolkit.createCanonicalBaseline({
      id: tree.id ?? `h_imported_${Date.now()}`,
      target,
    });

    const imported = this.toolkit.cloneWithOverrides(base, {
      newId: tree.id ?? `h_imported_${Date.now()}`,
      author: 'human_operator',
      components: {
        systemPrompt: this.toolkit.createComponentRef(
          'systemPrompt',
          ComponentCapabilityClass.GUIDANCE,
          {
            template: tree.systemPrompt.template,
            maxTokens: tree.systemPrompt.maxTokens ?? 4096,
          },
        ),
        guardrails: this.toolkit.createComponentRef(
          'guardrails',
          ComponentCapabilityClass.DECLARATIVE,
          {
            maxIterations: tree.guardrails.maxIterations ?? 25,
            requireVerificationBeforeDone:
              tree.guardrails.requireVerificationBeforeDone ?? true,
            disallowDestructiveCommands:
              tree.guardrails.disallowDestructiveCommands ?? true,
          },
        ),
        memoryPolicy: this.toolkit.createComponentRef(
          'memoryPolicy',
          ComponentCapabilityClass.GUIDANCE,
          {
            enableFrozenSnapshot: tree.memory.enableFrozenSnapshot ?? true,
            maxRetrievedRecords: tree.memory.maxRetrievedRecords ?? 10,
            extractFailureLessons: tree.memory.extractFailureLessons ?? true,
          },
        ),
        toolGuidance: this.toolkit.createComponentRef(
          'toolGuidance',
          ComponentCapabilityClass.GUIDANCE,
          {
            preferParallelReads: tree.toolGuidance.preferParallelReads ?? true,
            spillThresholdBytes: tree.toolGuidance.spillThresholdBytes ?? 32768,
            guidanceNotes:
              tree.toolGuidance.guidanceNotes ??
              'Prefer read-only inspection before mutation.',
          },
        ),
        subagents: (tree.subagents ?? []).map((sub, idx) =>
          this.toolkit.createComponentRef(
            `subagents:${idx}`,
            ComponentCapabilityClass.DECLARATIVE,
            {
              name: sub.name,
              role: sub.role,
              maxDepth: sub.maxDepth ?? 2,
              allowedTools: [...sub.allowedTools],
            },
          ),
        ),
        skills: (tree.skills ?? []).map((sk, idx) =>
          this.toolkit.createComponentRef(
            `skills:${idx}`,
            ComponentCapabilityClass.DECLARATIVE,
            {
              name: sk.name,
              description: `Skill triggered on ${sk.triggerCondition}`,
              instructions: sk.instructions,
              triggers: [sk.triggerCondition],
            },
          ),
        ),
        scripts: (tree.scripts ?? []).map((sc, idx) =>
          this.toolkit.createComponentRef(
            `scripts:${idx}`,
            ComponentCapabilityClass.EXECUTABLE,
            {
              name: sc.name,
              language: sc.language,
              sourceCode: sc.sourceCode,
              timeoutMs: sc.timeoutMs ?? 10000,
            },
          ),
        ),
        plugins: (tree.plugins ?? []).map((pl, idx) =>
          this.toolkit.createComponentRef(
            `plugins:${idx}`,
            ComponentCapabilityClass.EXECUTABLE,
            {
              name: pl.pluginId,
              version: '1.0.0',
              config: {
                ...(pl.config ?? {}),
                hookTarget: pl.hookTarget,
                reversible: pl.reversible ?? true,
              },
            },
          ),
        ),
      },
    });

    const validation = this.toolkit.validate(imported);
    if (!validation.valid) {
      throw new HarnessError({
        code: ErrorCode.EVOLUTION_MANIFEST_INVALID,
        category: ErrorCategory.EVOLUTION,
        message: `Imported component tree failed ViHarness validation: ${validation.errors.join('; ')}`,
      });
    }

    return imported;
  }
}
