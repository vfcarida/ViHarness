/**
 * Wave 9.5 — Semantic Skill & Subagent Graph Distillation (`SkillSubagentDistiller`).
 *
 * Distills recurring, high-confidence failure-resolution patterns from `ExperienceEntry`
 * records into validated, least-privilege declarative `ComponentRef` items for the
 * `skills` and `subagents` array surfaces of `HarnessManifest`.
 */
import { createId } from '../../core/types/identifiers.js';
import { ComponentCapabilityClass } from '../../core/evolution/constitution.js';
import type {
  ComponentRef,
  HarnessManifest,
} from '../../core/evolution/harness-manifest.js';
import type { ExperienceEntry } from '../../core/evolution/interfaces.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';

export interface DistilledSkillSpec {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly triggers: ReadonlyArray<string>;
  readonly sourceExperienceIds: ReadonlyArray<string>;
}

export interface DistilledSubagentSpec {
  readonly name: string;
  readonly role: string;
  readonly maxDepth: number;
  readonly maxTokenBudget: number;
  readonly allowedTools: ReadonlyArray<string>;
  readonly sourceExperienceIds: ReadonlyArray<string>;
}

export interface SkillSubagentDistillationResult {
  readonly distilledSkills: ReadonlyArray<ComponentRef>;
  readonly distilledSubagents: ReadonlyArray<ComponentRef>;
  readonly enrichedManifest: HarnessManifest;
  readonly rationale: string;
}

export class SkillSubagentDistiller {
  private readonly minConfidence: number;

  constructor(options?: { readonly minConfidence?: number }) {
    this.minConfidence = options?.minConfidence ?? 0.65;
  }

  /**
   * Distills declarative `skills` and least-privilege `subagents` from supported
   * `ExperienceEntry` memories and injects them into `baseManifest`.
   */
  distillAndEnrichManifest(params: {
    readonly baseManifest: HarnessManifest;
    readonly experiences: ReadonlyArray<ExperienceEntry>;
    readonly maxNewSkills?: number;
    readonly maxNewSubagents?: number;
  }): SkillSubagentDistillationResult {
    const maxSkills = params.maxNewSkills ?? 2;
    const maxSubagents = params.maxNewSubagents ?? 1;

    const eligible = params.experiences.filter(
      (e) =>
        e.status === 'ACTIVE' &&
        e.hypothesisOutcome.verdict === 'supported' &&
        e.confidence >= this.minConfidence,
    );

    const existingSkillIds = new Set(
      params.baseManifest.components.skills.map((s) => s.id),
    );
    const existingSubagentIds = new Set(
      params.baseManifest.components.subagents.map((s) => s.id),
    );

    const distilledSkills: ComponentRef[] = [];
    const distilledSubagents: ComponentRef[] = [];

    for (const exp of eligible) {
      const primarySignal =
        exp.motivatingFailureSignals[0] ?? 'plan_execution_mismatch';
      const skillId = `comp-skill-distilled-${primarySignal.replace(/[^a-z0-9]+/gi, '-')}`;

      if (
        distilledSkills.length < maxSkills &&
        !existingSkillIds.has(skillId)
      ) {
        existingSkillIds.add(skillId);
        distilledSkills.push(
          HarnessManifestToolkit.createComponentRef({
            id: skillId,
            surfaceId: 'skills',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              name: `distilled-${primarySignal}-guard`,
              description: `Auto-distilled remediation workflow for '${primarySignal}' (${exp.hypothesis.generalizationClaim}).`,
              instructions:
                `1. Diagnose '${primarySignal}' indicators before mutating files.\n` +
                `2. Apply ${exp.hypothesis.rationale}\n` +
                `3. Execute targeted verification before concluding the turn.`,
              triggers: [...exp.motivatingFailureSignals],
            },
            permissions: ['workspace:read', 'workspace:write', 'tool:execute'],
          }),
        );
      }

      const subagentId = `comp-subagent-distilled-${primarySignal.replace(/[^a-z0-9]+/gi, '-')}`;
      if (
        distilledSubagents.length < maxSubagents &&
        !existingSubagentIds.has(subagentId)
      ) {
        existingSubagentIds.add(subagentId);
        const isVerificationFocused =
          primarySignal.includes('verification') ||
          primarySignal.includes('test') ||
          primarySignal.includes('regression');
        distilledSubagents.push(
          HarnessManifestToolkit.createComponentRef({
            id: subagentId,
            surfaceId: 'subagents',
            capabilityClass: ComponentCapabilityClass.DECLARATIVE,
            content: {
              name: `specialist-${primarySignal.replace(/_/g, '-')}`,
              role: isVerificationFocused ? 'VERIFIER_AUDITOR' : 'DIAGNOSTIC_SCOUT',
              maxDepth: 2,
              maxTokenBudget: 12000,
              allowedTools: isVerificationFocused
                ? ['read_file', 'search_code', 'run_command']
                : ['read_file', 'search_code', 'batch_find_symbols'],
            },
            permissions: ['workspace:read', 'tool:execute'],
          }),
        );
      }
    }

    if (distilledSkills.length === 0 && distilledSubagents.length === 0) {
      return {
        distilledSkills: [],
        distilledSubagents: [],
        enrichedManifest: params.baseManifest,
        rationale: 'No new high-confidence experience patterns eligible for distillation.',
      };
    }

    const enrichedManifest = HarnessManifestToolkit.clone(params.baseManifest, {
      newId: createId<'Harness'>(`${params.baseManifest.id}-distilled`),
      createdBy: 'composer',
      componentOverrides: {
        skills: [...params.baseManifest.components.skills, ...distilledSkills],
        subagents: [
          ...params.baseManifest.components.subagents,
          ...distilledSubagents,
        ],
      },
    });

    return {
      distilledSkills,
      distilledSubagents,
      enrichedManifest,
      rationale: `Distilled ${distilledSkills.length} declarative skill(s) and ${distilledSubagents.length} least-privilege subagent(s) into '${enrichedManifest.id}'.`,
    };
  }
}
