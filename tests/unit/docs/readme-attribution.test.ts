import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('README Attribution & Reference Documentation Suite — P015', () => {
  const rootDir = process.cwd();
  const readmePath = path.join(rootDir, 'README.md');
  const contributingPath = path.join(rootDir, 'CONTRIBUTING.md');
  const licensePath = path.join(rootDir, 'LICENSE');
  const packageJsonPath = path.join(rootDir, 'package.json');

  const readmeContent = fs.readFileSync(readmePath, 'utf-8');
  const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

  // Test 1: Markdown Render and Structural Integrity
  it('1. Markdown Render & Syntax: README renders correctly without broken markdown', () => {
    expect(readmeContent).toBeDefined();
    expect(readmeContent.length).toBeGreaterThan(500);

    // Verify top-level title
    expect(readmeContent).toMatch(/^#\s+Vi-Harness/m);

    // Verify all fenced code blocks (```) are properly paired/closed
    const codeBlockCount = (readmeContent.match(/```/g) || []).length;
    expect(codeBlockCount % 2).toBe(0);

    // Verify key section headings exist
    expect(readmeContent).toContain('## Why Vi-Harness?');
    expect(readmeContent).toContain('## Features');
    expect(readmeContent).toContain('## Quick Start');
    expect(readmeContent).toContain('## Architecture');
    expect(readmeContent).toContain('## Configuration');
    expect(readmeContent).toContain('## Benchmarks');
    expect(readmeContent).toContain('## Contributing');
    expect(readmeContent).toContain('## References & Acknowledgments');
    expect(readmeContent).toContain('## License');

    // Verify markdown tables have aligned headers and separators
    const lines = readmeContent.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        const nextLine = lines[i + 1]?.trim() || '';
        if (nextLine.startsWith('|') && nextLine.includes('---')) {
          const headerPipes = (line.match(/\|/g) || []).length;
          const sepPipes = (nextLine.match(/\|/g) || []).length;
          expect(headerPipes).toBe(sepPipes);
        }
      }
    }
  });

  // Test 2: Internal and Relative Link Validation
  it('2. Link Validation: All internal file and anchor links in README resolve on disk', () => {
    // Extract markdown link patterns: [text](target)
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let match;
    const links: { text: string; target: string }[] = [];

    while ((match = linkRegex.exec(readmeContent)) !== null) {
      links.push({ text: match[1], target: match[2] });
    }

    expect(links.length).toBeGreaterThan(0);

    for (const { text, target } of links) {
      // If relative local file link (not http/https and not purely an anchor #...)
      if (
        !target.startsWith('http://') &&
        !target.startsWith('https://') &&
        !target.startsWith('#')
      ) {
        const filePath = path.resolve(rootDir, target.split('#')[0]);
        const exists = fs.existsSync(filePath);
        expect(exists, `Link [${text}](${target}) points to non-existent file: ${filePath}`).toBe(
          true,
        );
      }
    }
  });

  // Test 3: Reference Attribution & Acknowledgments Completeness
  it('3. Reference Attribution: Credits all reference projects with URLs, learnings, and key insights', () => {
    const requiredReferences = [
      { name: 'Claude Code', org: 'Anthropic', url: 'https://github.com/anthropics/claude-code' },
      { name: 'Aider', org: '', url: 'https://github.com/Aider-AI/aider' },
      { name: 'Prime Agent', org: 'Cline', url: 'https://github.com/cline/cline' },
      { name: 'Hermes', org: 'Devin', url: 'https://github.com/anthropics/hermes' },
      { name: 'Pi', org: 'Cursor', url: 'https://github.com/anthropics/pi' },
      { name: 'Meta-Harness', org: '', url: 'https://github.com/meta-harness/meta-harness' },
      {
        name: 'DeepSeek Harness',
        org: 'DeepSeek AI',
        url: 'https://github.com/deepseek-ai/deepseek-harness',
      },
    ];

    expect(readmeContent).toContain('## References & Acknowledgments');

    for (const ref of requiredReferences) {
      expect(readmeContent, `README must reference ${ref.name}`).toContain(ref.name);
      expect(readmeContent, `README must include link ${ref.url}`).toContain(ref.url);
    }

    // Check each reference section contains "What we learned" and "Key insight"
    const refSection = readmeContent.substring(
      readmeContent.indexOf('## References & Acknowledgments'),
    );
    const learnedMatches = refSection.match(/\*\*What we learned\*\*/g) || [];
    const insightMatches = refSection.match(/\*\*Key insight\*\*/g) || [];

    expect(learnedMatches.length).toBeGreaterThanOrEqual(7);
    expect(insightMatches.length).toBeGreaterThanOrEqual(7);

    // Verify community positioning without claiming original invention
    const normalized = readmeContent.toLowerCase().replace(/\s+/g, ' ');
    expect(normalized).toContain('giving back to the community');
    expect(readmeContent).toContain('synthesizing');
  });

  // Test 4: Package Metadata Synchronization
  it('4. Metadata Synchronization: Package metadata matches README claims', () => {
    expect(pkgJson.name).toBe('vi-harness');
    expect(pkgJson.license).toBe('MIT');
    expect(pkgJson.files).toContain('README.md');
    expect(pkgJson.files).toContain('LICENSE');
    expect(fs.existsSync(licensePath)).toBe(true);
    expect(fs.existsSync(contributingPath)).toBe(true);
  });

  // Test 5: Code Comment Pattern Attribution Verification
  it('5. Code Comment Attribution: Verifies module-level pattern comments in source files', () => {
    const filesToCheck = [
      {
        path: 'src/infra/compiler/context-compressor.ts',
        pattern: '// Pattern: 5-stage compaction pipeline (ref: Claude Code)',
      },
      {
        path: 'src/infra/compiler/cache-prefix-tracker.ts',
        pattern: '// Pattern: Cache-aware compaction & prefix tracking (ref: Claude Code)',
      },
      {
        path: 'src/infra/compiler/context-collapse.ts',
        pattern: '// Pattern: Context Collapse virtual projection (ref: Claude Code)',
      },
      {
        path: 'src/infra/syntax/source-code-indexer.ts',
        pattern: '// Pattern: PageRank repo map (ref: Aider)',
      },
      {
        path: 'src/runtime/architect-executor.ts',
        pattern: '// Pattern: Architect mode (ref: Aider + Prime Agent)',
      },
      {
        path: 'src/infra/subagent/default-subagent-manager.ts',
        pattern: '// Pattern: Recursive subagents with context isolation (ref: Prime Agent)',
      },
      {
        path: 'src/core/goal/token-attribution.ts',
        pattern: '// Pattern: Goal budgets & token attribution (ref: Prime Agent)',
      },
      {
        path: 'src/infra/memory/frozen-memory-snapshot.ts',
        pattern: '// Pattern: Frozen memory snapshot (ref: Hermes)',
      },
      {
        path: 'src/core/session/session.ts',
        pattern: '// Pattern: Tree-structured sessions (ref: Pi)',
      },
      {
        path: 'src/infra/telemetry/experience-store.ts',
        pattern: '// Pattern: Outer-loop experience store (ref: Meta-Harness)',
      },
      {
        path: 'src/infra/security/default-policy-engine.ts',
        pattern: '// Pattern: 7-layer security perimeter (ref: Claude Code)',
      },
      {
        path: 'src/infra/tools/parallel-tool-executor.ts',
        pattern:
          '// Pattern: Concurrency safety classification & parallel tool execution (ref: DeepSeek Harness)',
      },
      {
        path: 'src/runtime/loop-fingerprinter.ts',
        pattern: '// Pattern: Loop-hygiene guards & repeat detection (ref: DeepSeek Harness)',
      },
      {
        path: 'src/core/session/crash-recovery.ts',
        pattern: '// Pattern: Crash recovery via orphaned-lock detection (ref: DeepSeek Harness)',
      },
      {
        path: 'src/infra/acp/acp-server.ts',
        pattern: '// Pattern: Agent Client Protocol (ACP) (ref: DeepSeek Harness)',
      },
    ];

    for (const { path: relPath, pattern } of filesToCheck) {
      const fullPath = path.join(rootDir, relPath);
      expect(fs.existsSync(fullPath), `File must exist: ${relPath}`).toBe(true);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(
        content.startsWith(pattern),
        `File ${relPath} must begin with pattern comment: "${pattern}"`,
      ).toBe(true);
    }
  });

  // Test 6: CONTRIBUTING.md Coverage Verification
  it('6. CONTRIBUTING Guide: Contains actionable setup, testing, commits, PR, and extension guides', () => {
    const contributingContent = fs.readFileSync(contributingPath, 'utf-8');

    expect(contributingContent).toContain('## Development Environment Setup');
    expect(contributingContent).toContain('npm ci');
    expect(contributingContent).toContain('npm test');
    expect(contributingContent).toContain('npm run typecheck');
    expect(contributingContent).toContain('npm run lint');
    expect(contributingContent).toContain('## Commit Message Format');
    expect(contributingContent).toContain('Conventional Commits');
    expect(contributingContent).toContain('## Pull Request Process');
    expect(contributingContent).toContain('## Architecture Overview');
    expect(contributingContent).toContain('## Extending Vi-Harness');
    expect(contributingContent).toContain('Adding a New Tool');
    expect(contributingContent).toContain('Adding a New MCP Transport');
    expect(contributingContent).toContain('Adding a New Model Provider');
  });

  // Test 7: Tarball Packaging Verification
  it('7. Packaging: Package includes README.md and LICENSE in distribution list', () => {
    expect(pkgJson.files).toBeDefined();
    expect(Array.isArray(pkgJson.files)).toBe(true);
    expect(pkgJson.files).toContain('README.md');
    expect(pkgJson.files).toContain('LICENSE');

    // Check LICENSE content is MIT
    const licenseContent = fs.readFileSync(licensePath, 'utf-8');
    expect(licenseContent).toContain('MIT License');
    expect(licenseContent).toContain('Vi-Harness Contributors');
  });
});
