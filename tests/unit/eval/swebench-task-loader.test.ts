import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  SweBenchTaskLoader,
  type SweBenchInstance,
  type SweBenchPrediction,
} from '../../../src/infra/eval/swebench/index.js';
import { UuidV7IdFactory } from '../../../src/infra/id/uuid-id-factory.js';

describe('SweBenchTaskLoader (Native SWE-bench Pro Dataset Loader)', () => {
  let tmpDir: string;
  const idFactory = new UuidV7IdFactory();

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'swebench-test-'));
  });

  afterEach(async () => {
    if (fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  const sampleJsonArray = JSON.stringify([
    {
      instance_id: 'django__django-11099',
      repo: 'django/django',
      base_commit: 'd6600c0a96996d9e03d4',
      problem_statement: 'UsernameValidator allows trailing newline in ASCII usernames.',
      hints_text: 'Check ASCIIUsernameValidator regex.',
      FAIL_TO_PASS: ['tests.auth_tests.test_validators.ASCIIUsernameValidatorTest.test_trailing_newline'],
      PASS_TO_PASS: ['tests.auth_tests.test_validators.ASCIIUsernameValidatorTest.test_valid'],
    },
    {
      instance_id: 'astropy__astropy-12907',
      repo: 'astropy/astropy',
      base_commit: 'ba395b058a9e6d4',
      problem_statement: 'Modeling compound models fail when nesting separable models.',
      hints_text: '',
      FAIL_TO_PASS: "['astropy.modeling.tests.test_separable.test_nested_compound']",
    },
    {
      instance_id: 'sympy__sympy-20590',
      repo: 'sympy/sympy',
      base_commit: '3a25cb8e9f',
      problem_statement: 'Symbol.__slots__ introduced in 1.7 breaks unpickling.',
      FAIL_TO_PASS: ['sympy.core.tests.test_symbol.test_unpickle_symbol'],
    },
  ]);

  const sampleJsonl = `
{"instance_id":"psf__requests-2148","repo":"psf/requests","base_commit":"abc123","problem_statement":"socket.error not caught"}
{"instance_id":"psf__requests-2317","repo":"psf/requests","base_commit":"def456","problem_statement":"method string decode issue"}
`;

  it('loads instances from JSON array string', () => {
    const instances = SweBenchTaskLoader.loadFromString(sampleJsonArray);
    expect(instances).toHaveLength(3);
    expect(instances[0]!.instance_id).toBe('django__django-11099');
    expect(instances[0]!.repo).toBe('django/django');
  });

  it('loads instances from JSONL string ignoring empty lines', () => {
    const instances = SweBenchTaskLoader.loadFromString(sampleJsonl);
    expect(instances).toHaveLength(2);
    expect(instances[0]!.instance_id).toBe('psf__requests-2148');
    expect(instances[1]!.instance_id).toBe('psf__requests-2317');
  });

  it('filters instances by repo and limit', () => {
    const all = SweBenchTaskLoader.loadFromString(sampleJsonArray);
    const djangoOnly = SweBenchTaskLoader.filterInstances(all, { repo: 'django' });
    expect(djangoOnly).toHaveLength(1);
    expect(djangoOnly[0]!.instance_id).toBe('django__django-11099');

    const limited = SweBenchTaskLoader.filterInstances(all, { limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('filters instances by specific instance IDs', () => {
    const all = SweBenchTaskLoader.loadFromString(sampleJsonArray);
    const filtered = SweBenchTaskLoader.filterInstances(all, {
      instanceIds: ['astropy__astropy-12907', 'sympy__sympy-20590'],
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((x) => x.instance_id)).toEqual([
      'astropy__astropy-12907',
      'sympy__sympy-20590',
    ]);
  });

  it('filters instances by searchQuery across problem statements', () => {
    const all = SweBenchTaskLoader.loadFromString(sampleJsonArray);
    const searchRes = SweBenchTaskLoader.filterInstances(all, {
      searchQuery: 'UsernameValidator',
    });
    expect(searchRes).toHaveLength(1);
    expect(searchRes[0]!.instance_id).toBe('django__django-11099');
  });

  it('filters instances by hasHints presence', () => {
    const all = SweBenchTaskLoader.loadFromString(sampleJsonArray);
    const withHints = SweBenchTaskLoader.filterInstances(all, { hasHints: true });
    expect(withHints).toHaveLength(1);
    expect(withHints[0]!.instance_id).toBe('django__django-11099');

    const withoutHints = SweBenchTaskLoader.filterInstances(all, { hasHints: false });
    expect(withoutHints).toHaveLength(2);
  });

  it('parses test lists from array, stringified array, or single string', () => {
    expect(SweBenchTaskLoader.parseTestList(['test1', 'test2'])).toEqual(['test1', 'test2']);
    expect(
      SweBenchTaskLoader.parseTestList("['test.module.test_a', 'test.module.test_b']"),
    ).toEqual(['test.module.test_a', 'test.module.test_b']);
    expect(SweBenchTaskLoader.parseTestList('single_test_name')).toEqual(['single_test_name']);
    expect(SweBenchTaskLoader.parseTestList(undefined)).toEqual([]);
  });

  it('formats SWE-bench prompt with target failing tests and optional hints', () => {
    const instance: SweBenchInstance = {
      instance_id: 'test__repo-1',
      repo: 'test/repo',
      base_commit: 'abc',
      problem_statement: 'Critical bug in parser.',
      hints_text: 'Look at parser.py line 40.',
      FAIL_TO_PASS: ['test_parser.py::test_edge_case'],
    };

    const promptWithHints = SweBenchTaskLoader.formatPrompt(instance, {
      includeHints: true,
      requireTdd: true,
      tddKPass: 2,
    });

    expect(promptWithHints).toContain('<issue_description>');
    expect(promptWithHints).toContain('Critical bug in parser.');
    expect(promptWithHints).toContain('<hints>');
    expect(promptWithHints).toContain('Look at parser.py line 40.');
    expect(promptWithHints).toContain('<target_tests>');
    expect(promptWithHints).toContain('test_parser.py::test_edge_case');
    expect(promptWithHints).toContain('[AUTONOMOUS TEST-DRIVEN DEVELOPMENT (TDD) CONTRACT]');
    expect(promptWithHints).toContain('2 consecutive times');
  });

  it('converts a SWE-bench instance into a full Vi-Harness Goal', () => {
    const instance: SweBenchInstance = {
      instance_id: 'test__repo-2',
      repo: 'test/repo',
      base_commit: 'commit123',
      problem_statement: 'Fix null pointer exception',
      FAIL_TO_PASS: ['test_null.py'],
    };

    const goal = SweBenchTaskLoader.toGoal(instance, idFactory, {
      maxCostDollars: 1.5,
      requireTdd: true,
      tddKPass: 3,
    });

    expect(goal.status).toBe('ACTIVE');
    expect(goal.constraints.maxCostDollars).toBe(1.5);
    expect(goal.constraints.requireTdd).toBe(true);
    expect(goal.metadata?.['benchmarkSuite']).toBe('swe-bench');
    expect(goal.metadata?.['instanceId']).toBe('test__repo-2');
    expect(goal.metadata?.['repo']).toBe('test/repo');
    expect(goal.metadata?.['failToPass']).toEqual(['test_null.py']);
  });

  it('loads dataset from disk and writes prediction files', async () => {
    const jsonlFile = path.join(tmpDir, 'tasks.jsonl');
    await fs.promises.writeFile(jsonlFile, sampleJsonl, 'utf-8');

    const loaded = await SweBenchTaskLoader.loadFromFile(jsonlFile);
    expect(loaded).toHaveLength(2);

    const predictions: SweBenchPrediction[] = [
      SweBenchTaskLoader.createPrediction('psf__requests-2148', 'diff --git a/file.py b/file.py\n+fix', 'gpt-4o'),
      SweBenchTaskLoader.createPrediction('psf__requests-2317', 'diff --git a/file2.py b/file2.py\n+fix2', 'gpt-4o'),
    ];

    const predFile = path.join(tmpDir, 'preds', 'all_preds.jsonl');
    await SweBenchTaskLoader.writePredictionsFile(predFile, predictions);

    expect(fs.existsSync(predFile)).toBe(true);
    const predContent = await fs.promises.readFile(predFile, 'utf-8');
    const predLines = predContent.trim().split('\n').map((l) => JSON.parse(l));
    expect(predLines).toHaveLength(2);
    expect(predLines[0].instance_id).toBe('psf__requests-2148');
    expect(predLines[0].model_patch).toContain('+fix');
  });
});
