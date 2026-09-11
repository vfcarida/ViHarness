/**
 * Terminal REPL Visualizers & Inspectors.
 *
 * Provides high-density ASCII visualizers for interactive CLI commands:
 * - /context: Token economics, cache utilization, and window allocation
 * - /rules: Hierarchical ProjectRuleLoader inspector
 * - /tree: File system structure and disk footprint visualizer
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectRulesResult } from '../config/project-rule-loader.js';

export interface ContextEconomicsOptions {
  readonly modelId: string;
  readonly windowSize?: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cachedTokens: number;
  readonly costDollars: number;
  readonly historyTurnCount: number;
  readonly rulesCharCount?: number;
}

const DEFAULT_MODEL_WINDOW_SIZES: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-5-sonnet': 200000,
  'claude-3-7-sonnet': 200000,
  'claude-3-opus': 200000,
  'o1': 200000,
  'o3-mini': 200000,
  'gemini-1.5-pro': 1000000,
  'gemini-2.0-flash': 1000000,
};

export class ReplVisualizers {
  /**
   * Generates a graphical ASCII meter bar.
   */
  static renderProgressBar(ratio: number, width: number = 30): string {
    const clamped = Math.max(0, Math.min(1, ratio));
    const filledCount = Math.round(clamped * width);
    const emptyCount = width - filledCount;
    return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
  }

  /**
   * Formats human-readable file sizes.
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Renders the /context Token Economics Visualizer.
   */
  static renderContextEconomics(opts: ContextEconomicsOptions): string {
    const totalTokens = opts.promptTokens + opts.completionTokens;
    const windowSize =
      opts.windowSize ??
      DEFAULT_MODEL_WINDOW_SIZES[opts.modelId] ??
      128000;

    const usageRatio = Math.min(1, totalTokens / windowSize);
    const usagePercent = (usageRatio * 100).toFixed(1);
    const remainingTokens = Math.max(0, windowSize - totalTokens);
    const remainingPercent = ((remainingTokens / windowSize) * 100).toFixed(1);

    const cacheHitRatio =
      opts.promptTokens > 0
        ? ((opts.cachedTokens / opts.promptTokens) * 100).toFixed(1)
        : '0.0';

    const estimatedRuleTokens = opts.rulesCharCount
      ? Math.round(opts.rulesCharCount / 4)
      : 0;

    const width = 68;
    const separator = '─'.repeat(width);
    const bar = this.renderProgressBar(usageRatio, 32);

    const lines: string[] = [];
    lines.push('┌' + separator + '┐');
    lines.push(`│ 📊 CONTEXT WINDOW & TOKEN ECONOMICS [${opts.modelId}]`.padEnd(width + 1) + '│');
    lines.push('├' + separator + '┤');
    lines.push(`│ Allocation : [${bar}] ${usagePercent}%`.padEnd(width + 1) + '│');
    lines.push(
      `│ Consumption: ${totalTokens.toLocaleString('en-US')} / ${windowSize.toLocaleString('en-US')} tokens (${remainingTokens.toLocaleString('en-US')} tokens [${remainingPercent}%] headroom)`.padEnd(
        width + 1,
      ) + '│',
    );
    lines.push('├' + separator + '┤');
    lines.push(
      `│ • Prompt Tokens        : ${opts.promptTokens.toLocaleString('en-US')}`.padEnd(width + 1) + '│',
    );
    lines.push(
      `│ • Completion Tokens    : ${opts.completionTokens.toLocaleString('en-US')}`.padEnd(width + 1) + '│',
    );
    lines.push(
      `│ • Cached Tokens Read   : ${opts.cachedTokens.toLocaleString('en-US')} (${cacheHitRatio}% cache hit rate)`.padEnd(
        width + 1,
      ) + '│',
    );
    if (estimatedRuleTokens > 0) {
      lines.push(
        `│ • Active Rules Footprint: ~${estimatedRuleTokens.toLocaleString('en-US')} tokens (${opts.rulesCharCount?.toLocaleString('en-US')} chars)`.padEnd(
          width + 1,
        ) + '│',
      );
    }
    lines.push(
      `│ • Multi-turn History   : ${opts.historyTurnCount} turn(s) active`.padEnd(width + 1) + '│',
    );
    lines.push(
      `│ • Total Financial Cost : $${opts.costDollars.toFixed(5)} USD`.padEnd(width + 1) + '│',
    );
    lines.push('└' + separator + '┘');

    return lines.join('\n');
  }

  /**
   * Renders the /rules Project Rule Inspector.
   */
  static renderProjectRules(result: ProjectRulesResult, workspaceDir: string): string {
    const width = 72;
    const separator = '─'.repeat(width);
    const lines: string[] = [];

    lines.push('┌' + separator + '┐');
    lines.push('│ 📜 PROJECT RULES & REPOSITORY CONTRACTS'.padEnd(width + 1) + '│');
    lines.push('├' + separator + '┤');

    if (result.rules.length === 0) {
      lines.push('│ No active instruction rule files found.'.padEnd(width + 1) + '│');
      lines.push(
        '│ Create VI.md, CLAUDE.md, or AGENTS.md in the root to configure agent rules.'.padEnd(
          width + 1,
        ) + '│',
      );
      lines.push('└' + separator + '┘');
      return lines.join('\n');
    }

    const estimatedTokens = Math.round(result.totalCharacters / 4);
    lines.push(
      `│ Discovered ${result.rules.length} rule file(s) | Total: ${result.totalCharacters.toLocaleString('en-US')} chars (~${estimatedTokens.toLocaleString('en-US')} tokens)`.padEnd(
        width + 1,
      ) + '│',
    );
    lines.push('├' + separator + '┤');

    for (const rule of result.rules) {
      const relPath = path.isAbsolute(rule.source)
        ? path.relative(workspaceDir, rule.source) || path.basename(rule.source)
        : rule.source;
      const tierBadge = `[${rule.scope.toUpperCase()}]`;
      const ruleTokens = Math.round(rule.content.length / 4);

      lines.push(`│ ${tierBadge} ${relPath} (${rule.content.length} chars, ~${ruleTokens} tok)`.padEnd(width + 1) + '│');

      // First non-empty lines snippet
      const snippet = rule.content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .slice(0, 2)
        .join(' | ')
        .slice(0, width - 6);

      if (snippet) {
        lines.push(`│   ↳ "${snippet}..."`.padEnd(width + 1) + '│');
      }
    }

    lines.push('└' + separator + '┘');
    return lines.join('\n');
  }

  /**
   * Renders the /tree File Structure Inspector.
   */
  static renderDirectoryTree(
    dirPath: string,
    maxDepth: number = 2,
    ignoredDirs: Set<string> = new Set([
      'node_modules',
      '.git',
      'dist',
      'build',
      'out',
      '.cache',
      'coverage',
      '.turbo',
      'target',
    ]),
  ): string {
    const lines: string[] = [];
    const rootName = path.basename(dirPath) || dirPath;
    lines.push(`📁 ${rootName}/`);

    const walk = (currentDir: string, currentDepth: number, prefix: string): void => {
      if (currentDepth > maxDepth) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      // Filter ignored
      const visibleEntries = entries.filter((e) => !ignoredDirs.has(e.name) && !e.name.startsWith('.'));

      // Sort: directories first, then files alphabetically
      visibleEntries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (let i = 0; i < visibleEntries.length; i++) {
        const entry = visibleEntries[i];
        if (!entry) continue;
        const isLast = i === visibleEntries.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const nextPrefix = prefix + (isLast ? '    ' : '│   ');
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          try {
            const subEntries = fs.readdirSync(fullPath);
            const subVisible = subEntries.filter((name) => !ignoredDirs.has(name) && !name.startsWith('.'));
            lines.push(`${prefix}${branch}📁 ${entry.name}/ (${subVisible.length} items)`);
          } catch {
            lines.push(`${prefix}${branch}📁 ${entry.name}/`);
          }
          walk(fullPath, currentDepth + 1, nextPrefix);
        } else {
          try {
            const stat = fs.statSync(fullPath);
            lines.push(`${prefix}${branch}📄 ${entry.name} (${ReplVisualizers.formatBytes(stat.size)})`);
          } catch {
            lines.push(`${prefix}${branch}📄 ${entry.name}`);
          }
        }
      }
    };

    walk(dirPath, 1, '');
    return lines.join('\n');
  }
}
