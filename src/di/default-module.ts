// Pattern: Synthesized Dependency Injection Modules (ref: DeepSeek Harness, Hermes)
/**
 * Default Module: registers standard infrastructure bindings into the container.
 *
 * Implements full string/symbol dual-registration required by P016:
 *   - FiveStageCompactor ('compaction' / TOKENS.Compaction)
 *   - CacheAwareCompactor ('cacheCompaction' / TOKENS.CacheCompaction)
 *   - PageRankRepoMap ('repoMap' / TOKENS.RepoMap)
 *   - TwoPhaseGitManager ('gitManager' / TOKENS.GitManager)
 *   - ArchitectPlanner ('architectMode' / TOKENS.ArchitectMode)
 *   - GoalBudgetManager ('goalBudgets' / TOKENS.GoalBudgets)
 *   - FrozenMemoryManager ('memoryManager' / TOKENS.MemoryManager)
 *   - TreeSessionStore ('sessionStore' / TOKENS.SessionStore)
 *   - SqliteExperienceStore ('experienceStore' / TOKENS.ExperienceStore)
 *   - TransportRegistry ('mcpTransport' / TOKENS.McpTransport)
 *   - SqliteStore ('storage' / TOKENS.Storage)
 *   - MetricsSink ('metricsSink' / TOKENS.MetricsSink)
 */
import type { ContainerModule } from './module.js';
import type { Container } from './container.js';
import { TOKENS } from './tokens.js';
import { ConsoleLogger } from '../infra/logging/console-logger.js';
import { SystemClock } from '../infra/time/system-clock.js';
import { EnvConfiguration } from '../infra/config/env-configuration.js';
import { UuidV7IdFactory } from '../infra/id/uuid-id-factory.js';
import { ContextCompressor as FiveStageCompactor } from '../infra/compiler/context-compressor.js';
import { CachePrefixTracker as CacheAwareCompactor } from '../infra/compiler/cache-prefix-tracker.js';
import { SourceCodeIndexer as PageRankRepoMap } from '../infra/syntax/source-code-indexer.js';
import { DefaultGitManager as TwoPhaseGitManager } from '../infra/git/default-git-manager.js';
import { ArchitectExecutor as ArchitectPlanner } from '../runtime/architect-executor.js';
import { DefaultBudgetTracker as GoalBudgetManager } from '../infra/cost/default-budget-tracker.js';
import { FrozenMemorySnapshot as FrozenMemoryManager } from '../infra/memory/frozen-memory-snapshot.js';
import { SqliteSessionStore as TreeSessionStore } from '../infra/storage/session-store.js';
import { SqliteExperienceStore } from '../infra/storage/experience-store.js';
import { TransportRegistry } from '../infra/mcp/transport-registry.js';
import { SqliteStore } from '../infra/storage/sqlite-store.js';
import { SqliteMetricsSink as MetricsSink } from '../infra/storage/metrics-sink.js';
import { InMemoryMemoryStore } from '../infra/memory/in-memory-memory-store.js';
import { AnthropicModelProvider } from '../infra/model/anthropic-provider.js';
import { GeminiModelProvider } from '../infra/model/gemini-provider.js';
import { OtlpTelemetryExporter } from '../infra/telemetry/otlp-telemetry-exporter.js';

export {
  FiveStageCompactor,
  CacheAwareCompactor,
  PageRankRepoMap,
  TwoPhaseGitManager,
  ArchitectPlanner,
  GoalBudgetManager,
  FrozenMemoryManager,
  TreeSessionStore,
  SqliteExperienceStore,
  TransportRegistry,
  SqliteStore,
  MetricsSink,
  AnthropicModelProvider,
  GeminiModelProvider,
  OtlpTelemetryExporter,
};

