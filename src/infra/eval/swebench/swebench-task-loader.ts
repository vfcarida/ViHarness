/**
 * Native SWE-bench & SWE-bench Pro Dataset Loader.
 *
 * Implements Princeton SWE-bench / SWE-bench Lite / Verified ingestion:
 * - Reads JSON arrays and JSONL (newline-delimited JSON) task specifications.
 * - Extracts test contracts (FAIL_TO_PASS, PASS_TO_PASS).
 * - Converts SWE-bench instances to Vi-Harness Goal definitions with TDD and Strict Compiler constraints.
 * - Generates standard model evaluation prediction files for evaluation harnesses.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SweBenchInstance,
  SweBenchFilterOptions,
  SweBenchPrediction,
  SweBenchConversionOptions,
} from './types.js';
import { type Goal, GoalStatus, DEFAULT_GOAL_CONSTRAINTS } from '../../../core/model/goal.js';
import type { IdFactory } from '../../../core/types/identifiers.js';
import { TddEnforcer } from '../../verification/tdd-enforcer.js';

export class SweBenchTaskLoader {
  /**
   * Parses SWE-bench instances from raw string content (JSON or JSONL).
   */
  static loadFromString(content: string, filters?: SweBenchFilterOptions): SweBenchInstance[] {
    const trimmed = content.trim();
    if (!trimmed) {
      return [];
    }

    let rawList: unknown[];
    if (trimmed.startsWith('[')) {
      // Standard JSON array
      rawList = JSON.parse(trimmed) as unknown[];
    } else {
      // JSONL format (one JSON object per line)
      const lines = trimmed.split(/\r?\n/);
      rawList = [];
      for (const line of lines) {
        const lineTrimmed = line.trim();
        if (lineTrimmed.length > 0) {
          rawList.push(JSON.parse(lineTrimmed));
        }
      }
    }

    const instances: SweBenchInstance[] = [];
    for (const item of rawList) {
      if (typeof item === 'object' && item !== null && 'instance_id' in item) {
        const raw = item as Record<string, unknown>;
        instances.push({
          instance_id: String(raw['instance_id']),
          repo: String(raw['repo'] ?? ''),
          base_commit: String(raw['base_commit'] ?? ''),
          problem_statement: String(raw['problem_statement'] ?? ''),
          hints_text: raw['hints_text'] ? String(raw['hints_text']) : undefined,
          created_at: raw['created_at'] ? String(raw['created_at']) : undefined,
          version: raw['version'] ? String(raw['version']) : undefined,
          FAIL_TO_PASS: raw['FAIL_TO_PASS'] as string[] | string | undefined,
          PASS_TO_PASS: raw['PASS_TO_PASS'] as string[] | string | undefined,
          environment_setup_commit: raw['environment_setup_commit']
            ? String(raw['environment_setup_commit'])
            : undefined,
          patch: raw['patch'] ? String(raw['patch']) : undefined,
          test_patch: raw['test_patch'] ? String(raw['test_patch']) : undefined,
        });
      }
    }

    return this.filterInstances(instances, filters);
  }

  /**
   * Loads instances from a JSON or JSONL file on disk.
   */
  static async loadFromFile(
    filePath: string,
    filters?: SweBenchFilterOptions,
  ): Promise<SweBenchInstance[]> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`SWE-bench dataset file not found: ${filePath}`);
    }
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return this.loadFromString(content, filters);
  }

  /**
   * Loads instances from all .json and .jsonl files in a directory.
   */
  static async loadFromDirectory(
    dirPath: string,
    filters?: SweBenchFilterOptions,
  ): Promise<SweBenchInstance[]> {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = await fs.promises.readdir(dirPath);
    const datasetFiles = files.filter(
      (f) => f.endsWith('.json') || f.endsWith('.jsonl'),
    );

    let allInstances: SweBenchInstance[] = [];
    for (const file of datasetFiles) {
      const fullPath = path.join(dirPath, file);
      try {
        const instances = await this.loadFromFile(fullPath);
        allInstances = allInstances.concat(instances);
      } catch {
        // Skip unreadable files
      }
    }

    return this.filterInstances(allInstances, filters);
  }

  /**
   * Applies filtering criteria to a list of SWE-bench instances.
   */
  static filterInstances(
    instances: ReadonlyArray<SweBenchInstance>,
    filters?: SweBenchFilterOptions,
  ): SweBenchInstance[] {
    if (!filters) {
      return [...instances];
    }

    let result = [...instances];

    if (filters.instanceIds && filters.instanceIds.length > 0) {
      const allowedIds = new Set(filters.instanceIds);
      result = result.filter((item) => allowedIds.has(item.instance_id));
    }

    if (filters.repo) {
      const targetRepo = filters.repo.toLowerCase();
      result = result.filter((item) =>
        item.repo.toLowerCase().includes(targetRepo),
      );
    }

    if (filters.hasHints !== undefined) {
      result = result.filter((item) =>
        filters.hasHints
          ? Boolean(item.hints_text && item.hints_text.trim().length > 0)
          : !item.hints_text || item.hints_text.trim().length === 0,
      );
    }

    if (filters.searchQuery) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.instance_id.toLowerCase().includes(query) ||
          item.problem_statement.toLowerCase().includes(query) ||
          item.repo.toLowerCase().includes(query),
      );
    }

    if (filters.offset && filters.offset > 0) {
      result = result.slice(filters.offset);
    }

    if (filters.limit && filters.limit > 0) {
      result = result.slice(0, filters.limit);
    }

    return result;
  }

  /**
   * Normalizes test lists from raw format (array of strings or JSON-encoded string).
   */
  static parseTestList(val: string[] | string | undefined): string[] {
    if (!val) {
      return [];
    }
    if (Array.isArray(val)) {
      return val.map(String);
    }
    const str = String(val).trim();
    if (!str) {
      return [];
    }
    try {
      const parsed = JSON.parse(str.replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      // Fallback: split by comma or newline
      return str
        .split(/[,\n]/)
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    return [str];
  }

  /**
   * Formats standard SWE-bench prompt instructions.
   */
  static formatPrompt(
    instance: SweBenchInstance,
    options?: SweBenchConversionOptions,
  ): string {
    const failToPass = this.parseTestList(instance.FAIL_TO_PASS);
    const failSection =
      failToPass.length > 0
        ? `\n<target_tests>\nThe following test(s) are failing and must pass after your fix:\n${failToPass.map((t) => `- ${t}`).join('\n')}\n</target_tests>`
        : '';

    const hintsSection =
      options?.includeHints && instance.hints_text
        ? `\n<hints>\n${instance.hints_text}\n</hints>`
        : '';

    const tddSection = options?.requireTdd
      ? `\n\n${TddEnforcer.getGuidanceContract(options.tddKPass ?? 1)}`
      : '';

    return (
      `You will be provided with a partial code base and an issue statement explaining a problem to resolve.\n\n` +
      `<issue_description>\n${instance.problem_statement}\n</issue_description>` +
      hintsSection +
      failSection +
      tddSection +
      `\n\nRepository: ${instance.repo}\nBase Commit: ${instance.base_commit}`
    );
  }

  /**
   * Converts a SWE-bench instance into a Vi-Harness Goal.
   */
  static toGoal(
    instance: SweBenchInstance,
    idFactory: IdFactory,
    options?: SweBenchConversionOptions,
  ): Goal {
    const prompt = this.formatPrompt(instance, options);
    const now = new Date();
    const failToPass = this.parseTestList(instance.FAIL_TO_PASS);
    const passToPass = this.parseTestList(instance.PASS_TO_PASS);

    return {
      id: idFactory.create<'Goal'>(),
      description: prompt,
      constraints: {
        ...DEFAULT_GOAL_CONSTRAINTS,
        maxIterations: options?.maxIterations ?? 30,
        maxCostDollars: options?.maxCostDollars ?? 2.0,
        requireTdd: options?.requireTdd ?? false,
      },
      status: GoalStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      metadata: {
        benchmarkSuite: 'swe-bench',
        instanceId: instance.instance_id,
        repo: instance.repo,
        baseCommit: instance.base_commit,
        failToPass,
        passToPass,
        strictCompiler: options?.strictCompiler ?? false,
        tddKPass: options?.tddKPass ?? 1,
      },
    };
  }

  /**
   * Creates a prediction object in official SWE-bench evaluation format.
   */
  static createPrediction(
    instanceId: string,
    patch: string,
    modelName: string = 'vi-harness',
  ): SweBenchPrediction {
    return {
      instance_id: instanceId,
      model_patch: patch,
      model_name_or_path: modelName,
    };
  }

  /**
   * Writes predictions to a JSONL file for downstream evaluation.
   */
  static async writePredictionsFile(
    filePath: string,
    predictions: ReadonlyArray<SweBenchPrediction>,
  ): Promise<void> {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    const lines = predictions.map((p) => JSON.stringify(p));
    await fs.promises.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  }
}
