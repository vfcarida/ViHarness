import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ProfileLoader, BUILTIN_PROFILES } from '../../../src/infra/profile/profile-loader.js';
import { ProfileManager, KNOWN_BUNDLES } from '../../../src/infra/profile/profile-manager.js';

describe('Profile System (DeepSeek Harness Reference)', () => {
  let tmpProfilesDir: string;

  beforeEach(() => {
    tmpProfilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-profiles-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpProfilesDir, { recursive: true, force: true });
  });

  describe('ProfileLoader', () => {
    it('loads all built-in profiles correctly', async () => {
      const loader = new ProfileLoader(tmpProfilesDir);

      const builtins = ['web', 'headless', 'ci', 'eval'];
      for (const name of builtins) {
        const config = await loader.loadProfile(name);
        expect(config.name).toBe(name);
        expect(config.bundles).toBeDefined();
        expect(config.bundles.length).toBeGreaterThan(0);
      }
    });

    it('throws error for unknown profile', async () => {
      const loader = new ProfileLoader(tmpProfilesDir);
      await expect(loader.loadProfile('non-existent-profile')).rejects.toThrow(
        /Profile 'non-existent-profile' not found/,
      );
    });

    it('loads custom JSON profile from profiles directory', async () => {
      const customProfile = {
        name: 'my-custom-runner',
        description: 'Custom profile for local tests',
        bundles: ['base', 'sqlite'],
        env: {
          MY_CUSTOM_VAR: 'custom-value',
        },
        patches: [
          {
            target: 'storage',
            config: {
              busyTimeoutMs: 15000,
            },
          },
        ],
      };

      fs.writeFileSync(
        path.join(tmpProfilesDir, 'my-custom-runner.json'),
        JSON.stringify(customProfile),
        'utf-8',
      );

      const loader = new ProfileLoader(tmpProfilesDir);
      const loaded = await loader.loadProfile('my-custom-runner');

      expect(loaded.name).toBe('my-custom-runner');
      expect(loaded.bundles).toEqual(['base', 'sqlite']);
      expect(loaded.env?.['MY_CUSTOM_VAR']).toBe('custom-value');
      expect(loaded.patches?.[0]?.target).toBe('storage');
    });

    it('loads custom YAML profile from profiles directory', async () => {
      const yamlContent = `
name: yaml-profile
description: Profile defined in YAML
bundles:
  - base
  - headless
env:
  YAML_TEST_KEY: "yaml_success"
`;
      fs.writeFileSync(path.join(tmpProfilesDir, 'yaml-profile.yaml'), yamlContent, 'utf-8');

      const loader = new ProfileLoader(tmpProfilesDir);
      const loaded = await loader.loadProfile('yaml-profile');

      expect(loaded.name).toBe('yaml-profile');
      expect(loaded.bundles).toContain('headless');
      expect(loaded.env?.['YAML_TEST_KEY']).toBe('yaml_success');
    });
  });

  describe('ProfileManager', () => {
    const manager = new ProfileManager();

    it('resolves bundles and applies default bundle settings', () => {
      const resolved = manager.resolveProfile({
        name: 'test-profile',
        bundles: ['base', 'sqlite'],
      });

      expect(resolved.name).toBe('test-profile');
      expect(resolved.activeBundles).toEqual(['base', 'sqlite']);
      expect(resolved.resolvedConfig['persistence']).toBe('sqlite');
      expect(resolved.resolvedConfig['walMode']).toBe(true);
      expect(resolved.resolvedConfig['maxIterations']).toBe(50);
    });

    it('applies configuration patches on top of bundles', () => {
      const resolved = manager.resolveProfile({
        name: 'patched-profile',
        bundles: ['base'],
        patches: [
          {
            target: 'model-router',
            config: {
              deterministic: true,
              defaultCostCap: 5.0,
            },
          },
        ],
      });

      expect(resolved.patches.length).toBe(1);
      const routerConfig = resolved.resolvedConfig['model-router'] as Record<string, unknown>;
      expect(routerConfig['deterministic']).toBe(true);
      expect(routerConfig['defaultCostCap']).toBe(5.0);
    });

    it('applies environment variables to process.env', () => {
      const resolved = manager.resolveProfile({
        name: 'env-profile',
        bundles: ['base'],
        env: {
          TEST_VI_PROFILE_KEY: 'test-profile-val-123',
        },
      });

      manager.applyEnvironment(resolved);
      expect(process.env['TEST_VI_PROFILE_KEY']).toBe('test-profile-val-123');
      delete process.env['TEST_VI_PROFILE_KEY'];
    });

    it('applies profile patches to runtime options', () => {
      const resolved = manager.resolveProfile({
        name: 'options-profile',
        bundles: ['base'],
        patches: [
          {
            target: 'storage',
            config: { customOption: true },
          },
        ],
      });

      const baseOpts = { maxRounds: 10 };
      const updated = manager.applyToRuntimeOptions(resolved, baseOpts);

      expect((updated as any).storageOptions?.customOption).toBe(true);
      expect((updated as any).profile.name).toBe('options-profile');
    });
  });
});
