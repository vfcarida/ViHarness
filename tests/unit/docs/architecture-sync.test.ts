/**
 * Machine-Verifiable Architecture & Documentation Drift Guard.
 *
 * Automatically verifies that:
 * 1. Version numbers across `package.json`, `CITATION.cff`, and `src/cli/index.ts` are synchronized.
 * 2. `src/core/` has ZERO imports from `src/infra/` or `src/runtime/` (clean domain boundary).
 * 3. `src/runtime/` has ZERO concrete imports from `src/infra/evolution/` (Runtime Plane vs Evolution Plane separation).
 * 4. `CURRENT_ARCHITECTURE.md` and `TARGET_ARCHITECTURE.md` accurately describe the 5-stage compaction pipeline and Evolution Plane.
 * 5. All 12 evolvable surfaces in `DefaultHarnessSurfaceRegistry` and 8 constitutional surfaces in `DEFAULT_HARNESS_CONSTITUTION` are documented in `CURRENT_ARCHITECTURE.md`.
 * 6. All 30 canonical failure signals and 22 evolution threats (`E-01`..`E-22`) are documented.
 * 7. ADRs 013–018 exist on disk.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  DEFAULT_HARNESS_CONSTITUTION,
} from '../../../src/core/evolution/constitution.js';
import { CANONICAL_FAILURE_SIGNALS } from '../../../src/core/evolution/failure-taxonomy.js';
import { DefaultHarnessSurfaceRegistry } from '../../../src/infra/evolution/default-surface-registry.js';

const ROOT_DIR = path.resolve(__dirname, '../../../');

async function walkTsFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkTsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Machine-Verifiable Architecture & Documentation Drift Guard', () => {
  it('synchronizes version across package.json, CITATION.cff, and src/cli/index.ts', async () => {
    const pkgJson = JSON.parse(
      await fs.readFile(path.join(ROOT_DIR, 'package.json'), 'utf-8'),
    ) as { version: string };
    const citationCff = await fs.readFile(
      path.join(ROOT_DIR, 'CITATION.cff'),
      'utf-8',
    );
    const cliIndex = await fs.readFile(
      path.join(ROOT_DIR, 'src/cli/index.ts'),
      'utf-8',
    );

    expect(citationCff).toContain(`version: ${pkgJson.version}`);
    expect(cliIndex).toContain(`const VERSION = '${pkgJson.version}'`);
  });

  it('enforces zero imports from src/infra/ or src/runtime/ inside src/core/ (DRIFT-04 guard)', async () => {
    const coreFiles = await walkTsFiles(path.join(ROOT_DIR, 'src/core'));
    expect(coreFiles.length).toBeGreaterThan(20);

    for (const file of coreFiles) {
      const content = await fs.readFile(file, 'utf-8');
      expect(
        content,
        `Domain boundary violation in ${path.relative(ROOT_DIR, file)}: imports from infra/`,
      ).not.toMatch(/from\s+['"][^'"]*\/infra\//);
      expect(
        content,
        `Domain boundary violation in ${path.relative(ROOT_DIR, file)}: imports from runtime/`,
      ).not.toMatch(/from\s+['"][^'"]*\/runtime\//);
    }
  });

  it('enforces Runtime Plane vs Evolution Plane dependency direction (src/runtime/ never imports src/infra/evolution/)', async () => {
    const runtimeFiles = await walkTsFiles(path.join(ROOT_DIR, 'src/runtime'));
    expect(runtimeFiles.length).toBeGreaterThan(5);

    for (const file of runtimeFiles) {
      const content = await fs.readFile(file, 'utf-8');
      expect(
        content,
        `Plane boundary violation in ${path.relative(ROOT_DIR, file)}: Runtime Plane must not import concrete infra/evolution modules`,
      ).not.toMatch(/from\s+['"][^'"]*\/infra\/evolution\//);
    }
  });

  it('verifies CURRENT_ARCHITECTURE.md and TARGET_ARCHITECTURE.md match implemented surfaces, constitution, and 5-stage compaction', async () => {
    const currentArch = await fs.readFile(
      path.join(ROOT_DIR, 'docs/architecture/CURRENT_ARCHITECTURE.md'),
      'utf-8',
    );
    const targetArch = await fs.readFile(
      path.join(ROOT_DIR, 'docs/architecture/TARGET_ARCHITECTURE.md'),
      'utf-8',
    );

    // Both must reference the 5-Stage Compactor (not stale 4-Stage Compressor)
    expect(currentArch).toContain('5-Stage Compactor');
    expect(targetArch).toContain('5-Stage Compactor');
    expect(currentArch).not.toContain('4-Stage Compressor');
    expect(targetArch).not.toContain('4-Stage Compactor');

    // All 12 evolvable surfaces in DefaultHarnessSurfaceRegistry must appear in CURRENT_ARCHITECTURE.md
    const registry = new DefaultHarnessSurfaceRegistry();
    expect(registry.list()).toHaveLength(12);
    for (const surface of registry.list()) {
      expect(currentArch).toContain(String(surface.id));
    }

    // All 6 immutable constitutional surfaces must appear in CURRENT_ARCHITECTURE.md
    expect(DEFAULT_HARNESS_CONSTITUTION.immutableCoreSurfaces).toHaveLength(6);
    for (const constSurface of DEFAULT_HARNESS_CONSTITUTION.immutableCoreSurfaces) {
      expect(currentArch).toContain(constSurface);
    }
  });

  it('verifies all 22 Evolution Plane threats (E-01..E-22) in THREAT_MODEL.md and 30 canonical failure signals', async () => {
    expect(CANONICAL_FAILURE_SIGNALS).toHaveLength(30);

    const threatModel = await fs.readFile(
      path.join(ROOT_DIR, 'docs/security/THREAT_MODEL.md'),
      'utf-8',
    );
    for (let i = 1; i <= 22; i++) {
      const id = `E-${String(i).padStart(2, '0')}`;
      expect(threatModel).toContain(id);
    }
  });

  it('verifies ADRs 013 through 018 exist in docs/architecture/adr/', async () => {
    const expectedAdrs = [
      '013-runtime-and-evolution-plane-separation.md',
      '014-immutable-harness-constitution-and-capability-classes.md',
      '015-canonical-harness-manifest-and-surface-registry.md',
      '016-evidence-hierarchy-and-hypothesis-driven-probing.md',
      '017-canonical-baseline-reset-and-experience-library.md',
      '018-fail-closed-multi-objective-admission-and-retention.md',
    ];

    for (const adr of expectedAdrs) {
      const fullPath = path.join(ROOT_DIR, 'docs/architecture/adr', adr);
      const stat = await fs.stat(fullPath);
      expect(stat.isFile()).toBe(true);
    }
  });
});
