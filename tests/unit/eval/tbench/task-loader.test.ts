/**
 * TBench Task Loader Unit Tests (P011).
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { TBenchTaskLoader } from '../../../../src/infra/eval/tbench/task-loader.js';
import { UuidV7IdFactory } from '../../../../src/infra/id/uuid-id-factory.js';
import type { TBenchTask } from '../../../../src/infra/eval/tbench/types.js';

describe('TBench Task Loader — P011', () => {
  const idFactory = new UuidV7IdFactory();
  const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures', 'tbench');

  it('1. should discover and parse all sample tasks from fixtures directory', async () => {
    const tasks = await TBenchTaskLoader.loadFromDir(fixturesDir);
    expect(tasks.length).toBe(3);

    const ids = tasks.map((t) => t.id).sort();
    expect(ids).toEqual(['git-bisect-bug', 'inspect-pcap-traffic', 'train-mnist-classifier']);
  });

  it('2. should parse task metadata, category, difficulty, timeout, and test script', async () => {
    const taskPath = path.join(fixturesDir, 'git-bisect-bug');
    const task = await TBenchTaskLoader.loadTask(taskPath);

    expect(task).toBeDefined();
    expect(task?.id).toBe('git-bisect-bug');
    expect(task?.category).toBe('software-engineering');
    expect(task?.difficulty).toBe('easy');
    expect(task?.timeout).toBe(300);
    expect(task?.tags).toContain('git');
    expect(task?.instruction).toContain('Fix the regression in regression.js');
    expect(task?.testScript).toContain('compute() !== 42');
  });

  it('3. should filter tasks by category', () => {
    const mockTasks: TBenchTask[] = [
      {
        id: 't1',
        instruction: 'i1',
        category: 'software-engineering',
        difficulty: 'easy',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't2',
        instruction: 'i2',
        category: 'machine-learning',
        difficulty: 'medium',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't3',
        instruction: 'i3',
        category: 'security',
        difficulty: 'hard',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
    ];

    const mlOnly = TBenchTaskLoader.filter(mockTasks, { categories: ['machine-learning'] });
    expect(mlOnly).toHaveLength(1);
    expect(mlOnly[0]?.id).toBe('t2');
  });

  it('4. should filter tasks by difficulty', () => {
    const mockTasks: TBenchTask[] = [
      {
        id: 't1',
        instruction: 'i1',
        category: 'software-engineering',
        difficulty: 'easy',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't2',
        instruction: 'i2',
        category: 'machine-learning',
        difficulty: 'medium',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't3',
        instruction: 'i3',
        category: 'security',
        difficulty: 'hard',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
    ];

    const hardOnly = TBenchTaskLoader.filter(mockTasks, { difficulties: ['hard'] });
    expect(hardOnly).toHaveLength(1);
    expect(hardOnly[0]?.id).toBe('t3');
  });

  it('5. should filter tasks by tags', () => {
    const mockTasks: TBenchTask[] = [
      {
        id: 't1',
        instruction: 'i1',
        category: 'software-engineering',
        difficulty: 'easy',
        tags: ['git', 'cli'],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't2',
        instruction: 'i2',
        category: 'machine-learning',
        difficulty: 'medium',
        tags: ['torch'],
        testScript: 'exit 0',
        timeout: 60,
      },
    ];

    const gitTagged = TBenchTaskLoader.filter(mockTasks, { tags: ['git'] });
    expect(gitTagged).toHaveLength(1);
    expect(gitTagged[0]?.id).toBe('t1');
  });

  it('6. should filter tasks by specific taskIds', () => {
    const mockTasks: TBenchTask[] = [
      {
        id: 't1',
        instruction: 'i1',
        category: 'software-engineering',
        difficulty: 'easy',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't2',
        instruction: 'i2',
        category: 'machine-learning',
        difficulty: 'medium',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
    ];

    const specific = TBenchTaskLoader.filter(mockTasks, { taskIds: ['t2'] });
    expect(specific).toHaveLength(1);
    expect(specific[0]?.id).toBe('t2');
  });

  it('7. should respect maxTasks limit', () => {
    const mockTasks: TBenchTask[] = [
      {
        id: 't1',
        instruction: 'i1',
        category: 'software-engineering',
        difficulty: 'easy',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't2',
        instruction: 'i2',
        category: 'machine-learning',
        difficulty: 'medium',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
      {
        id: 't3',
        instruction: 'i3',
        category: 'security',
        difficulty: 'hard',
        tags: [],
        testScript: 'exit 0',
        timeout: 60,
      },
    ];

    const limited = TBenchTaskLoader.filter(mockTasks, { maxTasks: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.id).toBe('t1');
    expect(limited[1]?.id).toBe('t2');
  });

  it('8. should map TBenchTask to Vi-Harness Goal with constraints and metadata', async () => {
    const taskPath = path.join(fixturesDir, 'train-mnist-classifier');
    const task = await TBenchTaskLoader.loadTask(taskPath);
    expect(task).toBeDefined();

    const goal = TBenchTaskLoader.mapTaskToGoal(task!, idFactory);

    expect(goal.id).toBeDefined();
    expect(goal.description).toContain('[TBench:MACHINE-LEARNING:MEDIUM]');
    expect(goal.description).toContain('train-mnist-classifier');
    expect(goal.constraints.deadlineMs).toBe(600 * 1000);
    expect(goal.metadata?.['benchmark']).toBe('TBench');
    expect(goal.metadata?.['category']).toBe('machine-learning');
  });

  it('9. should return empty array when directory does not exist', async () => {
    const res = await TBenchTaskLoader.loadFromDir(
      path.join(fixturesDir, 'non-existent-dir-12345'),
    );
    expect(res).toEqual([]);
  });

  it('10. should return null when directory is invalid or empty', async () => {
    const res = await TBenchTaskLoader.loadTask(path.resolve(process.cwd()));
    expect(res).toBeNull();
  });

  it('11. should preserve oracleSolution if provided in task', async () => {
    const mockTask: TBenchTask = {
      id: 'oracle-test',
      instruction: 'Run oracle',
      category: 'security',
      difficulty: 'hard',
      tags: ['oracle'],
      testScript: 'exit 0',
      oracleSolution: 'python solve.py',
      timeout: 120,
    };
    const goal = TBenchTaskLoader.mapTaskToGoal(mockTask, idFactory);
    expect(goal.metadata?.['tbenchTaskId']).toBe('oracle-test');
    expect(goal.constraints.maxCostDollars).toBe(2.0);
  });
});
