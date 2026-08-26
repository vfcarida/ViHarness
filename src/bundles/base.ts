// Pattern: Built-in Base Capability Bundle (ref: DeepSeek Harness, Cordis)
/**
 * Base Capability Bundle.
 *
 * Provides core capability seams: LLM inference, tools, context compilation,
 * git management, persistence, and deny-first security.
 */
import type { Bundle } from '../core/plugin/composition.js';

export interface BaseBundleType extends Bundle {
  readonly defaultSettings?: Record<string, unknown>;
}

export const BASE_BUNDLE: BaseBundleType = {
  name: 'base',
  description: 'Core Vi-Harness runtime engine with all foundational capability seams active',
  defaultSettings: { maxIterations: 50, safetyBounds: true },
  plugins: [
    {
      id: 'logging-provider',
      plugin: '@vi-harness/logging-console',
      config: { level: 'info' },
    },
    {
      id: 'time-provider',
      plugin: '@vi-harness/time-system',
    },
    {
      id: 'id-factory',
      plugin: '@vi-harness/id-uuidv7',
    },
    {
      id: 'storage-provider',
      plugin: '@vi-harness/storage-sqlite',
      config: { walMode: true },
    },
    {
      id: 'security-policy',
      plugin: '@vi-harness/security-default-policy',
      config: { permissionMode: 'ask' },
    },
    {
      id: 'git-manager',
      plugin: '@vi-harness/git-two-phase',
    },
    {
      id: 'context-compiler',
      plugin: '@vi-harness/compiler-five-stage',
      config: { maxTokens: 128000 },
    },
    {
      id: 'tool-registry',
      plugin: '@vi-harness/tools-default-registry',
    },
    {
      id: 'tool-executor',
      plugin: '@vi-harness/tools-default-executor',
    },
    {
      id: 'model-router',
      plugin: '@vi-harness/router-utility',
    },
    {
      id: 'agent-runtime',
      plugin: '@vi-harness/runtime-default-loop',
    },
  ],
};

export interface CapabilitySeam {
  readonly seam: string;
  readonly defaultProvider: string;
  readonly description: string;
}

export const CAPABILITY_SEAMS: Record<string, CapabilitySeam> = {
  modelProvider: {
    seam: 'model-provider',
    defaultProvider: 'openai-compatible',
    description: 'LLM inference provider and streaming adapter seam',
  },
  contextCompiler: {
    seam: 'context-compiler',
    defaultProvider: 'default-context-compiler',
    description: '5-stage progressive context compilation and compaction pipeline seam',
  },
  gitManager: {
    seam: 'git-manager',
    defaultProvider: 'two-phase-git',
    description: 'Two-phase checkpointing, branch management, and rollback seam',
  },
  storage: {
    seam: 'storage-provider',
    defaultProvider: 'sqlite-store',
    description: 'SQLite persistence for sessions, experiences, and metrics seam',
  },
  securityPolicy: {
    seam: 'policy-engine',
    defaultProvider: 'default-policy-engine',
    description: '7-layer deny-first security perimeter seam',
  },
  mcpTransport: {
    seam: 'mcp-transport',
    defaultProvider: 'transport-registry',
    description: 'MCP stdio & HTTP/SSE transport layer seam',
  },
  experienceStore: {
    seam: 'experience-store',
    defaultProvider: 'sqlite-experience-store',
    description: 'Meta-Harness outer-loop experience and cross-run trace store seam',
  },
};

export function resolvePluginTree(): {
  seams: Record<string, CapabilitySeam>;
  bundles: Record<string, Bundle>;
} {
  return {
    seams: CAPABILITY_SEAMS,
    bundles: { base: BASE_BUNDLE },
  };
}
