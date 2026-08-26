import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  compareSemver,
  formatUpdateNotice,
  checkForUpdates,
} from '../../../src/cli/update-check.js';

describe('CLI Update Checker', () => {
  let tmpDir: string;
  let cacheFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-update-test-'));
    cacheFile = path.join(tmpDir, 'update-check.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('compareSemver', () => {
    it('returns -1 when current is older than latest', () => {
      expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
      expect(compareSemver('0.1.0', '1.0.0')).toBe(-1);
      expect(compareSemver('0.1.1', '0.1.2')).toBe(-1);
    });

    it('returns 0 when versions are identical', () => {
      expect(compareSemver('0.1.0', '0.1.0')).toBe(0);
      expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
      expect(compareSemver('v0.1.0', '0.1.0')).toBe(0);
    });

    it('returns 1 when current is newer than latest', () => {
      expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
      expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
      expect(compareSemver('0.1.5', '0.1.4')).toBe(1);
    });

    it('handles pre-release identifiers gracefully', () => {
      expect(compareSemver('0.1.0-alpha.1', '0.1.0')).toBe(0);
      expect(compareSemver('0.1.0-rc.1', '0.2.0')).toBe(-1);
    });
  });

  describe('formatUpdateNotice', () => {
    it('formats a clean box notice with version transition', () => {
      const banner = formatUpdateNotice('0.1.0', '0.2.0');
      expect(banner).toContain('Update available: v0.1.0 → v0.2.0');
      expect(banner).toContain('npm install -g vi-harness');
    });
  });

  describe('checkForUpdates', () => {
    it('fetches latest version from registry when no cache exists', async () => {
      const mockFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ version: '0.2.0' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      const result = await checkForUpdates({
        currentVersion: '0.1.0',
        cacheFilePath: cacheFile,
        fetchFn: mockFetch,
      });

      expect(result).not.toBeNull();
      expect(result?.updateAvailable).toBe(true);
      expect(result?.latestVersion).toBe('0.2.0');
      expect(result?.cached).toBe(false);

      // Verify cache was written
      expect(fs.existsSync(cacheFile)).toBe(true);
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      expect(cached.latestVersion).toBe('0.2.0');
    });

    it('uses cached version if interval has not elapsed', async () => {
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({
          lastChecked: Date.now() - 1000, // 1 second ago
          latestVersion: '0.3.0',
          currentVersion: '0.1.0',
        }),
      );

      let fetchCalled = false;
      const mockFetch: typeof fetch = async () => {
        fetchCalled = true;
        return new Response(JSON.stringify({ version: '0.4.0' }));
      };

      const result = await checkForUpdates({
        currentVersion: '0.1.0',
        cacheFilePath: cacheFile,
        checkIntervalMs: 60000,
        fetchFn: mockFetch,
      });

      expect(fetchCalled).toBe(false);
      expect(result?.cached).toBe(true);
      expect(result?.latestVersion).toBe('0.3.0');
      expect(result?.updateAvailable).toBe(true);
    });

    it('handles network failure gracefully without throwing', async () => {
      const failingFetch: typeof fetch = async () => {
        throw new Error('Network timeout');
      };

      const result = await checkForUpdates({
        currentVersion: '0.1.0',
        cacheFilePath: cacheFile,
        fetchFn: failingFetch,
      });

      expect(result).toBeNull();
    });

    it('handles 404/500 HTTP responses gracefully', async () => {
      const errorFetch: typeof fetch = async () => new Response('Not Found', { status: 404 });

      const result = await checkForUpdates({
        currentVersion: '0.1.0',
        cacheFilePath: cacheFile,
        fetchFn: errorFetch,
      });

      expect(result).toBeNull();
    });
  });
});
