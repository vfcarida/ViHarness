/**
 * ProjDevBench Task Loader.
 *
 * Discovers, parses, and translates ProjDevBench problem specifications into Vi-Harness Goals.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjDevProblem, ProjDevCategory, ProjDevDifficulty, ProjDevMode } from './types.js';
import { type Goal, GoalStatus, DEFAULT_GOAL_CONSTRAINTS } from '../../../core/model/goal.js';
import type { IdFactory } from '../../../core/types/identifiers.js';

export interface ProjDevFilterOptions {
  readonly categories?: ReadonlyArray<ProjDevCategory>;
  readonly difficulties?: ReadonlyArray<ProjDevDifficulty>;
  readonly modes?: ReadonlyArray<ProjDevMode>;
  readonly problemIds?: ReadonlyArray<string>;
  readonly limit?: number;
}

export class ProjDevTaskLoader {
  /**
   * Loads a single problem from a problem directory.
   */
  static async loadProblemFromDirectory(dirPath: string): Promise<ProjDevProblem> {
    const configPath = fs.existsSync(path.join(dirPath, 'problem.json'))
      ? path.join(dirPath, 'problem.json')
      : path.join(dirPath, 'config.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(`ProjDevBench configuration file not found in ${dirPath}`);
    }

    const rawConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));

    // Read specification markdown
    let specMarkdown = '';
    const readmePath = path.join(dirPath, 'README.md');
    const specPath = path.join(dirPath, 'spec.md');

    if (fs.existsSync(readmePath)) {
      specMarkdown = await fs.promises.readFile(readmePath, 'utf-8');
    } else if (fs.existsSync(specPath)) {
      specMarkdown = await fs.promises.readFile(specPath, 'utf-8');
    } else if (rawConfig.spec) {
      specMarkdown = String(rawConfig.spec);
    } else {
      specMarkdown = `# ${rawConfig.title ?? rawConfig.id}\n\n${rawConfig.description ?? ''}`;
    }

    // Load optional template files
    const templateFiles: Record<string, string> = { ...rawConfig.templateFiles };
    const templatesDir = path.join(dirPath, 'template');
    if (fs.existsSync(templatesDir) && fs.statSync(templatesDir).isDirectory()) {
      const readDirRecursive = (currentDir: string, relativePath = '') => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          const rel = path.join(relativePath, entry.name).replace(/\\/g, '/');
          if (entry.isDirectory()) {
            readDirRecursive(fullPath, rel);
          } else if (entry.isFile()) {
            templateFiles[rel] = fs.readFileSync(fullPath, 'utf-8');
          }
        }
      };
      readDirRecursive(templatesDir);
    }

    const testCommands: string[] = Array.isArray(rawConfig.testCommands)
      ? rawConfig.testCommands
      : rawConfig.testCommand
        ? [rawConfig.testCommand]
        : ['npm test'];

    return {
      id: String(rawConfig.id ?? path.basename(dirPath)),
      title: String(rawConfig.title ?? rawConfig.id ?? path.basename(dirPath)),
      category: (rawConfig.category ?? 'SYSTEMS_UTILITY') as ProjDevCategory,
      difficulty: (rawConfig.difficulty ?? 'MEDIUM') as ProjDevDifficulty,
      mode: (rawConfig.mode ??
        (Object.keys(templateFiles).length > 0 ? 'SCAFFOLD' : 'FROM_SCRATCH')) as ProjDevMode,
      specMarkdown,
      testCommands,
      templateFiles,
      sourcePath: dirPath,
      timeoutMs: rawConfig.timeoutMs ?? 180000, // 3 minutes default
      maxCostDollars: rawConfig.maxCostDollars ?? 2.0,
      metadata: rawConfig.metadata ?? {},
    };
  }

  /**
   * Discovers and loads all ProjDevBench problems from a root directory with filtering.
   */
  static async loadProblemsFromDirectory(
    baseDir: string,
    filters?: ProjDevFilterOptions,
  ): Promise<ReadonlyArray<ProjDevProblem>> {
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    const problems: ProjDevProblem[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const probDir = path.join(baseDir, entry.name);
        if (
          fs.existsSync(path.join(probDir, 'problem.json')) ||
          fs.existsSync(path.join(probDir, 'config.json')) ||
          fs.existsSync(path.join(probDir, 'README.md'))
        ) {
          try {
            const prob = await this.loadProblemFromDirectory(probDir);

            // Apply filters
            if (filters?.problemIds && !filters.problemIds.includes(prob.id)) {
              continue;
            }
            if (filters?.categories && !filters.categories.includes(prob.category)) {
              continue;
            }
            if (filters?.difficulties && !filters.difficulties.includes(prob.difficulty)) {
              continue;
            }
            if (filters?.modes && !filters.modes.includes(prob.mode)) {
              continue;
            }

            problems.push(prob);
            if (filters?.limit && problems.length >= filters.limit) {
              break;
            }
          } catch (err) {
            console.warn(`Failed to parse ProjDevBench problem at ${probDir}:`, err);
          }
        }
      }
    }

    return problems;
  }

  /**
   * Maps a ProjDevBench problem into a structured Vi-Harness Goal.
   */
  static mapProblemToGoal(problem: ProjDevProblem, idFactory: IdFactory): Goal {
    const goalDescription = `[ProjDevBench:${problem.category}] ${problem.title}\n\n${problem.specMarkdown}`;
    const now = new Date();

    return {
      id: idFactory.create<'Goal'>(),
      description: goalDescription,
      status: GoalStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      constraints: {
        ...DEFAULT_GOAL_CONSTRAINTS,
        maxCostDollars: problem.maxCostDollars ?? 2.0,
        maxIterations: 25,
      },
      metadata: {
        benchmark: 'ProjDevBench',
        problemId: problem.id,
        category: problem.category,
      },
    };
  }
}
