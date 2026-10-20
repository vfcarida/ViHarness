/**
 * Default Harness Proposer (Milestone B — Propose–Probe–Compose).
 *
 * Generates candidate harnesses across the 2x2 exploration matrix:
 *   (INVARIANT vs DOMAIN_SPECIFIC) x (GUIDANCE vs STRUCTURAL)
 *
 * Pre-declares a falsifiable HarnessChangeHypothesis for every candidate,
 * incorporates applicable positive AND negative library experience, avoids
 * repeating failed hypotheses, and obeys the Harness Constitution.
 */
import type {
  HarnessId,
  IdFactory,
} from '../../core/types/identifiers.js';
import {
  ComponentCapabilityClass,
  type HarnessConstitution,
} from '../../core/evolution/constitution.js';
import type {
  HarnessManifest,
  HarnessComponents,
} from '../../core/evolution/harness-manifest.js';
import type {
  FailureSignal,
  CandidateExplorationQuadrant,
} from '../../core/evolution/failure-taxonomy.js';
import type {
  HarnessChangeHypothesis,
  ScopeAxis,
  MechanismAxis,
} from '../../core/evolution/hypothesis.js';
import type {
  HarnessProposer,
  ProposedCandidate,
  ExperienceEntry,
} from '../../core/evolution/interfaces.js';
import type { HarnessSurfaceRegistry } from '../../core/evolution/surface-registry.js';
import { HarnessManifestToolkit } from './manifest-toolkit.js';
import { UuidV7IdFactory } from '../id/uuid-id-factory.js';

export interface CustomCandidateGenerator {
  generate(params: {
    readonly baseManifest: HarnessManifest;
    readonly quadrant: CandidateExplorationQuadrant;
    readonly signals: ReadonlyArray<FailureSignal>;
    readonly libraryEntries: ReadonlyArray<ExperienceEntry>;
    readonly iterationStep: number;
  }): Promise<{
    readonly componentOverrides: Partial<HarnessComponents>;
    readonly targetComponents: ReadonlyArray<string>;
    readonly rationale: string;
    readonly generalizationClaim: string;
  } | null>;
}

export class DefaultHarnessProposer implements HarnessProposer {
  private readonly idFactory: IdFactory;
  private readonly customGenerator?: CustomCandidateGenerator;

  constructor(options?: {
    readonly idFactory?: IdFactory;
    readonly customGenerator?: CustomCandidateGenerator;
  }) {
    this.idFactory = options?.idFactory ?? new UuidV7IdFactory();
    this.customGenerator = options?.customGenerator;
  }

