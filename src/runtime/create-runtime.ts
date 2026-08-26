/**
 * Factory helper function to instantiate a fully wired DefaultAgentRuntime.
 *
 * Usage:
 *   import { createRuntime } from 'vi-harness';
 *   const runtime = createRuntime({ profile: 'headless' });
 */
import { DefaultAgentRuntime, type DefaultAgentRuntimeOptions } from './default-agent-runtime.js';
import { UuidV7IdFactory } from '../infra/id/uuid-id-factory.js';
import { SystemClock } from '../infra/time/system-clock.js';
import { UtilityModelRouter } from '../infra/router/utility-model-router.js';
import { MockModelProvider } from '../infra/model/mock-model-provider.js';
import { DefaultContextCompiler } from '../infra/compiler/default-context-compiler.js';
import { ProfileLoader } from '../infra/profile/profile-loader.js';
import { ProfileManager } from '../infra/profile/profile-manager.js';

export interface CreateRuntimeOptions extends Partial<DefaultAgentRuntimeOptions> {
  /** Optional profile name to apply (e.g. 'web', 'headless', 'ci', 'eval', 'custom') */
  readonly profile?: string;
  /** Custom profiles directory path */
  readonly profilesDir?: string;
}

export function createRuntime(options: CreateRuntimeOptions = {}): DefaultAgentRuntime {
  const clock = options.clock ?? new SystemClock();
  const idFactory = options.idFactory ?? new UuidV7IdFactory();

  // If profile specified, apply its environment and patches
  if (options.profile) {
    try {
      const loader = new ProfileLoader(options.profilesDir);
      const manager = new ProfileManager();
      loader
        .loadProfile(options.profile)
        .then((config) => {
          const resolved = manager.resolveProfile(config);
          manager.applyEnvironment(resolved);
        })
        .catch(() => {});
    } catch {
      // Ignore profile resolution errors on startup
    }
  }

  let router = options.router;
  if (!router) {
    const defaultRouter = new UtilityModelRouter();
    defaultRouter.registerProvider(new MockModelProvider());
    router = defaultRouter;
  }

  const compiler = options.compiler ?? new DefaultContextCompiler({ idFactory, clock });

  return new DefaultAgentRuntime({
    router,
    compiler,
    policyEngine: options.policyEngine,
    toolExecutor: options.toolExecutor,
    verificationEngine: options.verificationEngine,
    evidenceStore: options.evidenceStore,
    checkpointStore: options.checkpointStore,
    memoryStore: options.memoryStore,
    skillRegistry: options.skillRegistry,
    skillExtractor: options.skillExtractor,
    skillCurator: options.skillCurator,
    experienceStore: options.experienceStore,
    idFactory,
    clock,
  });
}
