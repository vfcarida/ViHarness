/**
 * Hierarchical Project Rule Loader.
 *
 * Discovers and ingests project-specific instructions, architecture guidelines,
 * and coding standards hierarchically from:
 * 1. Global User Rules (e.g. ~/.vi-harness/VI.md or ~/.claude/CLAUDE.md)
 * 2. Workspace Root Rules (VI.md, CLAUDE.md, AGENTS.md, .viharness/rules.md)
 * 3. Subdirectory Scoped Rules (e.g. src/backend/RULES.md)
 *
 * Matches the proven Claude Code / Cursor / Windsurf architectural pattern.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface LoadedRule {
  readonly source: string;
  readonly scope: 'global' | 'workspace' | 'directory';
  readonly content: string;
}

export interface ProjectRulesResult {
  readonly rules: ReadonlyArray<LoadedRule>;
  readonly formattedPrompt: string;
  readonly totalCharacters: number;
}

export interface ProjectRuleLoaderOptions {
  readonly maxBudgetChars?: number;
  readonly userHomeDir?: string;
  readonly customRuleFiles?: ReadonlyArray<string>;
}

export class ProjectRuleLoader {
  private readonly maxBudgetChars: number;
  private readonly homeDir: string;
  private readonly customRuleFiles: ReadonlyArray<string>;

  constructor(options: ProjectRuleLoaderOptions = {}) {
    this.maxBudgetChars = options.maxBudgetChars ?? 8000;
    this.homeDir = options.userHomeDir ?? os.homedir();
    this.customRuleFiles = options.customRuleFiles ?? [];
  }

  /**
   * Static convenience helper to discover and load rules for a workspace.
   */
  static async loadRules(
    workspacePath: string,
    currentDir?: string,
    options?: ProjectRuleLoaderOptions,
  ): Promise<ProjectRulesResult> {
    const loader = new ProjectRuleLoader(options);
    return loader.loadRules(workspacePath, currentDir);
  }

  /**
   * Discovers and loads rules hierarchically for a given workspace.
   */
  async loadRules(workspacePath: string, currentDir?: string): Promise<ProjectRulesResult> {
    const rules: LoadedRule[] = [];
    const resolvedWs = path.resolve(workspacePath);

    // 1. Check Global Rules
    const globalCandidates = [
      path.join(this.homeDir, '.vi-harness', 'VI.md'),
      path.join(this.homeDir, '.claude', 'CLAUDE.md'),
    ];

    for (const cand of globalCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const content = fs.readFileSync(cand, 'utf-8').trim();
          if (content) {
            rules.push({
              source: cand,
              scope: 'global',
              content,
            });
            break; // Load first matching global file
          }
        } catch {
          // Ignore read error
        }
      }
    }

    // 2. Check Workspace Root Rules
    const rootCandidates = [
      ...this.customRuleFiles.map((f) => path.resolve(resolvedWs, f)),
      path.join(resolvedWs, 'VI.md'),
      path.join(resolvedWs, 'CLAUDE.md'),
      path.join(resolvedWs, 'AGENTS.md'),
      path.join(resolvedWs, '.viharness', 'rules.md'),
      path.join(resolvedWs, '.agents', 'rules.md'),
    ];

    const seenContents = new Set<string>();
    for (const cand of rootCandidates) {
      if (fs.existsSync(cand)) {
        try {
          const content = fs.readFileSync(cand, 'utf-8').trim();
          if (content && !seenContents.has(content)) {
            seenContents.add(content);
            rules.push({
              source: path.relative(resolvedWs, cand) || path.basename(cand),
              scope: 'workspace',
              content,
            });
          }
        } catch {
          // Ignore read error
        }
      }
    }

    // 3. Check Subdirectory Scoped Rules (from currentDir up to workspacePath)
    if (currentDir && path.resolve(currentDir) !== resolvedWs) {
      const resolvedCurr = path.resolve(currentDir);
      if (resolvedCurr.startsWith(resolvedWs)) {
        let checkDir = resolvedCurr;
        while (checkDir.length >= resolvedWs.length && checkDir.startsWith(resolvedWs)) {
          const dirCandidates = [
            path.join(checkDir, 'RULES.md'),
            path.join(checkDir, 'VI.md'),
          ];

          for (const cand of dirCandidates) {
            if (fs.existsSync(cand) && !cand.startsWith(path.join(resolvedWs, 'VI.md'))) {
              try {
                const content = fs.readFileSync(cand, 'utf-8').trim();
                if (content && !seenContents.has(content)) {
                  seenContents.add(content);
                  rules.push({
                    source: path.relative(resolvedWs, cand),
                    scope: 'directory',
                    content,
                  });
                }
              } catch {
                // Ignore read error
              }
            }
          }

          const parent = path.dirname(checkDir);
          if (parent === checkDir) break;
          checkDir = parent;
        }
      }
    }

    // 4. Format combined prompt within character budget
    if (rules.length === 0) {
      return {
        rules: [],
        formattedPrompt: '',
        totalCharacters: 0,
      };
    }

    let accumulated = '';
    let totalChars = 0;

    const sections: string[] = [];
    for (const rule of rules) {
      const header = `### Instructions & Guidelines [Source: ${rule.source} (${rule.scope})]`;
      const ruleText = `${header}\n${rule.content}\n`;
      if (totalChars + ruleText.length > this.maxBudgetChars) {
        const remaining = this.maxBudgetChars - totalChars - header.length - 80;
        if (remaining > 100) {
          sections.push(`${header}\n${rule.content.slice(0, remaining)}\n[... Remaining guidelines truncated to fit context budget ...]`);
        }
        break;
      }
      sections.push(ruleText);
      totalChars += ruleText.length;
    }

    accumulated = sections.join('\n');

    return {
      rules,
      formattedPrompt: accumulated.trim(),
      totalCharacters: accumulated.length,
    };
  }
}
