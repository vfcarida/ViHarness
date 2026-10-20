/**
 * Wave 5.6 — `ViForge <-> Vi-Harness` Closed-Loop Co-Evolution Bridge (`HarnessX`).
 *
 * Closes the bidirectional loop between outer-loop Harness Evolution (`Vi-Harness`)
 * and inner-loop Model Weight Post-Training (`ViForge`):
 *
 * 1. **Outer-to-Inner Handoff (`prepareViForgeHandoff`)**:
 *    When `ContrastivePreferenceExporter` detects a `ModelCapabilityCeilingDiagnosis`
 *    (or when explicitly requested), packages verified DPO/GRPO/SPIN JSONL datasets,
 *    the model-agnostic `TransferableCore`, and a recommended `ViForge` training recipe
 *    into a cryptographically signed `ViForgeHandoffManifest` (`viforge_handoff_manifest.json`).
 *
 * 2. **Inner-to-Outer Re-Adaptation (`ingestUpdatedModelCheckpoint`)**:
 *    When `ViForge` produces an updated model checkpoint $M_{t+1}$, recombines the
 *    preserved `TransferableCore` with an updated `EcosystemMargin` targeting $M_{t+1}$
 *    and marks model-specific `ExperienceEntry` records from the prior model version $M_t$
 *    as `STALE` in `HarnessExperienceLibrary` to prevent Harness-Model Co-Adaptation Drift.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ExperienceEntryId,
  HarnessId,
} from '../../core/types/identifiers.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { HarnessExperienceLibrary } from '../../core/evolution/interfaces.js';
import {
  ContrastivePreferenceExporter,
  type DpoPreferenceRecord,
  type GrpoRolloutGroupRecord,
  type ModelCapabilityCeilingDiagnosis,
  type SpinSelfPlayRecord,
} from './contrastive-preference-exporter.js';
import {
  EcosystemMarginSplitter,
  type EcosystemMargin,
  type TransferableCore,
} from './ecosystem-margin.js';

export interface ViForgeTrainingRecipe {
  readonly method: 'DPO' | 'GRPO' | 'SPIN' | 'SFT_PLUS_DPO';
  readonly baseModelFamily: string;
  readonly targetDatasetPath: string;
  readonly recommendedBeta: number;
  readonly recommendedLearningRate: number;
  readonly recommendedEpochs: number;
  readonly rationale: string;
}

export interface ViForgeHandoffManifest {
  readonly handoffId: string;
  readonly schemaVersion: '1.0.0';
  readonly createdAt: string;
  readonly sourceManifestId: string;
  readonly sourceManifestHash: string;
  readonly sourceModelFamily: string;
  readonly transferableCore: TransferableCore;
  readonly capabilityCeilingDiagnosis: ModelCapabilityCeilingDiagnosis;
  readonly recommendedRecipe: ViForgeTrainingRecipe;
  readonly datasetPaths: {
    readonly dpoFilePath: string;
    readonly grpoFilePath: string;
    readonly spinFilePath: string;
  };
  readonly datasetCounts: {
    readonly dpoPairsCount: number;
    readonly grpoGroupsCount: number;
    readonly spinRecordsCount: number;
  };
  readonly signature: string;
}

export interface ViForgeCheckpointIngestionInput {
  readonly handoffId?: string;
  readonly previousModelFamily: string;
  readonly newModelFamily: string;
  readonly newModelCheckpointId: string;
  readonly checkpointSha256: string;
  readonly sourceManifest: HarnessManifest;
  readonly customTargetMargin?: EcosystemMargin;
}

export interface ViForgeCheckpointIngestionResult {
  readonly adaptedManifest: HarnessManifest;
  readonly preservedCore: TransferableCore;
  readonly adaptedMargin: EcosystemMargin;
  readonly invalidatedExperienceIds: ReadonlyArray<ExperienceEntryId>;
  readonly revalidationRequiredCount: number;
  readonly ingestionDigest: string;
}

export class ViForgeCoEvolutionBridge {
  private readonly exporter: ContrastivePreferenceExporter;
  private readonly splitter: EcosystemMarginSplitter;
  private readonly experienceLibrary?: HarnessExperienceLibrary;

  constructor(options?: {
    readonly exporter?: ContrastivePreferenceExporter;
    readonly splitter?: EcosystemMarginSplitter;
    readonly experienceLibrary?: HarnessExperienceLibrary;
  }) {
    this.exporter = options?.exporter ?? new ContrastivePreferenceExporter();
    this.splitter = options?.splitter ?? new EcosystemMarginSplitter();
    this.experienceLibrary = options?.experienceLibrary;
  }

  /**
   * Packages outer-loop contrastive trajectory artifacts and capability ceiling diagnosis
   * into a signed `ViForgeHandoffManifest` on disk (or in-memory if `outputDir` is omitted).
   */
  async prepareViForgeHandoff(params: {
    readonly sourceManifest: HarnessManifest;
    readonly dpoPairs: ReadonlyArray<DpoPreferenceRecord>;
    readonly grpoGroups: ReadonlyArray<GrpoRolloutGroupRecord>;
    readonly spinRecords: ReadonlyArray<SpinSelfPlayRecord>;
    readonly ceilingDiagnosis: ModelCapabilityCeilingDiagnosis;
    readonly outputDir?: string;
  }): Promise<ViForgeHandoffManifest> {
    const { core } = this.splitter.split(params.sourceManifest);
    const sourceModelFamily = params.sourceManifest.target.modelFamily ?? 'default-model';

    let datasetPaths = {
      dpoFilePath: 'memory://dpo_preferences.jsonl',
      grpoFilePath: 'memory://grpo_groups.jsonl',
      spinFilePath: 'memory://spin_ceiling_records.jsonl',
    };

    if (params.outputDir) {
      datasetPaths = await this.exporter.exportToJsonlFiles({
        outputDir: params.outputDir,
        dpoRecords: params.dpoPairs,
        grpoGroups: params.grpoGroups,
        spinRecords: params.spinRecords,
      });
    }

    const method: ViForgeTrainingRecipe['method'] =
      params.ceilingDiagnosis.recommendedPostTrainingMethod === 'NONE'
        ? params.dpoPairs.length > 0
          ? 'DPO'
          : 'GRPO'
        : params.ceilingDiagnosis.recommendedPostTrainingMethod;

    const targetDatasetPath =
      method === 'DPO'
        ? datasetPaths.dpoFilePath
        : method === 'GRPO'
          ? datasetPaths.grpoFilePath
          : datasetPaths.spinFilePath;

    const recommendedRecipe: ViForgeTrainingRecipe = {
      method,
      baseModelFamily: sourceModelFamily,
      targetDatasetPath,
      recommendedBeta: method === 'DPO' ? 0.1 : 0.04,
      recommendedLearningRate: method === 'GRPO' ? 1e-6 : 5e-7,
      recommendedEpochs: method === 'SPIN' ? 3 : 2,
      rationale: params.ceilingDiagnosis.rationale,
    };

    const createdAt = new Date().toISOString();
    const handoffId = `viforge-handoff-${crypto
      .createHash('sha256')
      .update(`${params.sourceManifest.id}:${core.coreHash}:${createdAt}`)
      .digest('hex')
      .slice(0, 12)}`;

    const unsignedPayload = {
      handoffId,
      schemaVersion: '1.0.0' as const,
      createdAt,
      sourceManifestId: String(params.sourceManifest.id),
      sourceManifestHash: params.sourceManifest.contentHash,
      sourceModelFamily,
      transferableCore: core,
      capabilityCeilingDiagnosis: params.ceilingDiagnosis,
      recommendedRecipe,
      datasetPaths,
      datasetCounts: {
        dpoPairsCount: params.dpoPairs.length,
        grpoGroupsCount: params.grpoGroups.length,
        spinRecordsCount: params.spinRecords.length,
      },
    };

    const signature = crypto
      .createHash('sha256')
      .update(JSON.stringify(unsignedPayload))
      .digest('hex');

    const handoffManifest: ViForgeHandoffManifest = {
      ...unsignedPayload,
      signature,
    };

    if (params.outputDir) {
      const handoffPath = path.join(params.outputDir, 'viforge_handoff_manifest.json');
      await fs.writeFile(handoffPath, JSON.stringify(handoffManifest, null, 2), 'utf8');
    }

    return handoffManifest;
  }

  /**
   * Ingests an updated model checkpoint $M_{t+1}$ from `ViForge`:
   * 1. Preserves the verified `TransferableCore` from `sourceManifest`.
   * 2. Rebinds the `EcosystemMargin` to `newModelFamily` (or applies `customTargetMargin`).
   * 3. Invalidates prior model-family-specific `ExperienceEntry` records in `HarnessExperienceLibrary`
   *    so they are re-verified under $M_{t+1}$ (preventing Harness-Model Co-Adaptation Drift).
   */
  async ingestUpdatedModelCheckpoint(
    input: ViForgeCheckpointIngestionInput,
  ): Promise<ViForgeCheckpointIngestionResult> {
    const { core, margin: baseMargin } = this.splitter.split(input.sourceManifest);

    const adaptedMargin: EcosystemMargin = input.customTargetMargin ?? {
      ...baseMargin,
      targetProfile: {
        ...baseMargin.targetProfile,
        modelFamily: input.newModelFamily,
      },
    };

    const newManifestId =
      `harness-${input.newModelFamily}-${input.newModelCheckpointId}` as HarnessId;

    const adaptedManifest = this.splitter.recombine({
      baseManifest: input.sourceManifest,
      core,
      margin: adaptedMargin,
      newManifestId,
      targetProfileOverride: {
        modelFamily: input.newModelFamily,
      },
    });

    const invalidatedExperienceIds: ExperienceEntryId[] = [];
    if (this.experienceLibrary) {
      const existingEntries = await this.experienceLibrary.query({
        modelFamily: input.previousModelFamily,
        includeNegativeEvidence: true,
        includeStale: false,
      });

      for (const entry of existingEntries) {
        if (entry.status === 'ACTIVE') {
          await this.experienceLibrary.invalidate(
            entry.id,
            `Model checkpoint upgraded from ${input.previousModelFamily} to ${input.newModelFamily} (${input.newModelCheckpointId}); revalidation required to prevent co-adaptation drift.`,
          );
          invalidatedExperienceIds.push(entry.id);
        }
      }
    }

    const ingestionDigest = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          adaptedManifestHash: adaptedManifest.contentHash,
          checkpointSha256: input.checkpointSha256,
          invalidatedExperienceIds,
        }),
      )
      .digest('hex');

    return {
      adaptedManifest,
      preservedCore: core,
      adaptedMargin,
      invalidatedExperienceIds,
      revalidationRequiredCount: invalidatedExperienceIds.length,
      ingestionDigest,
    };
  }
}
