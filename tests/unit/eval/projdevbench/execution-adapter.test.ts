/**
 * ProjDevBench Execution Adapter Unit Tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ProjDevExecutionAdapter,
  ProjDevWorkspaceManager,
  ProjDevTaskLoader,
} from '../../../../src/infra/eval/projdevbench/index.js';
import {
  MockModelProvider,
  UtilityModelRouter,
  DefaultContextCompiler,
  UuidV7IdFactory,
  TestClock,
} from '../../../../src/infra/index.js';
import { DefaultAgentRuntime } from '../../../../src/runtime/default-agent-runtime.js';

describe('ProjDevBench Execution Adapter', () => {
  let tempDir: string;
  const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'projdevbench');

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-projdev-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error on teardown
    }
  });

  it('1. should create all required workspace tools including edit_file and revert_file', () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock();
    const router = new UtilityModelRouter();
    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const runtime = new DefaultAgentRuntime({ router, compiler, idFactory, clock });

    const adapter = new ProjDevExecutionAdapter({
      runtime,
      idFactory,
      clock,
    });

    const tools = adapter.createWorkspaceTools(tempDir);
    const toolNames = tools.map((t) => t.definition.name);

    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('edit_file');
    expect(toolNames).toContain('revert_file');
    expect(toolNames).toContain('list_directory');
    expect(toolNames).toContain('run_command');
  });

  it('2. should execute a problem using isolated workspace and produce problem score', async () => {
    const idFactory = new UuidV7IdFactory();
    const clock = new TestClock();

    const mockProvider = new MockModelProvider({
      providerId: 'mock-eval',
      defaultResponseText: 'Completed problem requirements.',
    });
    const router = new UtilityModelRouter();
    router.registerProvider(mockProvider);

    const compiler = new DefaultContextCompiler({ idFactory, clock });
    const runtime = new DefaultAgentRuntime({ router, compiler, idFactory, clock });

    const adapter = new ProjDevExecutionAdapter({
      runtime,
      idFactory,
      clock,
    });

    const manager = new ProjDevWorkspaceManager();
    const problem = await ProjDevTaskLoader.loadProblemFromDirectory(
      path.join(fixturesDir, 'lru-cache-service'),
    );

    const workspace = await manager.createWorkspace(problem);

    try {
      const score = await adapter.runProblem(problem, workspace, {
        maxRetries: 1,
      });

      expect(score).toBeDefined();
      expect(score.problemId).toBe(problem.id);
      expect(score.category).toBe(problem.category);
      expect(score.difficulty).toBe(problem.difficulty);
      expect(score.finalScore).toBeGreaterThanOrEqual(0);
      expect(score.finalScore).toBeLessThanOrEqual(1.0);
      expect(score.executionScore).toBeGreaterThanOrEqual(0);
      expect(score.codeReviewScore).toBeGreaterThanOrEqual(0);
      expect(score.tokenUsage).toBeDefined();
    } finally {
      await workspace.cleanup();
    }
  });
});
