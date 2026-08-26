/**
 * CLI Auto-Update Checker.
 *
 * Checks npm registry for latest vi-harness version with:
 * - 24-hour rate-limiting cache (~/.vi-harness/update-check.json)
 * - 3-second non-blocking timeout
 * - Zero failure propagation to main CLI process
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface UpdateCheckCache {
  lastChecked: number;
  latestVersion: string;
  currentVersion: string;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  cached: boolean;
}

export interface UpdateCheckOptions {
  currentVersion?: string;
  cacheFilePath?: string;
  checkIntervalMs?: number;
  registryUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Compare two semver strings (e.g. "0.1.0" and "0.2.0").
 * Returns:
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *   1 if v1 > v2
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '').split('-')[0]!.split('.').map(Number);
  const clean2 = v2.replace(/^v/, '').split('-')[0]!.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const num1 = clean1[i] ?? 0;
    const num2 = clean2[i] ?? 0;
    if (num1 < num2) return -1;
    if (num1 > num2) return 1;
  }
  return 0;
}

/**
 * Format a standout terminal banner when an update is available.
 */
export function formatUpdateNotice(currentVersion: string, latestVersion: string): string {
  const c = currentVersion.replace(/^v/, '');
  const l = latestVersion.replace(/^v/, '');
  return `\n┌────────────────────────────────────────────────────────┐\n│  Update available: v${c} → v${l}${' '.repeat(Math.max(0, 26 - c.length - l.length))}│\n│  Run: npm install -g vi-harness                        │\n└────────────────────────────────────────────────────────┘\n`;
}

/**
 * Perform the update check against npm registry.
 */
export async function checkForUpdates(
  options: UpdateCheckOptions = {},
): Promise<UpdateCheckResult | null> {
  const currentVersion = options.currentVersion ?? '0.1.0';
  const checkIntervalMs = options.checkIntervalMs ?? 24 * 60 * 60 * 1000; // 24 hours
  const registryUrl = options.registryUrl ?? 'https://registry.npmjs.org/vi-harness/latest';
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetchImpl = options.fetchFn ?? globalThis.fetch;

  const defaultCacheFile =
    process.env['VI_HARNESS_UPDATE_CACHE'] ??
    path.join(os.homedir(), '.vi-harness', 'update-check.json');
  const cacheFile = options.cacheFilePath ?? defaultCacheFile;

  const now = Date.now();

  // 1. Read existing cache
  if (fs.existsSync(cacheFile)) {
    try {
      const raw = fs.readFileSync(cacheFile, 'utf-8');
      const cache: UpdateCheckCache = JSON.parse(raw);
      if (now - cache.lastChecked < checkIntervalMs) {
        const updateAvailable = compareSemver(currentVersion, cache.latestVersion) < 0;
        return {
          updateAvailable,
          currentVersion,
          latestVersion: cache.latestVersion,
          cached: true,
        };
      }
    } catch {
      // Ignore corrupted cache file
    }
  }

  // 2. Query registry if cache expired or missing
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetchImpl(registryUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `vi-harness/${currentVersion}`,
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();
    const latestVersion = typeof data.version === 'string' ? data.version : currentVersion;

    // 3. Save cache
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const newCache: UpdateCheckCache = {
        lastChecked: now,
        latestVersion,
        currentVersion,
      };
      fs.writeFileSync(cacheFile, JSON.stringify(newCache, null, 2), 'utf-8');
    } catch {
      // Ignore write errors to user home directory
    }

    const updateAvailable = compareSemver(currentVersion, latestVersion) < 0;
    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      cached: false,
    };
  } catch {
    // Network errors or timeout - gracefully return null without failing
    return null;
  }
}

/**
 * Non-blocking fire-and-forget update check trigger for CLI startup.
 */
export function triggerBackgroundUpdateCheck(currentVersion = '0.1.0'): void {
  // Fire and forget
  checkForUpdates({ currentVersion })
    .then((res) => {
      if (res?.updateAvailable) {
        process.stderr.write(formatUpdateNotice(res.currentVersion, res.latestVersion));
      }
    })
    .catch(() => {
      // Never throw
    });
}
