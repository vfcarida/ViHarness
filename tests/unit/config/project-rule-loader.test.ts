import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProjectRuleLoader } from '../../../src/infra/config/project-rule-loader.js';

describe('ProjectRuleLoader Suite', () => {
  let tempWorkspace: string;
  let tempHome: string;

  beforeEach(() => {
    tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-ws-rules-'));
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vih-home-rules-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('returns empty result when no rule files are present', async () => {
    const loader = new ProjectRuleLoader({ userHomeDir: tempHome });
    const result = await loader.loadRules(tempWorkspace);

    expect(result.rules.length).toBe(0);
    expect(result.formattedPrompt).toBe('');
    expect(result.totalCharacters).toBe(0);
  });

  it('loads VI.md from workspace root with workspace scope', async () => {
    fs.writeFileSync(
      path.join(tempWorkspace, 'VI.md'),
      '# Coding Conventions\nAlways use TypeScript strict mode and write unit tests.',
      'utf-8',
    );

    const loader = new ProjectRuleLoader({ userHomeDir: tempHome });
    const result = await loader.loadRules(tempWorkspace);

    expect(result.rules.length).toBe(1);
    expect(result.rules[0]!.source).toBe('VI.md');
    expect(result.rules[0]!.scope).toBe('workspace');
    expect(result.formattedPrompt).toContain('### Instructions & Guidelines [Source: VI.md (workspace)]');
    expect(result.formattedPrompt).toContain('Always use TypeScript strict mode');
  });

  it('loads CLAUDE.md and AGENTS.md from workspace root', async () => {
    fs.writeFileSync(
      path.join(tempWorkspace, 'CLAUDE.md'),
      'Run npm test before making commits.',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tempWorkspace, 'AGENTS.md'),
      'Use Docker container for C++ builds.',
      'utf-8',
    );

    const loader = new ProjectRuleLoader({ userHomeDir: tempHome });
    const result = await loader.loadRules(tempWorkspace);

    expect(result.rules.length).toBe(2);
    expect(result.formattedPrompt).toContain('CLAUDE.md');
    expect(result.formattedPrompt).toContain('AGENTS.md');
    expect(result.formattedPrompt).toContain('Run npm test before making commits.');
    expect(result.formattedPrompt).toContain('Use Docker container for C++ builds.');
  });

  it('loads global rules from user home directory with global scope', async () => {
    const globalVihDir = path.join(tempHome, '.vi-harness');
    fs.mkdirSync(globalVihDir, { recursive: true });
    fs.writeFileSync(
      path.join(globalVihDir, 'VI.md'),
      'Global user rule: Prefer functional programming patterns.',
      'utf-8',
    );

    const loader = new ProjectRuleLoader({ userHomeDir: tempHome });
    const result = await loader.loadRules(tempWorkspace);

    expect(result.rules.length).toBe(1);
    expect(result.rules[0]!.scope).toBe('global');
    expect(result.formattedPrompt).toContain('Global user rule: Prefer functional programming patterns.');
  });

  it('loads subdirectory scoped rules when current directory is nested', async () => {
    const subDir = path.join(tempWorkspace, 'src', 'backend');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(subDir, 'RULES.md'),
      'Backend Rule: Use PostgreSQL transactions for financial updates.',
      'utf-8',
    );

    const loader = new ProjectRuleLoader({ userHomeDir: tempHome });
    const result = await loader.loadRules(tempWorkspace, subDir);

    expect(result.rules.length).toBe(1);
    expect(result.rules[0]!.scope).toBe('directory');
    expect(result.formattedPrompt).toContain('PostgreSQL transactions');
  });

  it('enforces character budget and truncates oversized rules gracefully', async () => {
    const oversizedContent = 'X'.repeat(5000);
    fs.writeFileSync(path.join(tempWorkspace, 'VI.md'), oversizedContent, 'utf-8');

    const loader = new ProjectRuleLoader({
      userHomeDir: tempHome,
      maxBudgetChars: 500,
    });
    const result = await loader.loadRules(tempWorkspace);

    expect(result.totalCharacters).toBeLessThanOrEqual(600);
    expect(result.formattedPrompt).toContain('[... Remaining guidelines truncated to fit context budget ...]');
  });
});
