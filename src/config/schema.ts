import { z } from 'zod';

export const ProviderConfig = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  type: z.string().optional(),
});

export type ProviderConfigType = z.infer<typeof ProviderConfig>;

export const ViHarnessConfig = z.object({
  model: z
    .object({
      primary: z.string().default('claude-sonnet-4-20250514'),
      architect: z.string().optional(),
      providers: z.array(ProviderConfig).default([]),
    })
    .default({ primary: 'claude-sonnet-4-20250514', providers: [] }),
  context: z
    .object({
      maxTokens: z.number().default(128000),
      compactionThreshold: z.number().default(0.8),
      cacheAware: z.boolean().default(true),
      frozenMemoryPath: z.string().optional(),
    })
    .default({ maxTokens: 128000, compactionThreshold: 0.8, cacheAware: true }),
  repoMap: z
    .object({
      enabled: z.boolean().default(true),
      maxTokenBudget: z.number().default(4096),
      languages: z.array(z.string()).default(['typescript', 'python', 'javascript']),
    })
    .default({
      enabled: true,
      maxTokenBudget: 4096,
      languages: ['typescript', 'python', 'javascript'],
    }),
  git: z
    .object({
      twoPhaseCommit: z.boolean().default(true),
      autoLint: z.boolean().default(true),
      autoTest: z.boolean().default(true),
    })
    .default({ twoPhaseCommit: true, autoLint: true, autoTest: true }),
  security: z
    .object({
      permissionMode: z.enum(['auto', 'ask', 'deny']).default('ask'),
      allowedPaths: z.array(z.string()).default([]),
      deniedCommands: z.array(z.string()).default([]),
    })
    .default({ permissionMode: 'ask', allowedPaths: [], deniedCommands: [] }),
  storage: z
    .object({
      path: z.string().default('~/.vi-harness/store.db'),
      maxSizeMb: z.number().default(100),
    })
    .default({ path: '~/.vi-harness/store.db', maxSizeMb: 100 }),
  experience: z
    .object({
      enabled: z.boolean().default(true),
      maxTraces: z.number().default(1000),
      retentionDays: z.number().default(90),
    })
    .default({ enabled: true, maxTraces: 1000, retentionDays: 90 }),
  mcp: z
    .object({
      transport: z.enum(['stdio', 'http', 'none']).default('none'),
      port: z.number().default(3100),
    })
    .default({ transport: 'none', port: 3100 }),
  benchmarks: z
    .object({
      projdevbench: z.object({ path: z.string().optional() }).optional(),
      tbench: z.object({ path: z.string().optional() }).optional(),
    })
    .optional(),
});

export type ViHarnessConfigType = z.infer<typeof ViHarnessConfig>;
