/**
 * Profile Loader (DeepSeek Harness Reference).
 *
 * Loads built-in distribution profiles (web, headless, ci, eval) and discovers
 * user-defined custom YAML/JSON profiles from ~/.vi-harness/profiles/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProfileConfig } from '../../core/profile/types.js';

export const BUILTIN_PROFILES: Record<string, ProfileConfig> = {
  web: {
    name: 'web',
    description: 'Web UI and HTTP API server with MCP tool serving and SQLite persistence',
    bundles: ['base', 'web', 'mcp', 'sqlite'],
    patches: [
      {
        target: 'mcp-server',
        config: { enabled: true, transport: 'http', port: 3000 },
      },
    ],
    env: {
      VI_HARNESS_MODE: 'web',
    },
  },
  headless: {
    name: 'headless',
    description: 'One-shot task runner for headless automation and command line execution',
    bundles: ['base', 'headless', 'sqlite'],
    patches: [
      {
        target: 'logger',
        config: { format: 'pretty', silentBanner: false },
      },
    ],
    env: {
      VI_HARNESS_MODE: 'headless',
    },
  },
  ci: {
    name: 'ci',
    description: 'Automated CI/CD benchmark and reporting mode with deterministic execution',
    bundles: ['base', 'headless', 'benchmark', 'report'],
    patches: [
      {
        target: 'logger',
        config: { format: 'json' },
      },
      {
        target: 'context-compiler',
        config: { deterministic: true },
      },
    ],
    env: {
      VI_HARNESS_MODE: 'ci',
      CI: 'true',
    },
  },
  eval: {
    name: 'eval',
    description: 'Full evaluation benchmark mode for TBench and ProjDevBench',
    bundles: ['base', 'headless', 'tbench', 'projdevbench', 'sqlite'],
    patches: [
      {
        target: 'benchmark-runner',
        config: { maxIterations: 30, isolation: true },
      },
    ],
    env: {
      VI_HARNESS_MODE: 'eval',
    },
  },
};

export class ProfileLoader {
  private readonly defaultProfilesDir: string;

  constructor(customProfilesDir?: string) {
    this.defaultProfilesDir =
      customProfilesDir ??
      process.env['VI_HARNESS_PROFILES_DIR'] ??
      path.join(os.homedir(), '.vi-harness', 'profiles');
  }

  /**
   * Load a profile by name. Checks built-in profiles first, then custom directory.
   */
  async loadProfile(name: string, overrideDir?: string): Promise<ProfileConfig> {
    const trimmed = name.trim().toLowerCase();

    // 1. Check built-in profiles
    if (BUILTIN_PROFILES[trimmed]) {
      return { ...BUILTIN_PROFILES[trimmed]! };
    }

    // 2. Search filesystem for custom profile
    const searchDir = overrideDir ?? this.defaultProfilesDir;
    const candidates = [
      path.join(searchDir, `${name}.json`),
      path.join(searchDir, `${name}.yml`),
      path.join(searchDir, `${name}.yaml`),
      path.join(searchDir, `${trimmed}.json`),
      path.join(searchDir, `${trimmed}.yml`),
      path.join(searchDir, `${trimmed}.yaml`),
    ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        if (filePath.endsWith('.json')) {
          return this.parseJsonProfile(raw, name);
        } else {
          return this.parseYamlProfile(raw, name);
        }
      }
    }

    throw new Error(
      `Profile '${name}' not found. Available built-in profiles: ${Object.keys(BUILTIN_PROFILES).join(', ')}. Looked in: ${searchDir}`,
    );
  }

  /**
   * List all available profiles (built-in + detected custom profiles).
   */
  async listProfiles(overrideDir?: string): Promise<ProfileConfig[]> {
    const list: ProfileConfig[] = Object.values(BUILTIN_PROFILES).map((p) => ({ ...p }));
    const searchDir = overrideDir ?? this.defaultProfilesDir;

    if (fs.existsSync(searchDir)) {
      const files = fs.readdirSync(searchDir);
      for (const file of files) {
        if (file.endsWith('.json') || file.endsWith('.yml') || file.endsWith('.yaml')) {
          const filePath = path.join(searchDir, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const baseName = path.basename(file, path.extname(file));
            const profile = file.endsWith('.json')
              ? this.parseJsonProfile(raw, baseName)
              : this.parseYamlProfile(raw, baseName);
            // Don't duplicate built-in overrides
            if (!list.some((p) => p.name.toLowerCase() === profile.name.toLowerCase())) {
              list.push(profile);
            }
          } catch {
            // Ignore unparseable profile files in listing
          }
        }
      }
    }

    return list;
  }

  /**
   * Parse JSON profile configuration.
   */
  parseJsonProfile(content: string, fallbackName: string): ProfileConfig {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid JSON profile format: root must be an object');
    }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : fallbackName,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      bundles: Array.isArray(parsed.bundles) ? parsed.bundles.map(String) : ['base'],
      patches: Array.isArray(parsed.patches) ? parsed.patches : undefined,
      env: parsed.env && typeof parsed.env === 'object' ? parsed.env : undefined,
      metadata:
        parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : undefined,
    };
  }

  /**
   * Zero-dependency Lightweight YAML Profile Parser for standard key-values, lists, and nested configs.
   */
  parseYamlProfile(content: string, fallbackName: string): ProfileConfig {
    const lines = content.split(/\r?\n/);
    const result: Record<string, any> = {};

    let currentPatch: Record<string, any> | null = null;
    let inPatches = false;
    let inEnv = false;
    let inBundles = false;

    for (let line of lines) {
      // Remove comments and trim trailing whitespace
      const commentIdx = line.indexOf('#');
      if (commentIdx >= 0) {
        line = line.substring(0, commentIdx);
      }
      if (!line.trim()) continue;

      const indent = line.search(/\S/);
      const trimmed = line.trim();

      if (indent === 0) {
        // Top-level key
        inPatches = false;
        inEnv = false;
        inBundles = false;
        currentPatch = null;

        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const key = trimmed.substring(0, colonIdx).trim();
          const val = trimmed.substring(colonIdx + 1).trim();

          if (key === 'bundles') {
            inBundles = true;
            result.bundles = [];
          } else if (key === 'patches') {
            inPatches = true;
            result.patches = [];
          } else if (key === 'env') {
            inEnv = true;
            result.env = {};
          } else if (val) {
            result[key] = this.parseScalar(val);
          }
        }
      } else if (inBundles && trimmed.startsWith('-')) {
        const item = trimmed.substring(1).trim();
        if (item) {
          result.bundles.push(item);
        }
      } else if (inEnv && trimmed.includes(':')) {
        const [k, ...rest] = trimmed.split(':');
        if (k && rest.length > 0) {
          result.env[k.trim()] = String(this.parseScalar(rest.join(':').trim()));
        }
      } else if (inPatches) {
        if (trimmed.startsWith('-')) {
          const restOfLine = trimmed.substring(1).trim();
          currentPatch = {};
          result.patches.push(currentPatch);
          if (restOfLine.includes(':')) {
            const [k, ...v] = restOfLine.split(':');
            if (k) currentPatch[k.trim()] = this.parseScalar(v.join(':').trim());
          }
        } else if (currentPatch) {
          const [k, ...v] = trimmed.split(':');
          const fieldKey = k?.trim();
          const valStr = v.join(':').trim();

          if (fieldKey === 'config') {
            currentPatch.config = {};
          } else if (currentPatch.config && indent >= 4) {
            if (fieldKey && valStr) {
              currentPatch.config[fieldKey] = this.parseScalar(valStr);
            }
          } else if (fieldKey && valStr) {
            currentPatch[fieldKey] = this.parseScalar(valStr);
          }
        }
      }
    }

    return {
      name: typeof result.name === 'string' ? result.name : fallbackName,
      description: typeof result.description === 'string' ? result.description : undefined,
      bundles:
        Array.isArray(result.bundles) && result.bundles.length > 0 ? result.bundles : ['base'],
      patches: Array.isArray(result.patches) ? result.patches : undefined,
      env: result.env && typeof result.env === 'object' ? result.env : undefined,
      metadata:
        result.metadata && typeof result.metadata === 'object' ? result.metadata : undefined,
    };
  }

  private parseScalar(val: string): any {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (val === 'null') return null;
    if (!isNaN(Number(val)) && val !== '') return Number(val);
    // Strip quotes if wrapped
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      return val.substring(1, val.length - 1);
    }
    return val;
  }
}
