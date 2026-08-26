/**
 * Environment Scrubber & Secure Temp Manager (DeepSeek Harness defensive pattern).
 *
 * Drops sensitive credential patterns (KEY, SECRET, TOKEN, PASSWORD, CREDENTIAL, AUTH)
 * before spawning child processes (git, shell tools, linters, tests) to prevent accidental credential leakage.
 * Also provides secure temporary file directory and file creation with 0o700/0o600 permissions and exclusive opens ('wx').
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

export const SENSITIVE_PATTERNS: ReadonlyArray<string> = [
  'KEY',
  'SECRET',
  'TOKEN',
  'PASSWORD',
  'CREDENTIAL',
  'AUTH',
  'PRIVATE',
  'PASSWD',
];

/**
 * Cleanse an environment object by dropping any environment variable names matching sensitive patterns.
 */
export function scrubEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    if (SENSITIVE_PATTERNS.some((pattern) => upperKey.includes(pattern))) {
      continue; // Drop sensitive variable
    }
    scrubbed[key] = value;
  }
  return scrubbed;
}

export class SecureTempManager {
  /**
   * Create a private temporary directory with 0o700 permissions.
   */
  static createSecureTempDir(prefix: string = 'vi-harness-temp-'): string {
    const tempBase = os.tmpdir();
    const uniqueSuffix = crypto.randomUUID();
    const dirPath = path.join(tempBase, `${prefix}${uniqueSuffix}`);
    fs.mkdirSync(dirPath, { mode: 0o700, recursive: true });
    return dirPath;
  }

  /**
   * Create and write a secure temporary file with 0o600 permissions and exclusive open ('wx').
   */
  static writeSecureTempFile(dir: string, content: string, fileName?: string): string {
    const name = fileName ?? `file-${crypto.randomUUID()}.tmp`;
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content, {
      mode: 0o600,
      flag: 'wx',
      encoding: 'utf-8',
    });
    return filePath;
  }
}