export class DefaultModule implements ContainerModule {
  register(container: Container): void {
    // Singletons
    container.registerSingleton(TOKENS.Logger, () => new ConsoleLogger());
    container.register('logger', (c) => c.resolve(TOKENS.Logger));

    container.registerSingleton(TOKENS.Clock, () => new SystemClock());
    container.register('clock', (c) => c.resolve(TOKENS.Clock));

    container.registerSingleton(TOKENS.Configuration, () => new EnvConfiguration());
    container.register('config', (c) => c.resolve(TOKENS.Configuration));

    container.registerSingleton(TOKENS.IdFactory, () => new UuidV7IdFactory());
    container.register('idFactory', (c) => c.resolve(TOKENS.IdFactory));

    // Transient factories & Subsystems
    container.register(TOKENS.Storage, () => new SqliteStore());
    container.register('storage', (c) => c.resolve(TOKENS.Storage));

    container.register(
      TOKENS.MetricsSink,
      (c) => new MetricsSink({ store: c.resolve(TOKENS.Storage) as SqliteStore }),
    );
    container.register('metricsSink', (c) => c.resolve(TOKENS.MetricsSink));

    container.register(
      TOKENS.SessionStore,
      (c) =>
        new TreeSessionStore({
          store: c.resolve(TOKENS.Storage) as SqliteStore,
          idFactory: c.resolve(TOKENS.IdFactory),
          clock: c.resolve(TOKENS.Clock),
        }),
    );
    container.register('sessionStore', (c) => c.resolve(TOKENS.SessionStore));

    container.register(
      TOKENS.ExperienceStore,
      (c) => new SqliteExperienceStore({ store: c.resolve(TOKENS.Storage) as SqliteStore }),
    );
    container.register('experienceStore', (c) => c.resolve(TOKENS.ExperienceStore));

    container.register(TOKENS.Compaction, () => new FiveStageCompactor());
    container.register('compaction', (c) => c.resolve(TOKENS.Compaction));

    container.register(TOKENS.CacheCompaction, () => new CacheAwareCompactor());
    container.register('cacheCompaction', (c) => c.resolve(TOKENS.CacheCompaction));

    container.register(TOKENS.ArchitectMode, () => new ArchitectPlanner());
    container.register('architectMode', (c) => c.resolve(TOKENS.ArchitectMode));

    container.register(TOKENS.RepoMap, () => new PageRankRepoMap());
    container.register('repoMap', (c) => c.resolve(TOKENS.RepoMap));

    container.register(TOKENS.GitManager, () => new TwoPhaseGitManager());
    container.register('gitManager', (c) => c.resolve(TOKENS.GitManager));

    container.register(TOKENS.GoalBudgets, () => new GoalBudgetManager());
    container.register('goalBudgets', (c) => c.resolve(TOKENS.GoalBudgets));

    container.register(TOKENS.MemoryManager, (c) => {
      const memoryStore = new InMemoryMemoryStore({
        idFactory: c.resolve(TOKENS.IdFactory),
        clock: c.resolve(TOKENS.Clock),
      });
      return new FrozenMemoryManager({
        memoryStore,
        idFactory: c.resolve(TOKENS.IdFactory),
        clock: c.resolve(TOKENS.Clock),
      });
    });
    container.register('memoryManager', (c) => c.resolve(TOKENS.MemoryManager));

    container.register(TOKENS.McpTransport, () => new TransportRegistry());
    container.register('mcpTransport', (c) => c.resolve(TOKENS.McpTransport));

    container.register(TOKENS.AnthropicProvider, () => new AnthropicModelProvider());
    container.register('anthropicProvider', (c) => c.resolve(TOKENS.AnthropicProvider));

    container.register(TOKENS.GeminiProvider, () => new GeminiModelProvider());
    container.register('geminiProvider', (c) => c.resolve(TOKENS.GeminiProvider));

    container.register(TOKENS.OtlpExporter, () => new OtlpTelemetryExporter());
    container.register('otlpExporter', (c) => c.resolve(TOKENS.OtlpExporter));
  }
}
