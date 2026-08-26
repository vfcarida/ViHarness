/**
 * Harness Auto-Tuner Unit Tests (Meta-Harness Pattern) — P009.
 *
 * Validates:
 * 1. Filtering and applying recommendations by confidence.
 * 2. Parameter whitelist filtering.
 * 3. Dry-run mode.
 * 4. Experience store logging of tuning decisions.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  HarnessAutoTuner,
  DefaultExperienceStore,
  type HarnessRecommendation,
} from '../../../src/infra/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';
import { TestClock } from '../../../src/infra/time/test-clock.js';

describe('Harness Auto-Tuner (Meta-Harness Pattern) — P009', () => {
  const clock = new TestClock(new Date('2026-01-01T00:00:00.000Z'));
  const idFactory = new UuidV7IdFactory();

  it('1. should apply high-confidence recommendations and skip low-confidence ones', async () => {
    const currentConfig: Record<string, unknown> = {
      architectMode: false,
      aggressiveCompactionThreshold: 0.85,
      enablePrefixCaching: false,
    };

    const recommendations: HarnessRecommendation[] = [
      {
        type: 'ROUTING_CHANGE',
        parameter: 'architectMode',
        currentValue: false,
        suggestedValue: true,
        evidence: ['Oscillation detected across runs'],
        confidence: 0.9, // >= 0.80 -> apply
        rationale: 'Prevent cyclic repair loops',
      },
      {
        type: 'COMPACTION_TUNING',
        parameter: 'aggressiveCompactionThreshold',
        currentValue: 0.85,
        suggestedValue: 0.65,
        evidence: ['Context token bloat'],
        confidence: 0.7, // < 0.80 -> skip
        rationale: 'Lower compaction threshold',
      },
    ];

    const result = await HarnessAutoTuner.applyRecommendations(currentConfig, recommendations, {
      minConfidence: 0.8,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.updatedConfig['architectMode']).toBe(true);
    expect(result.updatedConfig['aggressiveCompactionThreshold']).toBe(0.85); // Unchanged
    expect(result.appliedDecisions).toHaveLength(1);
    expect(result.appliedDecisions[0]?.recommendation.parameter).toBe('architectMode');
  });

  it('2. should enforce allowedParameters whitelist when provided', async () => {
    const currentConfig = { architectMode: false, enablePrefixCaching: false };

    const recommendations: HarnessRecommendation[] = [
      {
        type: 'ROUTING_CHANGE',
        parameter: 'architectMode',
        currentValue: false,
        suggestedValue: true,
        evidence: [],
        confidence: 0.95,
        rationale: '',
      },
      {
        type: 'THRESHOLD_ADJUSTMENT',
        parameter: 'enablePrefixCaching',
        currentValue: false,
        suggestedValue: true,
        evidence: [],
        confidence: 0.95,
        rationale: '',
      },
    ];

    const result = await HarnessAutoTuner.applyRecommendations(currentConfig, recommendations, {
      minConfidence: 0.8,
      allowedParameters: ['enablePrefixCaching'], // Only prefix caching allowed
    });

    expect(result.appliedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.updatedConfig['architectMode']).toBe(false);
    expect(result.updatedConfig['enablePrefixCaching']).toBe(true);
  });

  it('3. should support dryRun mode without modifying output configuration', async () => {
    const currentConfig = { architectMode: false };

    const recommendations: HarnessRecommendation[] = [
      {
        type: 'ROUTING_CHANGE',
        parameter: 'architectMode',
        currentValue: false,
        suggestedValue: true,
        evidence: [],
        confidence: 0.95,
        rationale: '',
      },
    ];

    const result = await HarnessAutoTuner.applyRecommendations(currentConfig, recommendations, {
      dryRun: true,
    });

    expect(result.appliedCount).toBe(1);
    expect(result.updatedConfig['architectMode']).toBe(false); // Not applied in dry run
    expect(result.appliedDecisions[0]?.applied).toBe(false);
  });

  it('4. should log applied decisions to ExperienceStore', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-auto-tune-log-'));
    const store = new DefaultExperienceStore({ baseDir: tempDir, clock, idFactory });

    const currentConfig = { enablePrefixCaching: false };
    const recommendations: HarnessRecommendation[] = [
      {
        type: 'THRESHOLD_ADJUSTMENT',
        parameter: 'enablePrefixCaching',
        currentValue: false,
        suggestedValue: true,
        evidence: ['Repeated low cache ratio'],
        confidence: 0.88,
        rationale: 'Cache headers',
      },
    ];

    await HarnessAutoTuner.applyRecommendations(currentConfig, recommendations, {
      experienceStore: store,
      idFactory,
    });

    const history = await store.getTuningHistory();
    expect(history).toHaveLength(1);
    expect(history[0]?.recommendation.parameter).toBe('enablePrefixCaching');
    expect(history[0]?.applied).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
