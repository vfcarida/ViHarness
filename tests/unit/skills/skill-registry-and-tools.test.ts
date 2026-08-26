/**
 * Skill Registry, Tools & Self-Modification Unit Tests (P007).
 *
 * Validates:
 * 1. DefaultSkillRegistry registration, disposer unregistration, catalog browsing, loading.
 * 2. Filesystem skill discovery from workspace directory and package.json.
 * 3. Self-Modification (DeepSeek Harness runtime skill mounting & unmounting).
 * 4. Model-facing tools (`list_skills`, `load_skill`).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DefaultSkillRegistry,
  createListSkillsTool,
  createLoadSkillTool,
} from '../../../src/infra/index.js';
import type { Skill } from '../../../src/core/index.js';

describe('Skill Registry, Tools & Self-Modification (DSH & Hermes) — P007', () => {
  it('1. should register skill, browse catalog, load content, and unregister via disposer', () => {
    const registry = new DefaultSkillRegistry();

    const authSkill: Skill = {
      name: 'oauth2_helper',
      description: 'Guidelines for implementing PKCE OAuth2 in TypeScript',
      content: 'Always validate state parameter and use SHA-256 for code_challenge.',
      source: 'local',
      tags: ['auth', 'security'],
      version: '1.0.0',
    };

    const dispose = registry.register(authSkill);

    // Browse catalog
    const catalog = registry.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.name).toBe('oauth2_helper');
    expect(catalog[0]?.description).toContain('PKCE OAuth2');

    // Load content
    const loaded = registry.load('oauth2_helper');
    expect(loaded).toBeDefined();
    expect(loaded?.content).toContain('SHA-256');

    // Unregister via disposer
    dispose();
    expect(registry.catalog()).toHaveLength(0);
    expect(registry.load('oauth2_helper')).toBeUndefined();
  });

  it('2. should support Self-Modification mounting and unmounting into active session context', () => {
    const registry = new DefaultSkillRegistry();

    registry.register({
      name: 'tdd_discipline',
      description: 'Strict Test-Driven Development workflow',
      content: '1. Write failing test.\n2. Write minimal code.\n3. Refactor.',
      source: 'local',
      tags: ['testing', 'methodology'],
    });

    registry.register({
      name: 'git_conventional_commits',
      description: 'Commit message formatting guidelines',
      content: 'Use feat:, fix:, refactor:, chore: prefixes.',
      source: 'local',
      tags: ['git'],
    });

    expect(registry.listMounted()).toHaveLength(0);
    expect(registry.getMountedSkillContent()).toBe('');

    // Mount TDD skill
    const mounted1 = registry.mountSkill('tdd_discipline');
    expect(mounted1).toBe(true);
    expect(registry.listMounted()).toEqual(['tdd_discipline']);
    expect(registry.getMountedSkillContent()).toContain('Strict Test-Driven Development');

    // Mount Git skill
    registry.mountSkill('git_conventional_commits');
    expect(registry.listMounted()).toEqual(['tdd_discipline', 'git_conventional_commits']);
    expect(registry.getMountedSkillContent()).toContain('feat:, fix:');

    // Unmount TDD skill
    registry.unmountSkill('tdd_discipline');
    expect(registry.listMounted()).toEqual(['git_conventional_commits']);
    expect(registry.getMountedSkillContent()).not.toContain('failing test');
  });

  it('3. should discover skills from filesystem workspace directory and package.json', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-skills-test-'));
    const skillsDir = path.join(tempDir, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    // Write a markdown skill file
    const mdPath = path.join(skillsDir, 'fast-verify.md');
    fs.writeFileSync(
      mdPath,
      '# Fast Test Verification\n\nRun single test files using vitest run path/to/file.test.ts.',
    );

    // Write a package.json with viHarness.skills
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      JSON.stringify({
        name: 'test-project',
        version: '1.2.0',
        viHarness: {
          skills: [
            {
              name: 'pkg_eslint_rule',
              description: 'Enforce strict ESLint checks',
              content: 'Ensure all unused imports are removed before commits.',
              tags: ['lint'],
            },
          ],
        },
      }),
    );

    const registry = new DefaultSkillRegistry();
    const discovered = await registry.discoverSkills({
      workspaceSkillsDirectory: skillsDir,
      packageJsonPath: pkgPath,
      userSkillsDirectory: path.join(tempDir, 'non_existent_user_dir'),
    });

    expect(discovered.length).toBeGreaterThanOrEqual(2);
    expect(registry.load('fast-verify')?.content).toContain('vitest run');
    expect(registry.load('pkg_eslint_rule')?.content).toContain('unused imports');

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('4. should execute list_skills tool and return structured JSON catalog', async () => {
    const registry = new DefaultSkillRegistry();
    registry.register({
      name: 'react_hooks',
      description: 'React hooks optimization patterns',
      content: 'Use useCallback for event handlers passed to memoized children.',
      source: 'local',
      tags: ['react'],
    });

    const tool = createListSkillsTool(registry);
    const result = await tool.execute({}, { correlationId: 'test_call' });

    expect(result.success).toBe(true);
    const catalog = JSON.parse(result.output);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe('react_hooks');
  });

  it('5. should execute load_skill tool and mount skill into active session context', async () => {
    const registry = new DefaultSkillRegistry();
    registry.register({
      name: 'database_index_rule',
      description: 'Indexing foreign keys in Postgres',
      content: 'Always add CREATE INDEX ON foreign_key_column.',
      source: 'local',
      tags: ['db', 'postgres'],
    });

    const tool = createLoadSkillTool(registry, registry);

    // Test successful load
    const result = await tool.execute(
      { name: 'database_index_rule' },
      { correlationId: 'test_call' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain('CREATE INDEX ON');
    expect(registry.listMounted()).toContain('database_index_rule');

    // Test missing skill
    const missingResult = await tool.execute(
      { name: 'non_existent_skill' },
      { correlationId: 'test_call' },
    );
    expect(missingResult.success).toBe(false);
    expect(missingResult.error).toContain('not found');
  });
});
