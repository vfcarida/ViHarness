/**
 * Unit Tests for Evolution Plane CLI Commands (`src/cli/commands/evolve.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  runHarnessCli,
  runEvolveCli,
  runEvolutionManageCli,
  runLibraryCli,
  runPromoteCli,
  runRollbackHarnessCli,
} from '../../../src/cli/commands/evolve.js';
import { RecursiveEvolutionEngine } from '../../../src/infra/evolution/recursive-evolution-engine.js';

describe('Evolution Plane CLI Commands', () => {
  let tmpDir: string;
  let engine: RecursiveEvolutionEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-evolve-cli-'));
    engine = new RecursiveEvolutionEngine({
      storageRootDir: tmpDir,
      enabledByDefault: true,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('supports harness inspect, validate, diff, and replay --dry-run', async () => {
    const inspectCode = await runHarnessCli(['inspect', 'H0'], {
      engine,
      storageRootDir: tmpDir,
    });
    expect(inspectCode).toBe(0);

    const validateCode = await runHarnessCli(['validate', 'H0'], {
      engine,
      storageRootDir: tmpDir,
    });
    expect(validateCode).toBe(0);

    const diffCode = await runHarnessCli(['diff', 'H0', 'H0'], {
      engine,
      storageRootDir: tmpDir,
    });
    expect(diffCode).toBe(0);

    const replayCode = await runHarnessCli(['replay', 'H0', '--dry-run'], {
      engine,
      storageRootDir: tmpDir,
    });
    expect(replayCode).toBe(0);
  });

  it('supports evolve --dry-run and persisted evolve + evolution inspect/resume', async () => {
    const dryCode = await runEvolveCli(
      ['fix-ts-types', '--mode', 'parallel', '--k', '2', '--dry-run'],
      { engine, storageRootDir: tmpDir },
    );
    expect(dryCode).toBe(0);

    const report = await engine.runCycle({
      taskIdentifier: 'cli-persisted-task',
      mode: 'sequential',
      kCandidates: 2,
      maxSteps: 1,
      evolveTasks: [
        { taskId: 'cli-t1', prompt: 'Fix CLI test', split: 'evolve' },
      ],
    });

    const inspectRunCode = await runEvolutionManageCli(
      ['inspect', String(report.runId)],
      { engine, storageRootDir: tmpDir },
    );
    expect(inspectRunCode).toBe(0);

    const resumeRunCode = await runEvolutionManageCli(
      ['resume', String(report.runId), '--dry-run'],
      { engine, storageRootDir: tmpDir },
    );
    expect(resumeRunCode).toBe(0);
  });

  it('supports library list, prune --dry-run, consolidate --dry-run, promote --dry-run, and rollback-harness --dry-run', async () => {
    expect(
      await runLibraryCli(['list'], { engine, storageRootDir: tmpDir }),
    ).toBe(0);
    expect(
      await runLibraryCli(['prune', '--dry-run'], {
        engine,
        storageRootDir: tmpDir,
      }),
    ).toBe(0);
    expect(
      await runLibraryCli(['consolidate', '--dry-run'], {
        engine,
        storageRootDir: tmpDir,
      }),
    ).toBe(0);
    expect(
      await runPromoteCli(['H0', '--dry-run'], {
        engine,
        storageRootDir: tmpDir,
      }),
    ).toBe(0);
    expect(
      await runRollbackHarnessCli(['H0', '--dry-run'], {
        engine,
        storageRootDir: tmpDir,
      }),
    ).toBe(0);
  });
});