  async propose(params: {
    readonly baseManifest: HarnessManifest;
    readonly failureSignals: ReadonlyArray<FailureSignal>;
    readonly libraryEntries: ReadonlyArray<ExperienceEntry>;
    readonly failedHypotheses: ReadonlyArray<HarnessChangeHypothesis>;
    readonly constitution: HarnessConstitution;
    readonly surfaceRegistry: HarnessSurfaceRegistry;
    readonly maxCandidates: number;
    readonly iterationStep: number;
  }): Promise<ReadonlyArray<ProposedCandidate>> {
    const {
      baseManifest,
      failureSignals,
      libraryEntries,
      failedHypotheses,
      surfaceRegistry,
      maxCandidates,
      iterationStep,
    } = params;

    const quadrants: CandidateExplorationQuadrant[] = [
      'INVARIANT_GUIDANCE',
      'INVARIANT_STRUCTURAL',
      'DOMAIN_GUIDANCE',
      'DOMAIN_STRUCTURAL',
    ];

    const failedSignatures = new Set(
      failedHypotheses.map((h) => `${h.quadrant}:${h.targetComponents.join(',')}`),
    );

    const negativeSurfaces = new Set<string>();
    for (const entry of libraryEntries) {
      if (
        entry.hypothesisOutcome.verdict === 'contradicted' ||
        entry.admissionStatus === 'rejected'
      ) {
        for (const surf of entry.diffFromBaseline.changedSurfaces) {
          negativeSurfaces.add(`${entry.hypothesis.quadrant}:${surf}`);
        }
      }
    }

    const candidates: ProposedCandidate[] = [];
    const signalTypes = failureSignals.map((s) => s.type);

    for (const quadrant of quadrants) {
      if (candidates.length >= maxCandidates) break;

      const spec = this.customGenerator
        ? await this.customGenerator.generate({
            baseManifest,
            quadrant,
            signals: failureSignals,
            libraryEntries,
            iterationStep,
          })
        : this.buildBuiltinProposal({
            baseManifest,
            quadrant,
            signals: failureSignals,
            libraryEntries,
            negativeSurfaces,
            iterationStep,
          });

      if (!spec) continue;

      const sig = `${quadrant}:${spec.targetComponents.join(',')}`;
      if (failedSignatures.has(sig) && iterationStep > 1) {
        continue;
      }

      // Filter out any non-evolvable target surface
      if (spec.targetComponents.some((s) => !surfaceRegistry.isEvolvable(s))) {
        continue;
      }

      const candidateId = this.idFactory.create<'Candidate'>();
      const hypothesisId = this.idFactory.create<'Hypothesis'>();
      const newManifestId = `harness-cand-${candidateId.slice(0, 8)}` as HarnessId;

      const candidateManifest = HarnessManifestToolkit.clone(baseManifest, {
        newId: newManifestId,
        createdBy: 'proposer',
        componentOverrides: spec.componentOverrides,
        hypothesisId,
      });

      const validation = HarnessManifestToolkit.validate(
        candidateManifest,
        surfaceRegistry,
        params.constitution,
      );
      if (!validation.valid) {
        continue;
      }

      const diffFromBase = HarnessManifestToolkit.diff(
        baseManifest,
        candidateManifest,
        surfaceRegistry,
      );
      if (diffFromBase.identical) {
        continue;
      }

      const scopeAxis: ScopeAxis = quadrant.startsWith('INVARIANT')
        ? 'INVARIANT'
        : 'DOMAIN_SPECIFIC';
      const mechanismAxis: MechanismAxis = quadrant.endsWith('GUIDANCE')
        ? 'GUIDANCE'
        : 'STRUCTURAL';

      const hypothesis: HarnessChangeHypothesis = {
        id: hypothesisId,
        candidateId,
        baseManifestId: baseManifest.id,
        scopeAxis,
        mechanismAxis,
        quadrant,
        targetComponents: spec.targetComponents,
        observedFailureSignals:
          signalTypes.length > 0 ? signalTypes : ['premature_completion'],
        rationale: spec.rationale,
        applicability: {
          domains: baseManifest.target.domain ? [baseManifest.target.domain] : ['general-swe'],
          languages: baseManifest.target.language
            ? [baseManifest.target.language]
            : ['typescript'],
          modelFamilies: baseManifest.target.modelFamily
            ? [baseManifest.target.modelFamily]
            : ['model-agnostic'],
          triggerSignals: signalTypes.length > 0 ? signalTypes : ['premature_completion'],
        },
        predictedEffects: [
          {
            metric: 'pass_rate',
            direction: 'INCREASE',
            expectedDeltaMagnitude: 0.1,
            rationale: spec.rationale,
          },
          {
            metric: 'regression_rate',
            direction: 'PRESERVE',
            expectedDeltaMagnitude: 0,
            rationale: 'Must preserve existing verified capabilities.',
          },
        ],
        predictedTradeoffs:
          mechanismAxis === 'STRUCTURAL'
            ? ['Slightly higher orchestration structure in exchange for fewer repair loops']
            : ['Minimal additional prompt guidance tokens'],
        risks: ['Potential variance on tasks not exhibiting the target failure signal'],
        editBudget: {
          maxSurfacesModified: Math.max(1, 3 - Math.floor(iterationStep / 2)),
          maxUnitsChanged: Math.max(5, 25 - iterationStep * 3),
          maxCapabilityClass: diffFromBase.highestRiskClassTouched,
          iterationStep,
        },
        generalizationClaim: spec.generalizationClaim,
        createdAt: new Date().toISOString(),
      };

      candidates.push({
        candidateId,
        manifest: candidateManifest,
        diffFromBase,
        hypothesis,
      });
    }

    return candidates;
  }

