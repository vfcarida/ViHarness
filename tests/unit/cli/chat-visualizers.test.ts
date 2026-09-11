import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  ReplVisualizers,
  type ContextEconomicsOptions,
} from '../../../src/infra/tui/repl-visualizers.js';
import type { ProjectRulesResult } from '../../../src/infra/config/project-rule-loader.js';

describe('ReplVisualizers (Terminal REPL Visualizers & Inspectors)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'repl-vis-test-'));
  });

  afterEach(async () => {
    if (fs.existsSync(tmpDir)) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('renderProgressBar', () => {
    it('renders correct fill ratio for 0, 0.5, and 1.0', () => {
      const emptyBar = ReplVisualizers.renderProgressBar(0, 10);
      expect(emptyBar).toBe('░░░░░░░░░░');

      const halfBar = ReplVisualizers.renderProgressBar(0.5, 10);
      expect(halfBar).toBe('█████░░░░░');

      const fullBar = ReplVisualizers.renderProgressBar(1, 10);
      expect(fullBar).toBe('██████████');
    });

    it('clamps negative and out-of-range ratios safely', () => {
      expect(ReplVisualizers.renderProgressBar(-0.5, 5)).toBe('░░░░░');
      expect(ReplVisualizers.renderProgressBar(1.5, 5)).toBe('█████');
    });
  });

  describe('formatBytes', () => {
    it('formats bytes, kilobytes, and megabytes with proper units', () => {
      expect(ReplVisualizers.formatBytes(512)).toBe('512 B');
      expect(ReplVisualizers.formatBytes(2048)).toBe('2.0 KB');
      expect(ReplVisualizers.formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });

  describe('renderContextEconomics', () => {
    it('formats token consumption bar chart and economics metrics', () => {
      const opts: ContextEconomicsOptions = {
        modelId: 'gpt-4o',
        promptTokens: 10000,
        completionTokens: 2000,
        cachedTokens: 6000,
        costDollars: 0.045,
        historyTurnCount: 3,
        rulesCharCount: 4000,
      };

      const output = ReplVisualizers.renderContextEconomics(opts);
      expect(output).toContain('CONTEXT WINDOW & TOKEN ECONOMICS [gpt-4o]');
      expect(output).toContain('12,000 / 128,000 tokens');
      expect(output).toContain('Prompt Tokens        : 10,000');
      expect(output).toContain('Completion Tokens    : 2,000');
      expect(output).toContain('Cached Tokens Read   : 6,000 (60.0% cache hit rate)');
      expect(output).toContain('Active Rules Footprint: ~1,000 tokens (4,000 chars)');
      expect(output).toContain('Total Financial Cost : $0.04500 USD');
      expect(output).toContain('3 turn(s) active');
    });
  });

  describe('renderProjectRules', () => {
    it('renders informative message when no rules exist', () => {
      const emptyResult: ProjectRulesResult = {
        rules: [],
        totalCharacters: 0,
        formattedPrompt: '',
      };
      const output = ReplVisualizers.renderProjectRules(emptyResult, '/workspace');
      expect(output).toContain('No active instruction rule files found');
      expect(output).toContain('Create VI.md, CLAUDE.md, or AGENTS.md');
    });

    it('renders table of discovered rules with tier badges and token estimates', () => {
      const result: ProjectRulesResult = {
        rules: [
          {
            source: '/workspace/VI.md',
            scope: 'workspace',
            content: '# Project Guidelines\nAlways write unit tests first.\nAvoid breaking changes.',
          },
          {
            source: '/home/user/.vi-harness/VI.md',
            scope: 'global',
            content: '# Global Defaults\nUse strict TypeScript.',
          },
        ],
        totalCharacters: 110,
        formattedPrompt: 'prompt',
      };

      const output = ReplVisualizers.renderProjectRules(result, '/workspace');
      expect(output).toContain('Discovered 2 rule file(s)');
      expect(output).toContain('[WORKSPACE] VI.md');
      expect(output).toContain('[GLOBAL]');
      expect(output).toContain('Always write unit tests first');
    });
  });

  describe('renderDirectoryTree', () => {
    it('renders a formatted ASCII tree skipping ignored directories', async () => {
      // Setup mock file tree
      const srcDir = path.join(tmpDir, 'src');
      const nodeModulesDir = path.join(tmpDir, 'node_modules', 'dep');
      const gitDir = path.join(tmpDir, '.git');
      await fs.promises.mkdir(srcDir, { recursive: true });
      await fs.promises.mkdir(nodeModulesDir, { recursive: true });
      await fs.promises.mkdir(gitDir, { recursive: true });

      await fs.promises.writeFile(path.join(tmpDir, 'package.json'), '{"name": "test"}');
      await fs.promises.writeFile(path.join(srcDir, 'index.ts'), 'export const x = 1;');
      await fs.promises.writeFile(path.join(nodeModulesDir, 'index.js'), 'module.exports = {}');

      const tree = ReplVisualizers.renderDirectoryTree(tmpDir, 2);
      expect(tree).toContain('📁 src/ (1 items)');
      expect(tree).toContain('📄 index.ts');
      expect(tree).toContain('📄 package.json');
      expect(tree).not.toContain('node_modules');
      expect(tree).not.toContain('.git');
    });

    it('respects maxDepth limit', async () => {
      const level1 = path.join(tmpDir, 'lvl1');
      const level2 = path.join(level1, 'lvl2');
      const level3 = path.join(level2, 'lvl3');
      await fs.promises.mkdir(level3, { recursive: true });
      await fs.promises.writeFile(path.join(level3, 'deep.txt'), 'deep');

      const depth1Tree = ReplVisualizers.renderDirectoryTree(tmpDir, 1);
      expect(depth1Tree).toContain('📁 lvl1/');
      expect(depth1Tree).not.toContain('lvl2');
      expect(depth1Tree).not.toContain('deep.txt');
    });
  });
});
