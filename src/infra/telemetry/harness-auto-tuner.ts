/**
 * Harness Auto-Tuner (Meta-Harness Closed Outer Loop).
 *
 * Automatically tunes harness configuration parameters based on high-confidence
 * recommendations extracted from cross-run trace diagnostics.
 */
import type { HarnessRecommendation } from './harness-diagnostic-engine.js';
import type { AutoTuneDecision, ExperienceStore } from './experience-store.js';
import type { IdFactory } from '../../core/types/identifiers.js';

export interface AutoTuneOptions {
  readonly minConfidence?: number;
  readonly dryRun?: boolean;
  readonly allowedParameters?: ReadonlyArray<string>;
  readonly experienceStore?: ExperienceStore;
  readonly idFactory?: IdFactory;
}

export interface AutoTuneResult {
  readonly appliedCount: number;
  readonly skippedCount: number;
  readonly previousConfig: Record<string, unknown>;
  readonly updatedConfig: Record<string, unknown>;
  readonly appliedDecisions: ReadonlyArray<AutoTuneDecision>;
}

export class HarnessAutoTuner {
  /**
   * Evaluates recommendations and applies high-confidence parameter updates to the configuration.
   */
  static async applyRecommendations(
    currentConfig: Record<string, unknown>,
    recommendations: ReadonlyArray<HarnessRecommendation>,
    options?: AutoTuneOptions,
  ): Promise<AutoTuneResult> {
    const minConfidence = options?.minConfidence ?? 0.8;
    const dryRun = options?.dryRun ?? false;
    const allowed = options?.allowedParameters ? new Set(options.allowedParameters) : null;

    const previousConfig = { ...currentConfig };
    const updatedConfig = { ...currentConfig };
    const appliedDecisions: AutoTuneDecision[] = [];
    let skippedCount = 0;

    for (const rec of recommendations) {
      if (allowed && !allowed.has(rec.parameter)) {
        skippedCount++;
        continue;
      }

      if (rec.confidence < minConfidence) {
        skippedCount++;
        continue;
      }

      // Check if value actually changes
      const currentVal = previousConfig[rec.parameter];
      if (currentVal === rec.suggestedValue) {
        skippedCount++;
        continue;
      }

      if (!dryRun) {
        updatedConfig[rec.parameter] = rec.suggestedValue;
      }

      const decisionId = options?.idFactory
        ? options.idFactory.create<'Decision'>()
        : `tune_${Math.random().toString(36).slice(2, 10)}`;

      const decision: AutoTuneDecision = {
        decisionId,
        timestamp: new Date().toISOString(),
        recommendation: rec,
        applied: !dryRun,
        previousConfig: { [rec.parameter]: currentVal },
        updatedConfig: { [rec.parameter]: rec.suggestedValue },
      };

      appliedDecisions.push(decision);

      if (options?.experienceStore) {
        try {
          await options.experienceStore.logTuningDecision(decision);
        } catch {
          // Best-effort logging
        }
      }
    }

    return {
      appliedCount: appliedDecisions.length,
      skippedCount,
      previousConfig,
      updatedConfig,
      appliedDecisions,
    };
  }
}