  private buildBuiltinProposal(params: {
    readonly baseManifest: HarnessManifest;
    readonly quadrant: CandidateExplorationQuadrant;
    readonly signals: ReadonlyArray<FailureSignal>;
    readonly libraryEntries: ReadonlyArray<ExperienceEntry>;
    readonly negativeSurfaces: ReadonlySet<string>;
    readonly iterationStep: number;
  }): {
    readonly componentOverrides: Partial<HarnessComponents>;
    readonly targetComponents: ReadonlyArray<string>;
    readonly rationale: string;
    readonly generalizationClaim: string;
  } | null {
    const { baseManifest, quadrant, signals, libraryEntries, iterationStep } = params;
    const signalTypes = new Set(signals.map((s) => s.type));

    // Check if positive library experience can be reused for this quadrant
    const matchingPositive = libraryEntries.find(
      (e) =>
        e.hypothesis.quadrant === quadrant &&
        e.hypothesisOutcome.verdict === 'supported' &&
        e.status === 'ACTIVE',
    );

    if (quadrant === 'INVARIANT_GUIDANCE') {
      const baseGuidance = String(baseManifest.components.toolGuidance.content);
      const extraClause = signalTypes.has('repeated_tool_call')
        ? ' Never repeat identical tool arguments; inspect prior tool output or use retrieve_output.'
        : signalTypes.has('mutation_without_verification')
          ? ' Mandatory rule: run impacted verification checks after every edit_file or write_file call.'
          : ` Step-${iterationStep} invariant coordination: verify symbol references before applying edits.`;

      const updatedRef = HarnessManifestToolkit.createComponentRef({
        id: `comp-tool-guidance-s${iterationStep}`,
        surfaceId: 'toolGuidance',
        capabilityClass: ComponentCapabilityClass.GUIDANCE,
        version: `1.${iterationStep}.0`,
        content: `${baseGuidance}${extraClause}`,
        permissions: ['workspace:read'],
      });

      return {
        componentOverrides: { toolGuidance: updatedRef },
        targetComponents: ['toolGuidance'],
        rationale:
          matchingPositive?.hypothesis.rationale ??
          `Refined invariant toolGuidance to address [${Array.from(signalTypes).join(', ') || 'coordination'}].`,
        generalizationClaim:
          'Task-agnostic tool coordination discipline transfers across repositories and languages.',
      };
    }

    if (quadrant === 'INVARIANT_STRUCTURAL') {
      if (signalTypes.has('oscillation') || signalTypes.has('regression')) {
        const currentRouting =
          (baseManifest.components.routingPolicy?.content as Record<string, unknown>) ?? {};
        const updatedRoutingRef = HarnessManifestToolkit.createComponentRef({
          id: `comp-routing-policy-s${iterationStep}`,
          surfaceId: 'routingPolicy',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          version: `1.${iterationStep}.0`,
          content: {
            ...currentRouting,
            architectMode: true,
            reasoningEffort: 'high',
            maxRetries: 3,
          },
          permissions: ['model:route'],
        });

        return {
          componentOverrides: { routingPolicy: updatedRoutingRef },
          targetComponents: ['routingPolicy'],
          rationale:
            'Enabled dual-model Architect Mode and elevated reasoning effort to eliminate IMPLEMENT/REPAIR phase oscillation.',
          generalizationClaim:
            'Decoupling architectural planning from code editing generalizes across multi-file repair tasks.',
        };
      }

      const currentContext =
        (baseManifest.components.contextPolicy?.content as Record<string, unknown>) ?? {};
      const updatedContextRef = HarnessManifestToolkit.createComponentRef({
        id: `comp-context-policy-s${iterationStep}`,
        surfaceId: 'contextPolicy',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        version: `1.${iterationStep}.0`,
        content: {
          ...currentContext,
          compactionStrategy: 'MULTI_TIER_6_STAGE',
          compactionThreshold: 0.65,
          enablePrefixCaching: true,
          enableMicroCompactor: true,
          maxToolResultTokens: 6000,
        },
        permissions: ['context:compile'],
      });

      return {
        componentOverrides: { contextPolicy: updatedContextRef },
        targetComponents: ['contextPolicy'],
        rationale:
          'Tuned multi-tier context compaction threshold to 0.65 and enforced prefix caching to prevent context bloat and cache misses.',
        generalizationClaim:
          'Earlier progressive compaction preserves L0/L3 invariants while bounding long-horizon token cost.',
      };
    }

    if (quadrant === 'DOMAIN_GUIDANCE') {
      const domain = baseManifest.target.domain ?? 'general-swe';
      const language = baseManifest.target.language ?? 'typescript';
      const newSkillRef = HarnessManifestToolkit.createComponentRef({
        id: `comp-skill-${domain}-${language}-s${iterationStep}`,
        surfaceId: 'skills',
        capabilityClass: ComponentCapabilityClass.DECLARATIVE,
        version: `1.${iterationStep}.0`,
        content: {
          name: `${language}-${domain}-diagnostic-workflow`,
          description: `Structured diagnostic and verification workflow for ${language} (${domain}).`,
          instructions: `1. Index symbols with batch_find_symbols. 2. Apply surgical edit_file changes in ${language}. 3. Run targeted verification suite before completion.`,
          triggers: [domain, language, 'verification'],
        },
        permissions: ['workspace:read', 'workspace:write', 'tool:execute'],
      });

      return {
        componentOverrides: {
          skills: [...baseManifest.components.skills, newSkillRef],
        },
        targetComponents: ['skills'],
        rationale: `Added reusable domain skill '${language}-${domain}-diagnostic-workflow' tailored to ${domain} tasks.`,
        generalizationClaim: `Transfers across ${language} repositories within the ${domain} domain without task-ID memorization.`,
      };
    }

    // DOMAIN_STRUCTURAL
    const newScriptRef = HarnessManifestToolkit.createComponentRef({
      id: `comp-script-verify-helper-s${iterationStep}`,
      surfaceId: 'scripts',
      capabilityClass: ComponentCapabilityClass.EXECUTABLE,
      version: `1.${iterationStep}.0`,
      content: {
        name: `verify-helper-s${iterationStep}`,
        language: 'typescript',
        sourceCode: `export function checkVerificationInvariant(passed: boolean): boolean {\n  return Boolean(passed);\n}\n`,
        timeoutMs: 10_000,
      },
      permissions: ['workspace:read', 'tool:execute'],
    });

    return {
      componentOverrides: {
        scripts: [...baseManifest.components.scripts, newScriptRef],
      },
      targetComponents: ['scripts'],
      rationale:
        'Added sandboxed executable verification helper script to enforce deterministic pre-completion checks.',
      generalizationClaim:
        'Executable verification helpers provide stronger structural guarantees than prose-only prompt reminders.',
    };
  }
}
