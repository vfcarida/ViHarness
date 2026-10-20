import { describe, it, expect } from 'vitest';
import { createId } from '../../../src/core/types/identifiers.js';
import { ComponentCapabilityClass } from '../../../src/core/evolution/constitution.js';
import {
  HarnessManifestToolkit,
  ConformalAbstentionGuard,
  RecursiveEvolutionEngine,
} from '../../../src/infra/evolution/index.js';
import { Container } from '../../../src/di/container.js';
import { DefaultModule } from '../../../src/di/default-module.js';
import { TOKENS } from '../../../src/di/tokens.js';
import { runEvolutionManageCli } from '../../../src/cli/commands/evolve.js';

describe('Conformal Abstention Guard & Cryptographic Reproducibility Manifest Suite', () => {
  const toolkit = new HarnessManifestToolkit();
  const baseH0 = toolkit.createCanonicalBaseline();

  it('1. Calibrates finite-sample split conformal quantile q_{1-alpha} from empirical residuals', () => {
    const guard = new ConformalAbstentionGuard({ alpha: 0.1 });
    expect(guard.getCalibrationSampleCount()).toBe(0);
    expect(guard.computeEmpiricalQuantile()).toBeCloseTo(1.645, 3);

    const samples = [
      { candidateId: 'c1', predictedMean: 0.2, predictedStd: 0.1, observedUtility: 0.22 }, // |0.02|/0.1 = 0.2
      { candidateId: 'c2', predictedMean: 0.2, predictedStd: 0.1, observedUtility: 0.25 }, // |0.05|/0.1 = 0.5
      { candidateId: 'c3', predictedMean: 0.2, predictedStd: 0.1, observedUtility: 0.3 },  // |0.10|/0.1 = 1.0
      { candidateId: 'c4', predictedMean: 0.2, predictedStd: 0.1, observedUtility: 0.35 }, // |0.15|/0.1 = 1.5
      { candidateId: 'c5', predictedMean: 0.2, predictedStd: 0.1, observedUtility: 0.4 },  // |0.20|/0.1 = 2.0
    ];
    for (const s of samples) {
      guard.recordCalibrationSample(s);
    }

    expect(guard.getCalibrationSampleCount()).toBe(5);
    // ceil((5 + 1) * 0.9) = ceil(5.4) = 6 -> clamped to rank 5 -> score = 2.0
    expect(guard.computeEmpiricalQuantile()).toBeCloseTo(2.0, 4);
  });

  it('2. Enforces Honest-by-Construction abstention when domain assumptions are violated', () => {
    const guard = new ConformalAbstentionGuard();
    const nanDecision = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: Number.NaN,
      predictedStd: 0.1,
      seed: 42,
    });

    expect(nanDecision.shouldAbstain).toBe(true);
    expect(nanDecision.abstentionReason).toBe('DOMAIN_ASSUMPTION_VIOLATION');
    expect(nanDecision.fallbackManifestId).toBe('H0');

    const negStdDecision = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: 0.25,
      predictedStd: -0.05,
      seed: 42,
    });
    expect(negStdDecision.shouldAbstain).toBe(true);
    expect(negStdDecision.abstentionReason).toBe('DOMAIN_ASSUMPTION_VIOLATION');
  });

  it('3. Abstains on excessive epistemic uncertainty or interval width overflow', () => {
    const guard = new ConformalAbstentionGuard({
      maxEpistemicUncertainty: 0.3,
      maxIntervalWidth: 0.5,
    });

    const highUncertainty = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: 0.5,
      predictedStd: 0.42,
      seed: 7,
    });
    expect(highUncertainty.shouldAbstain).toBe(true);
    expect(highUncertainty.abstentionReason).toBe('EXCESSIVE_EPISTEMIC_UNCERTAINTY');

    const wideInterval = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: 0.5,
      predictedStd: 0.2, // 2 * 1.645 * 0.2 = 0.658 > 0.5
      seed: 7,
    });
    expect(wideInterval.shouldAbstain).toBe(true);
    expect(wideInterval.abstentionReason).toBe('INTERVAL_WIDTH_EXCEEDED');
  });

  it('4. Abstains when pessimistic conformal lower bound falls below safety/utility floor', () => {
    const guard = new ConformalAbstentionGuard({
      minConformalLowerBound: 0.05,
    });

    const lowBound = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: 0.1,
      predictedStd: 0.08, // lower = 0.1 - 1.645 * 0.08 = -0.0316 < 0.05
      seed: 99,
    });
    expect(lowBound.shouldAbstain).toBe(true);
    expect(lowBound.abstentionReason).toBe('CONFORMAL_LOWER_BOUND_BELOW_FLOOR');

    const approved = guard.evaluateCandidateWithAbstention({
      manifest: baseH0,
      predictedMean: 0.3,
      predictedStd: 0.08, // lower = 0.3 - 0.1316 = 0.1684 >= 0.05
      seed: 99,
    });
    expect(approved.shouldAbstain).toBe(false);
    expect(approved.abstentionReason).toBe('NONE');
  });

  it('5. Produces deterministic SHA-256 Cryptographic Reproducibility Manifests sensitive to seed and component mutations', () => {
    const guard = new ConformalAbstentionGuard();
    const m1 = guard.buildReproducibilityManifest({ manifest: baseH0, seed: 1234 });
    const m2 = guard.buildReproducibilityManifest({ manifest: baseH0, seed: 1234 });
    const mDiffSeed = guard.buildReproducibilityManifest({
      manifest: baseH0,
      seed: 5678,
    });

    expect(m1.reproducibilityHash).toBe(m2.reproducibilityHash);
    expect(m1.reproducibilityHash).not.toBe(mDiffSeed.reproducibilityHash);

    const mutatedManifest = toolkit.cloneWithOverrides(baseH0, {
      newId: createId<'Harness'>('h_repro_mut'),
      createdBy: 'proposer',
      componentOverrides: {
        systemPrompt: HarnessManifestToolkit.createComponentRef({
          id: 'comp-sys-repro',
          surfaceId: 'systemPrompt',
          capabilityClass: ComponentCapabilityClass.DECLARATIVE,
          version: '2.0.0',
          content: 'Mutated system prompt for reproducibility hash sensitivity check.',
        }),
      },
    });
    const mMutated = guard.buildReproducibilityManifest({
      manifest: mutatedManifest,
      seed: 1234,
    });
    expect(m1.componentTreeSha256).not.toBe(mMutated.componentTreeSha256);
    expect(m1.reproducibilityHash).not.toBe(mMutated.reproducibilityHash);
  });

  it('6. Integrates with RecursiveEvolutionEngine, DI Container, and CLI conformal-check subcommand', async () => {
    const engine = new RecursiveEvolutionEngine({ enabledByDefault: true });
    const report = await engine.runCycle({
      taskIdentifier: 'conformal_cycle_check',
      dryRun: true,
      evolveTasks: [
        {
          taskId: 'conformal_cycle_check',
          prompt: 'Verify conformal abstention decision in evolution cycle',
          split: 'evolve',
        },
      ],
    });

    expect(report.conformalAbstentionDecision).toBeDefined();
    expect(
      report.conformalAbstentionDecision?.reproducibilityManifest
        .reproducibilityHash,
    ).toMatch(/^[a-f0-9]{64}$/);

    const container = new Container();
    new DefaultModule().register(container);
    expect(container.resolve(TOKENS.ConformalAbstentionGuard)).toBeInstanceOf(
      ConformalAbstentionGuard,
    );

    const cliExit = await runEvolutionManageCli(['conformal-check', 'H0'], {
      engine,
    });
    expect(cliExit).toBe(0);
  });
});
