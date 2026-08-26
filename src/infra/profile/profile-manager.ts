/**
 * Profile Manager (DeepSeek Harness Reference).
 *
 * Resolves profile bundle compositions, applies configuration patches to
 * subsystem options, and merges environment variables.
 */
import type { ProfileConfig, ResolvedProfile, ProfilePatch } from '../../core/profile/types.js';

export const KNOWN_BUNDLES: Record<
  string,
  { description: string; defaultSettings: Record<string, unknown> }
> = {
  base: {
    description:
      'Core engine: StateMachine, TestClock/SystemClock, UuidV7IdFactory, ContextCompiler',
    defaultSettings: { maxIterations: 50, safetyBounds: true },
  },
  headless: {
    description: 'Headless automation runner with structured exit codes and clean stdout',
    defaultSettings: { headless: true, interactive: false },
  },
  web: {
    description: 'Web UI & API server with MCP HTTP/SSE transport and JSON-RPC endpoints',
    defaultSettings: { serverMode: 'http', sseEnabled: true },
  },
  mcp: {
    description: 'Model Context Protocol (MCP) server & client transport layer',
    defaultSettings: { mcpEnabled: true },
  },
  sqlite: {
    description:
      'Persistent SQLite database for sessions, experiences, metrics, and memory curation',
    defaultSettings: { persistence: 'sqlite', walMode: true },
  },
  benchmark: {
    description: 'Evaluation benchmark harnesses (SWE-bench, ProjDevBench, TBench)',
    defaultSettings: { benchmarkMode: true },
  },
  report: {
    description: 'Automated telemetry reporting, Markdown summaries, and JSON artifacts',
    defaultSettings: { reportGeneration: true },
  },
};

export class ProfileManager {
  /**
   * Resolve profile config into fully composed ResolvedProfile.
   */
  resolveProfile(config: ProfileConfig): ResolvedProfile {
    if (!config.name || typeof config.name !== 'string') {
      throw new Error('Profile must have a valid non-empty name');
    }

    const activeBundles =
      Array.isArray(config.bundles) && config.bundles.length > 0 ? [...config.bundles] : ['base'];

    // Collect settings from active bundles
    const resolvedConfig: Record<string, unknown> = {};
    for (const bundleName of activeBundles) {
      const bundle = KNOWN_BUNDLES[bundleName];
      if (bundle) {
        Object.assign(resolvedConfig, bundle.defaultSettings);
      }
    }

    // Apply patches
    const patches: ProfilePatch[] = config.patches ? [...config.patches] : [];
    for (const patch of patches) {
      if (patch.config) {
        resolvedConfig[patch.target] = {
          ...(typeof resolvedConfig[patch.target] === 'object' &&
          resolvedConfig[patch.target] !== null
            ? (resolvedConfig[patch.target] as Record<string, unknown>)
            : {}),
          ...patch.config,
        };
      }
      if (patch.plugin) {
        resolvedConfig[`${patch.target}:plugin`] = patch.plugin;
      }
    }

    return {
      name: config.name,
      description: config.description ?? `Vi-Harness ${config.name} profile`,
      activeBundles,
      patches,
      env: config.env ? { ...config.env } : {},
      resolvedConfig,
    };
  }

  /**
   * Apply profile environment variables to process.env.
   */
  applyEnvironment(profile: ResolvedProfile): void {
    for (const [key, value] of Object.entries(profile.env)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      }
    }
  }

  /**
   * Apply resolved profile configuration to runtime options.
   */
  applyToRuntimeOptions<T extends Record<string, any>>(
    profile: ResolvedProfile,
    baseOptions: T,
  ): T {
    const updated = { ...baseOptions };

    // If storage patch exists
    const storagePatch = profile.resolvedConfig['storage'] as Record<string, unknown> | undefined;
    if (storagePatch) {
      (updated as any).storageOptions = {
        ...((updated as any).storageOptions ?? {}),
        ...storagePatch,
      };
    }

    // If router patch exists
    const routerPatch = profile.resolvedConfig['model-router'] as
      Record<string, unknown> | undefined;
    if (routerPatch) {
      (updated as any).routerOptions = {
        ...((updated as any).routerOptions ?? {}),
        ...routerPatch,
      };
    }

    // Attach resolved profile metadata to runtime options
    (updated as any).profile = profile;

    return updated;
  }
}
