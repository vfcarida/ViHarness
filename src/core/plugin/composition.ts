// Pattern: Profiles and Bundles Composition (ref: DeepSeek Harness, Cordis)
/**
 * Profile & Bundle Composition Engine.
 *
 * Implements layered plugin composition:
 * base bundle → bundle layers in order → profile patches → user patches → CLI patches
 * with topological dependency ordering and circular dependency detection.
 */
import type { Plugin } from './plugin.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export interface PluginEntry {
  readonly id: string;
  readonly plugin: string; // package name, class name, or path
  readonly config?: Record<string, unknown>;
  readonly disabled?: boolean;
}

export interface PluginPatch {
  readonly target: string; // plugin entry id to patch
  readonly plugin?: string; // override plugin implementation
  readonly config?: Record<string, unknown>; // override/merge config
  readonly disabled?: boolean;
}

export interface Bundle {
  readonly name: string;
  readonly description?: string;
  readonly plugins: ReadonlyArray<PluginEntry>;
}

export interface Profile {
  readonly name: string;
  readonly description?: string;
  readonly bundles: ReadonlyArray<string>; // ordered bundle names
  readonly patches?: ReadonlyArray<PluginPatch>;
}

export class CircularDependencyError extends HarnessError {
  constructor(cycle: string[]) {
    super({
      code: ErrorCode.CONFIG_INVALID,
      category: ErrorCategory.CONFIGURATION,
      message: `Circular plugin dependency detected: ${cycle.join(' -> ')}`,
    });
  }
}

/**
 * Compose a finalized list of active PluginEntries from a Profile, known Bundles, and User Patches.
 */
export function composePluginTree(
  profile: Profile,
  knownBundles: Record<string, Bundle> = {},
  userPatches: ReadonlyArray<PluginPatch> = [],
): PluginEntry[] {
  const entriesMap = new Map<string, PluginEntry>();

  // 1. Gather all plugins from referenced bundles in order
  for (const bundleName of profile.bundles) {
    const bundle = knownBundles[bundleName];
    if (bundle) {
      for (const entry of bundle.plugins) {
        entriesMap.set(entry.id, { ...entry });
      }
    }
  }

  // 2. Apply Profile-level patches
  if (profile.patches) {
    applyPatches(entriesMap, profile.patches);
  }

  // 3. Apply User/CLI-level patches
  if (userPatches && userPatches.length > 0) {
    applyPatches(entriesMap, userPatches);
  }

  // 4. Return only enabled plugin entries
  return Array.from(entriesMap.values()).filter((e) => !e.disabled);
}

function applyPatches(
  entriesMap: Map<string, PluginEntry>,
  patches: ReadonlyArray<PluginPatch>,
): void {
  for (const patch of patches) {
    const existing = entriesMap.get(patch.target);
    if (existing) {
      entriesMap.set(patch.target, {
        id: existing.id,
        plugin: patch.plugin ?? existing.plugin,
        config: patch.config ? { ...(existing.config ?? {}), ...patch.config } : existing.config,
        disabled: patch.disabled !== undefined ? patch.disabled : existing.disabled,
      });
    } else {
      // Create new entry if not existing
      entriesMap.set(patch.target, {
        id: patch.target,
        plugin: patch.plugin ?? patch.target,
        config: patch.config,
        disabled: patch.disabled ?? false,
      });
    }
  }
}

/**
 * Resolve plugins in topological dependency order based on `inject` requirements.
 * Throws CircularDependencyError if any cycles are detected.
 */
export function resolvePluginOrder(plugins: ReadonlyArray<Plugin>): Plugin[] {
  const pluginMap = new Map<string, Plugin>();
  for (const p of plugins) {
    pluginMap.set(p.name, p);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: Plugin[] = [];

  function dfs(name: string, path: string[]) {
    if (visiting.has(name)) {
      const cycleStart = path.indexOf(name);
      const cycle = [...path.slice(cycleStart), name];
      throw new CircularDependencyError(cycle);
    }
    if (visited.has(name)) {
      return;
    }

    visiting.add(name);
    const plugin = pluginMap.get(name);

    if (plugin && plugin.inject) {
      // Find plugins that might satisfy injected requirements
      for (const requiredService of plugin.inject) {
        for (const candidate of plugins) {
          if (candidate.name === requiredService || candidate.name.includes(requiredService)) {
            if (candidate.name !== name) {
              dfs(candidate.name, [...path, name]);
            }
          }
        }
      }
    }

    visiting.delete(name);
    visited.add(name);
    if (plugin) {
      order.push(plugin);
    }
  }

  for (const p of plugins) {
    if (!visited.has(p.name)) {
      dfs(p.name, []);
    }
  }

  return order;
}

interface MutablePatch {
  target?: string;
  plugin?: string;
  config?: Record<string, unknown>;
  disabled?: boolean;
}

/**
 * Parse a YAML/JSON string into a Profile structure.
 */
export function parseProfileYaml(content: string): Profile {
  try {
    // If JSON
    if (content.trim().startsWith('{')) {
      return JSON.parse(content);
    }
  } catch {
    /* ignore and fallback to yaml parser */
  }

  // Simple line-based YAML parser for Profile
  const lines = content.split('\n');
  let name = 'default';
  const bundles: string[] = [];
  const patches: PluginPatch[] = [];
  let currentSection = '';
  let currentPatch: MutablePatch | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('name:')) {
      name = trimmed.split(':')[1]?.trim() ?? 'default';
    } else if (trimmed.startsWith('bundles:')) {
      currentSection = 'bundles';
    } else if (trimmed.startsWith('patches:')) {
      currentSection = 'patches';
    } else if (trimmed.startsWith('-') && currentSection === 'bundles') {
      bundles.push(trimmed.replace('-', '').trim());
    } else if (trimmed.startsWith('-') && currentSection === 'patches') {
      if (currentPatch && currentPatch.target) {
        patches.push(currentPatch as PluginPatch);
      }
      currentPatch = {};
      const targetMatch = trimmed.match(/target:\s*(.+)/);
      if (targetMatch && targetMatch[1]) {
        currentPatch.target = targetMatch[1].trim();
      }
    } else if (currentSection === 'patches' && currentPatch) {
      const [k, ...v] = trimmed.split(':');
      if (k && v.length > 0) {
        const key = k.trim();
        const val = v
          .join(':')
          .trim()
          .replace(/^['"]|['"]$/g, '');
        if (key === 'target') currentPatch.target = val;
        if (key === 'plugin') currentPatch.plugin = val;
        if (key === 'disabled') currentPatch.disabled = val === 'true';
      }
    }
  }

  if (currentPatch && currentPatch.target) {
    patches.push(currentPatch as PluginPatch);
  }

  return {
    name,
    bundles: bundles.length > 0 ? bundles : ['base'],
    patches,
  };
}
