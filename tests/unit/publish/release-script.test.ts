import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SemanticReleaseEngine, type ParsedCommit } from '../../../scripts/release.js';

describe('Semantic Release & Changelog Engine', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-release-test-'));
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'vi-harness', version: '0.1.0' }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseCommit', () => {
    it('parses standard conventional commit with scope', () => {
      const parsed = SemanticReleaseEngine.parseCommit('feat(mcp): add stdio and http transport');
      expect(parsed.type).toBe('feat');
      expect(parsed.scope).toBe('mcp');
      expect(parsed.subject).toBe('add stdio and http transport');
      expect(parsed.isBreaking).toBe(false);
    });

    it('detects breaking change marked with exclamation mark', () => {
      const parsed = SemanticReleaseEngine.parseCommit('fix(storage)!: drop obsolete tables');
      expect(parsed.type).toBe('fix');
      expect(parsed.isBreaking).toBe(true);
    });

    it('detects breaking change in commit footer', () => {
      const message =
        'feat(router): overhaul utility score calculation\n\nBREAKING CHANGE: router options schema modified.';
      const parsed = SemanticReleaseEngine.parseCommit(message);
      expect(parsed.type).toBe('feat');
      expect(parsed.isBreaking).toBe(true);
    });

    it('defaults non-conforming messages to chore type', () => {
      const parsed = SemanticReleaseEngine.parseCommit('miscellaneous updates');
      expect(parsed.type).toBe('chore');
      expect(parsed.subject).toBe('miscellaneous updates');
      expect(parsed.isBreaking).toBe(false);
    });
  });

  describe('determineBumpType & calculateNextVersion', () => {
    it('determines major bump on breaking commit', () => {
      const commits: ParsedCommit[] = [{ type: 'feat', subject: 'new feature', isBreaking: true }];
      const bump = SemanticReleaseEngine.determineBumpType(commits);
      expect(bump).toBe('major');
      expect(SemanticReleaseEngine.calculateNextVersion('0.1.0', bump)).toBe('1.0.0');
    });

    it('determines minor bump on feature commit without breaking changes', () => {
      const commits: ParsedCommit[] = [
        { type: 'feat', subject: 'add profile system', isBreaking: false },
        { type: 'fix', subject: 'patch memory leak', isBreaking: false },
      ];
      const bump = SemanticReleaseEngine.determineBumpType(commits);
      expect(bump).toBe('minor');
      expect(SemanticReleaseEngine.calculateNextVersion('0.1.0', bump)).toBe('0.2.0');
    });

    it('determines patch bump on fix and perf commits', () => {
      const commits: ParsedCommit[] = [
        { type: 'fix', subject: 'fix crash on reload', isBreaking: false },
        { type: 'perf', subject: 'speed up context compilation', isBreaking: false },
      ];
      const bump = SemanticReleaseEngine.determineBumpType(commits);
      expect(bump).toBe('patch');
      expect(SemanticReleaseEngine.calculateNextVersion('0.1.0', bump)).toBe('0.1.1');
    });
  });

  describe('formatChangelogSection', () => {
    it('formats a clean markdown changelog with emojis and categorization', () => {
      const commits: ParsedCommit[] = [
        { type: 'feat', scope: 'profile', subject: 'add custom profiles', isBreaking: false },
        {
          type: 'fix',
          scope: 'sqlite',
          subject: 'correct migration column type',
          isBreaking: false,
        },
      ];

      const md = SemanticReleaseEngine.formatChangelogSection('0.2.0', commits, '2026-08-19');
      expect(md).toContain('## [0.2.0] - 2026-08-19');
      expect(md).toContain('### 🚀 Features');
      expect(md).toContain('- **profile**: add custom profiles');
      expect(md).toContain('### 🐛 Bug Fixes');
      expect(md).toContain('- **sqlite**: correct migration column type');
    });
  });

  describe('runRelease', () => {
    it('executes dry-run without modifying package.json or CHANGELOG.md', () => {
      const result = SemanticReleaseEngine.runRelease({
        rootDir: tmpDir,
        dryRun: true,
        commits: ['feat(cli): add update checker'],
      });

      expect(result.dryRun).toBe(true);
      expect(result.previousVersion).toBe('0.1.0');
      expect(result.nextVersion).toBe('0.2.0');
      expect(result.bumpType).toBe('minor');

      // Package file should be unchanged in dryRun
      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBe('0.1.0');
    });

    it('updates package.json and CHANGELOG.md when not in dry-run mode', () => {
      const result = SemanticReleaseEngine.runRelease({
        rootDir: tmpDir,
        dryRun: false,
        skipGit: true,
        commits: ['fix(core): patch bug', 'feat(core): new capability'],
      });

      expect(result.nextVersion).toBe('0.2.0');

      const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, 'package.json'), 'utf-8'));
      expect(pkg.version).toBe('0.2.0');

      const changelog = fs.readFileSync(path.join(tmpDir, 'CHANGELOG.md'), 'utf-8');
      expect(changelog).toContain('## [0.2.0]');
      expect(changelog).toContain('new capability');
    });
  });
});
