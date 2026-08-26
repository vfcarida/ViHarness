import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DefaultPluginLoader } from '../../../src/core/plugin/index.js';
import { HarnessError } from '../../../src/core/errors/base-error.js';

describe('Plugin Loader & Manifest Discovery — P017', () => {
  let tempDir: string;
  let loader: DefaultPluginLoader;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-plugin-loader-'));
    loader = new DefaultPluginLoader();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup error */
    }
  });

  it('1. Throws descriptive error when local plugin file is not found', async () => {
    const missingPath = path.join(tempDir, 'non-existent.ts');
    await expect(loader.loadFromFile(missingPath)).rejects.toThrow(HarnessError);
    await expect(loader.loadFromFile(missingPath)).rejects.toThrow(/Plugin file not found/);
  });

  it('2. Discovers plugins adhering to viHarness manifest in package.json', async () => {
    const nodeModules = path.join(tempDir, 'node_modules');
    const pkgDir1 = path.join(nodeModules, 'vi-plugin-sample');
    fs.mkdirSync(pkgDir1, { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir1, 'package.json'),
      JSON.stringify({
        name: 'vi-plugin-sample',
        version: '1.2.0',
        description: 'Sample plugin for testing discovery',
        main: 'index.js',
        viHarness: {
          plugin: true,
          provides: ['sampleService'],
          consumes: ['logger', 'clock'],
        },
      }),
      'utf-8',
    );

    const scopedDir = path.join(nodeModules, '@custom-org', 'scoped-plugin');
    fs.mkdirSync(scopedDir, { recursive: true });
    fs.writeFileSync(
      path.join(scopedDir, 'package.json'),
      JSON.stringify({
        name: '@custom-org/scoped-plugin',
        version: '2.0.0',
        viHarness: {
          plugin: true,
          provides: ['customAuth'],
          consumes: ['storage'],
        },
      }),
      'utf-8',
    );

    // Non-plugin package
    const plainPkg = path.join(nodeModules, 'plain-lib');
    fs.mkdirSync(plainPkg, { recursive: true });
    fs.writeFileSync(
      path.join(plainPkg, 'package.json'),
      JSON.stringify({ name: 'plain-lib', version: '1.0.0' }),
      'utf-8',
    );

    const discovered = await loader.discover(tempDir);
    expect(discovered.length).toBe(2);

    const sample = discovered.find((m) => m.name === 'vi-plugin-sample');
    expect(sample).toBeDefined();
    expect(sample?.provides).toContain('sampleService');
    expect(sample?.consumes).toContain('logger');

    const scoped = discovered.find((m) => m.name === '@custom-org/scoped-plugin');
    expect(scoped).toBeDefined();
    expect(scoped?.provides).toContain('customAuth');
  });

  it('3. Returns empty manifest array when node_modules does not exist', async () => {
    const emptyDir = path.join(tempDir, 'empty-workspace');
    fs.mkdirSync(emptyDir, { recursive: true });

    const manifests = await loader.discover(emptyDir);
    expect(manifests).toEqual([]);
  });

  it('4. Handles malformed package.json gracefully without crashing discovery', async () => {
    const nodeModules = path.join(tempDir, 'node_modules');
    const brokenDir = path.join(nodeModules, 'broken-pkg');
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, 'package.json'), '{ NOT VALID JSON', 'utf-8');

    const manifests = await loader.discover(tempDir);
    expect(manifests).toEqual([]);
  });

  it('5. Throws descriptive error when loading a non-existent package', async () => {
    await expect(loader.loadFromPackage('@non-existent/package-xyz-123')).rejects.toThrow(
      /Failed to load plugin package/,
    );
  });
});
