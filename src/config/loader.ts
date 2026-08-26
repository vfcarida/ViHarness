/**
 * Configuration Loader for Vi-Harness.
 *
 * Implements tiered configuration resolution with strict precedence:
 * CLI Flags > Environment Variables > Configuration File (YAML/JSON) > Defaults.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ViHarnessConfig, type ViHarnessConfigType } from './schema.js';

export interface CliConfigOverrides {
  readonly model?: string;
  readonly architect?: string;
  readonly maxTokens?: number;
  readonly compactionThreshold?: number;
  readonly securityMode?: 'auto' | 'ask' | 'deny';
  readonly storagePath?: string;
  readonly mcpTransport?: 'stdio' | 'http' | 'none';
  readonly mcpPort?: number;
  readonly configPath?: string;
}

export class ConfigLoader {
  /**
   * Resolve and validate complete configuration.
   */
  static load(
    cliOverrides: CliConfigOverrides = {},
    workingDir: string = process.cwd(),
  ): ViHarnessConfigType {
    // 1. Find and load config file (if any)
    const fileConfig = this.loadFileConfig(cliOverrides.configPath, workingDir);

    // 2. Parse environment variables
    const envConfig = this.loadEnvConfig();

    // 3. Construct raw merged object with proper fallback hierarchy
    const rawMerged = {
      model: {
        primary:
          cliOverrides.model || envConfig.model?.primary || fileConfig.model?.primary || undefined,
        architect:
          cliOverrides.architect ||
          envConfig.model?.architect ||
          fileConfig.model?.architect ||
          undefined,
        providers: fileConfig.model?.providers || [],
      },
      context: {
        maxTokens:
          cliOverrides.maxTokens ??
          envConfig.context?.maxTokens ??
          fileConfig.context?.maxTokens ??
          undefined,
        compactionThreshold:
          cliOverrides.compactionThreshold ??
          envConfig.context?.compactionThreshold ??
          fileConfig.context?.compactionThreshold ??
          undefined,
        cacheAware: envConfig.context?.cacheAware ?? fileConfig.context?.cacheAware ?? undefined,
        frozenMemoryPath: fileConfig.context?.frozenMemoryPath ?? undefined,
      },
      repoMap: fileConfig.repoMap || {},
      git: fileConfig.git || {},
      security: {
        permissionMode:
          cliOverrides.securityMode ||
          envConfig.security?.permissionMode ||
          fileConfig.security?.permissionMode ||
          undefined,
        allowedPaths: fileConfig.security?.allowedPaths || [],
        deniedCommands: fileConfig.security?.deniedCommands || [],
      },
      storage: {
        path:
          cliOverrides.storagePath ||
          envConfig.storage?.path ||
          fileConfig.storage?.path ||
          undefined,
        maxSizeMb: fileConfig.storage?.maxSizeMb || undefined,
      },
      experience: fileConfig.experience || {},
      mcp: {
        transport:
          cliOverrides.mcpTransport ||
          envConfig.mcp?.transport ||
          fileConfig.mcp?.transport ||
          undefined,
        port: cliOverrides.mcpPort ?? envConfig.mcp?.port ?? fileConfig.mcp?.port ?? undefined,
      },
      benchmarks: fileConfig.benchmarks || undefined,
    };

    // 4. Validate through Zod schema (applies defaults where undefined)
    return ViHarnessConfig.parse(rawMerged);
  }

  private static loadFileConfig(
    explicitPath?: string,
    workingDir: string = process.cwd(),
  ): Partial<ViHarnessConfigType> {
    const candidates = explicitPath
      ? [path.resolve(workingDir, explicitPath)]
      : [
          path.join(workingDir, 'vi-harness.json'),
          path.join(workingDir, 'vi-harness.yaml'),
          path.join(workingDir, 'vi-harness.yml'),
          path.join(os.homedir(), '.vi-harness', 'config.json'),
          path.join(os.homedir(), '.vi-harness', 'config.yaml'),
        ];

    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          if (filePath.endsWith('.json')) {
            return JSON.parse(raw);
          } else {
            // Simple line-based YAML parser for key properties
            return this.parseSimpleYaml(raw);
          }
        } catch {
          // Fall through on parsing error
        }
      }
    }

    return {};
  }

  private static loadEnvConfig(): Partial<ViHarnessConfigType> {
    const env = process.env;
    const result: any = {
      model: {},
      context: {},
      security: {},
      storage: {},
      mcp: {},
    };

    if (env.VI_MODEL_PRIMARY || env.VI_MODEL)
      result.model.primary = env.VI_MODEL_PRIMARY || env.VI_MODEL;
    if (env.VI_MODEL_ARCHITECT) result.model.architect = env.VI_MODEL_ARCHITECT;
    if (env.VI_MAX_TOKENS) result.context.maxTokens = parseInt(env.VI_MAX_TOKENS, 10);
    if (env.VI_COMPACTION_THRESHOLD)
      result.context.compactionThreshold = parseFloat(env.VI_COMPACTION_THRESHOLD);
    if (env.VI_SECURITY_MODE) result.security.permissionMode = env.VI_SECURITY_MODE;
    if (env.VI_STORAGE_PATH) result.storage.path = env.VI_STORAGE_PATH;
    if (env.VI_MCP_TRANSPORT) result.mcp.transport = env.VI_MCP_TRANSPORT;
    if (env.VI_MCP_PORT) result.mcp.port = parseInt(env.VI_MCP_PORT, 10);

    return result;
  }

  private static parseSimpleYaml(yamlContent: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = yamlContent.split('\n');
    let currentSection = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (line.startsWith(' ') || line.startsWith('\t')) {
        const [k, ...vParts] = trimmed.split(':');
        if (k && vParts.length > 0) {
          const val = vParts.join(':').trim();
          if (currentSection) {
            result[currentSection] = result[currentSection] || {};
            result[currentSection][k.trim()] = this.parseScalar(val);
          }
        }
      } else {
        const [section] = trimmed.split(':');
        currentSection = section ? section.trim() : '';
        result[currentSection] = result[currentSection] || {};
      }
    }

    return result;
  }

  private static parseScalar(val: string): unknown {
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (/^\d+$/.test(val)) return parseInt(val, 10);
    if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
    return val.replace(/^["']|["']$/g, '');
  }
}
