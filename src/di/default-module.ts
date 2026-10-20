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
import { DefaultHarnessSurfaceRegistry } from '../infra/evolution/default-surface-registry.js';
import { HarnessManifestToolkit } from '../infra/evolution/manifest-toolkit.js';
import { DefaultHarnessDiagnoser } from '../infra/evolution/default-harness-diagnoser.js';
import { DefaultHarnessProposer } from '../infra/evolution/default-harness-proposer.js';
import { DefaultCandidateRegularizer } from '../infra/evolution/candidate-regularizer.js';
import { IsolatedHarnessProbeRunner } from '../infra/evolution/isolated-probe-runner.js';
import { DefaultBehavioralContrastAnalyzer } from '../infra/evolution/behavioral-contrast-analyzer.js';
import { DefaultHarnessComposer } from '../infra/evolution/default-harness-composer.js';
import { DefaultMultiObjectiveSelector } from '../infra/evolution/multi-objective-selector.js';
import { FailClosedAdmissionGate } from '../infra/evolution/fail-closed-admission-gate.js';
import { FileHarnessExperienceLibrary } from '../infra/evolution/file-experience-library.js';
import { RecursiveEvolutionEngine } from '../infra/evolution/recursive-evolution-engine.js';
import { DiscriminativeTaskSelector } from '../infra/evolution/discriminative-task-selector.js';
import { ContrastivePreferenceExporter } from '../infra/evolution/contrastive-preference-exporter.js';
import { MemoHarnessSynthesizer } from '../infra/evolution/sqlite-experience-library.js';
import { EcosystemMarginSplitter } from '../infra/evolution/ecosystem-margin.js';
import { AdversarialProbeGenerator } from '../infra/evolution/adversarial-probe-generator.js';
import { ExecutableSurfaceAstVerifier } from '../infra/evolution/executable-surface-ast-verifier.js';
import { ViForgeCoEvolutionBridge } from '../infra/evolution/viforge-coevolution-bridge.js';
import { EvolutionRpcDispatcher } from '../infra/evolution/evolution-rpc-dispatcher.js';
import { WorktreeProbeSandboxManager } from '../infra/evolution/worktree-probe-sandbox.js';
import { ShapleyComponentAttributor } from '../infra/evolution/shapley-component-attributor.js';
import { CanaryDeploymentController } from '../infra/evolution/canary-deployment-controller.js';
import { BradleyTerryHarnessRanker } from '../infra/evolution/bradley-terry-ranker.js';
import { EvolutionReportExporter } from '../infra/evolution/evolution-report-exporter.js';
import { CryptographicEvolutionLedger } from '../infra/evolution/cryptographic-evolution-ledger.js';
import { CounterfactualTraceSplicer } from '../infra/evolution/counterfactual-trace-splicer.js';
import { ContextualBanditMetaRouter } from '../infra/evolution/contextual-bandit-meta-router.js';
import { FederatedExperienceSynchronizer } from '../infra/evolution/federated-experience-sync.js';
import { EvolutionCockpitServer } from '../infra/evolution/evolution-cockpit-server.js';
import { MapElitesHarnessArchive } from '../infra/evolution/map-elites-archive.js';
import { SubmodularBenchmarkCoEvolver } from '../infra/evolution/submodular-benchmark-coevolver.js';
import { StructuralPolicyInvariantVerifier } from '../infra/evolution/structural-policy-verifier.js';
import { LineageBisectionDiagnoser } from '../infra/evolution/lineage-bisection-diagnoser.js';
import { ConformalUtilityCalibrator } from '../infra/evolution/conformal-utility-calibrator.js';
import { ContinuousEvolutionDaemon } from '../infra/evolution/continuous-evolution-daemon.js';
import { BayesianHarnessSurrogateModel } from '../infra/evolution/bayesian-surrogate-model.js';
import { EpistaticSurfaceGraphAnalyzer } from '../infra/evolution/epistatic-surface-graph.js';
import { RuntimeTemporalContractMonitor } from '../infra/evolution/temporal-contract-monitor.js';
import { HypervolumeParetoSelector } from '../infra/evolution/hypervolume-pareto-selector.js';
import { SkillSubagentDistiller } from '../infra/evolution/skill-subagent-distiller.js';
import { ChaosFaultInjectionTester } from '../infra/evolution/chaos-fault-injection-tester.js';
import { ConformalAbstentionGuard } from '../infra/evolution/conformal-abstention-guard.js';

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

    // Evolution Plane (opt-in subsystem)
    container.registerSingleton(
      TOKENS.HarnessSurfaceRegistry,
      () => new DefaultHarnessSurfaceRegistry(),
    );
    container.register('harnessSurfaceRegistry', (c) =>
      c.resolve(TOKENS.HarnessSurfaceRegistry),
    );

    container.registerSingleton(
      TOKENS.HarnessManifestToolkit,
      (c) =>
        new HarnessManifestToolkit({
          clock: c.resolve(TOKENS.Clock),
          surfaceRegistry: c.resolve(TOKENS.HarnessSurfaceRegistry),
        }),
    );
    container.register('harnessManifestToolkit', (c) =>
      c.resolve(TOKENS.HarnessManifestToolkit),
    );

    container.register(
      TOKENS.HarnessDiagnoser,
      () => new DefaultHarnessDiagnoser(),
    );
    container.register('harnessDiagnoser', (c) => c.resolve(TOKENS.HarnessDiagnoser));

    container.register(
      TOKENS.HarnessProposer,
      (c) => new DefaultHarnessProposer({ idFactory: c.resolve(TOKENS.IdFactory) }),
    );
    container.register('harnessProposer', (c) => c.resolve(TOKENS.HarnessProposer));

    container.register(
      TOKENS.CandidateRegularizer,
      (c) => new DefaultCandidateRegularizer({ clock: c.resolve(TOKENS.Clock) }),
    );
    container.register('candidateRegularizer', (c) =>
      c.resolve(TOKENS.CandidateRegularizer),
    );

    container.register(
      TOKENS.HarnessProbeRunner,
      (c) => new IsolatedHarnessProbeRunner({ idFactory: c.resolve(TOKENS.IdFactory) }),
    );
    container.register('harnessProbeRunner', (c) =>
      c.resolve(TOKENS.HarnessProbeRunner),
    );

    container.register(
      TOKENS.BehavioralContrastAnalyzer,
      (c) => new DefaultBehavioralContrastAnalyzer({ idFactory: c.resolve(TOKENS.IdFactory) }),
    );
    container.register('behavioralContrastAnalyzer', (c) =>
      c.resolve(TOKENS.BehavioralContrastAnalyzer),
    );

    container.register(
      TOKENS.HarnessComposer,
      (c) => new DefaultHarnessComposer({ idFactory: c.resolve(TOKENS.IdFactory) }),
    );
    container.register('harnessComposer', (c) => c.resolve(TOKENS.HarnessComposer));

    container.register(
      TOKENS.HarnessCandidateSelector,
      () => new DefaultMultiObjectiveSelector(),
    );
    container.register('harnessCandidateSelector', (c) =>
      c.resolve(TOKENS.HarnessCandidateSelector),
    );

    container.registerSingleton(
      TOKENS.HarnessAdmissionGate,
      (c) =>
        new FailClosedAdmissionGate({
          toolkit: c.resolve(TOKENS.HarnessManifestToolkit),
          clock: c.resolve(TOKENS.Clock),
        }),
    );
    container.register('harnessAdmissionGate', (c) =>
      c.resolve(TOKENS.HarnessAdmissionGate),
    );

    container.register(
      TOKENS.HarnessExperienceLibrary,
      (c) =>
        new FileHarnessExperienceLibrary({
          storageDir: '.vi-evolution/libraries',
          clock: c.resolve(TOKENS.Clock),
        }),
    );
    container.register('harnessExperienceLibrary', (c) =>
      c.resolve(TOKENS.HarnessExperienceLibrary),
    );

    container.register(
      TOKENS.DiscriminativeTaskSelector,
      () => new DiscriminativeTaskSelector(),
    );
    container.register('discriminativeTaskSelector', (c) =>
      c.resolve(TOKENS.DiscriminativeTaskSelector),
    );

    container.register(
      TOKENS.ContrastivePreferenceExporter,
      () => new ContrastivePreferenceExporter(),
    );
    container.register('contrastivePreferenceExporter', (c) =>
      c.resolve(TOKENS.ContrastivePreferenceExporter),
    );

    container.register(
      TOKENS.MemoHarnessSynthesizer,
      (c) =>
        new MemoHarnessSynthesizer({
          library: c.resolve(TOKENS.HarnessExperienceLibrary),
          surfaceRegistry: c.resolve(TOKENS.HarnessSurfaceRegistry),
        }),
    );
    container.register('memoHarnessSynthesizer', (c) =>
      c.resolve(TOKENS.MemoHarnessSynthesizer),
    );

    container.register(
      TOKENS.EcosystemMarginSplitter,
      (c) =>
        new EcosystemMarginSplitter({
          surfaceRegistry: c.resolve(TOKENS.HarnessSurfaceRegistry),
        }),
    );
    container.register('ecosystemMarginSplitter', (c) =>
      c.resolve(TOKENS.EcosystemMarginSplitter),
    );

    container.register(
      TOKENS.AdversarialProbeGenerator,
      () => new AdversarialProbeGenerator(),
    );
    container.register('adversarialProbeGenerator', (c) =>
      c.resolve(TOKENS.AdversarialProbeGenerator),
    );

    container.register(
      TOKENS.ExecutableSurfaceAstVerifier,
      () => new ExecutableSurfaceAstVerifier(),
    );
    container.register('executableSurfaceAstVerifier', (c) =>
      c.resolve(TOKENS.ExecutableSurfaceAstVerifier),
    );

    container.register(
      TOKENS.ViForgeCoEvolutionBridge,
      (c) =>
        new ViForgeCoEvolutionBridge({
          exporter: c.resolve(TOKENS.ContrastivePreferenceExporter),
          splitter: c.resolve(TOKENS.EcosystemMarginSplitter),
          experienceLibrary: c.resolve(TOKENS.HarnessExperienceLibrary),
        }),
    );
    container.register('viforgeCoEvolutionBridge', (c) =>
      c.resolve(TOKENS.ViForgeCoEvolutionBridge),
    );

    container.register(
      TOKENS.EvolutionRpcDispatcher,
      (c) =>
        new EvolutionRpcDispatcher({
          library: c.resolve(TOKENS.HarnessExperienceLibrary),
          synthesizer: c.resolve(TOKENS.MemoHarnessSynthesizer),
          splitter: c.resolve(TOKENS.EcosystemMarginSplitter),
          exporter: c.resolve(TOKENS.ContrastivePreferenceExporter),
          viforgeBridge: c.resolve(TOKENS.ViForgeCoEvolutionBridge),
          toolkit: c.resolve(TOKENS.HarnessManifestToolkit),
        }),
    );
    container.register('evolutionRpcDispatcher', (c) =>
      c.resolve(TOKENS.EvolutionRpcDispatcher),
    );

    container.register(
      TOKENS.WorktreeProbeSandboxManager,
      () => new WorktreeProbeSandboxManager(),
    );
    container.register('worktreeProbeSandboxManager', (c) =>
      c.resolve(TOKENS.WorktreeProbeSandboxManager),
    );

    container.register(
      TOKENS.ShapleyComponentAttributor,
      () => new ShapleyComponentAttributor(),
    );
    container.register('shapleyComponentAttributor', (c) =>
      c.resolve(TOKENS.ShapleyComponentAttributor),
    );

    container.register(
      TOKENS.CanaryDeploymentController,
      (c) =>
        new CanaryDeploymentController(
          c.resolve<HarnessManifestToolkit>(TOKENS.HarnessManifestToolkit).createCanonicalBaseline(),
          {
            admissionGate: c.resolve(TOKENS.HarnessAdmissionGate),
            experienceLibrary: c.resolve(TOKENS.HarnessExperienceLibrary),
          },
        ),
    );
    container.register('canaryDeploymentController', (c) =>
      c.resolve(TOKENS.CanaryDeploymentController),
    );

    container.register(
      TOKENS.BradleyTerryHarnessRanker,
      () => new BradleyTerryHarnessRanker(),
    );
    container.register('bradleyTerryHarnessRanker', (c) =>
      c.resolve(TOKENS.BradleyTerryHarnessRanker),
    );

    container.register(
      TOKENS.EvolutionReportExporter,
      () => new EvolutionReportExporter(),
    );
    container.register('evolutionReportExporter', (c) =>
      c.resolve(TOKENS.EvolutionReportExporter),
    );

    container.registerSingleton(
      TOKENS.CryptographicEvolutionLedger,
      (c) =>
        new CryptographicEvolutionLedger({
          initialBaseline: c
            .resolve<HarnessManifestToolkit>(TOKENS.HarnessManifestToolkit)
            .createCanonicalBaseline(),
        }),
    );
    container.register('cryptographicEvolutionLedger', (c) =>
      c.resolve(TOKENS.CryptographicEvolutionLedger),
    );

    container.register(
      TOKENS.CounterfactualTraceSplicer,
      () => new CounterfactualTraceSplicer(),
    );
    container.register('counterfactualTraceSplicer', (c) =>
      c.resolve(TOKENS.CounterfactualTraceSplicer),
    );

    container.registerSingleton(
      TOKENS.ContextualBanditMetaRouter,
      () => new ContextualBanditMetaRouter(),
    );
    container.register('contextualBanditMetaRouter', (c) =>
      c.resolve(TOKENS.ContextualBanditMetaRouter),
    );

    container.register(
      TOKENS.FederatedExperienceSynchronizer,
      () => new FederatedExperienceSynchronizer(),
    );
    container.register('federatedExperienceSynchronizer', (c) =>
      c.resolve(TOKENS.FederatedExperienceSynchronizer),
    );

    container.register(
      TOKENS.EvolutionCockpitServer,
      (c) =>
        new EvolutionCockpitServer({
          canaryController: c.resolve(TOKENS.CanaryDeploymentController),
          ranker: c.resolve(TOKENS.BradleyTerryHarnessRanker),
          ledger: c.resolve(TOKENS.CryptographicEvolutionLedger),
          metaRouter: c.resolve(TOKENS.ContextualBanditMetaRouter),
        }),
    );
    container.register('evolutionCockpitServer', (c) =>
      c.resolve(TOKENS.EvolutionCockpitServer),
    );

    container.registerSingleton(
      TOKENS.MapElitesHarnessArchive,
      () => new MapElitesHarnessArchive(),
    );
    container.register('mapElitesHarnessArchive', (c) =>
      c.resolve(TOKENS.MapElitesHarnessArchive),
    );

    container.register(
      TOKENS.SubmodularBenchmarkCoEvolver,
      () => new SubmodularBenchmarkCoEvolver(),
    );
    container.register('submodularBenchmarkCoEvolver', (c) =>
      c.resolve(TOKENS.SubmodularBenchmarkCoEvolver),
    );

    container.register(
      TOKENS.StructuralPolicyInvariantVerifier,
      () => new StructuralPolicyInvariantVerifier(),
    );
    container.register('structuralPolicyInvariantVerifier', (c) =>
      c.resolve(TOKENS.StructuralPolicyInvariantVerifier),
    );

    container.register(
      TOKENS.LineageBisectionDiagnoser,
      () => new LineageBisectionDiagnoser(),
    );
    container.register('lineageBisectionDiagnoser', (c) =>
      c.resolve(TOKENS.LineageBisectionDiagnoser),
    );

    container.register(
      TOKENS.ConformalUtilityCalibrator,
      () => new ConformalUtilityCalibrator(),
    );
    container.register('conformalUtilityCalibrator', (c) =>
      c.resolve(TOKENS.ConformalUtilityCalibrator),
    );

    container.registerSingleton(
      TOKENS.BayesianHarnessSurrogateModel,
      () => new BayesianHarnessSurrogateModel(),
    );
    container.register('bayesianHarnessSurrogateModel', (c) =>
      c.resolve(TOKENS.BayesianHarnessSurrogateModel),
    );

    container.register(
      TOKENS.EpistaticSurfaceGraphAnalyzer,
      () => new EpistaticSurfaceGraphAnalyzer(),
    );
    container.register('epistaticSurfaceGraphAnalyzer', (c) =>
      c.resolve(TOKENS.EpistaticSurfaceGraphAnalyzer),
    );

    container.register(
      TOKENS.RuntimeTemporalContractMonitor,
      () => new RuntimeTemporalContractMonitor(),
    );
    container.register('runtimeTemporalContractMonitor', (c) =>
      c.resolve(TOKENS.RuntimeTemporalContractMonitor),
    );

    container.register(
      TOKENS.HypervolumeParetoSelector,
      () => new HypervolumeParetoSelector(),
    );
    container.register('hypervolumeParetoSelector', (c) =>
      c.resolve(TOKENS.HypervolumeParetoSelector),
    );

    container.register(
      TOKENS.SkillSubagentDistiller,
      () => new SkillSubagentDistiller(),
    );
    container.register('skillSubagentDistiller', (c) =>
      c.resolve(TOKENS.SkillSubagentDistiller),
    );

    container.register(
      TOKENS.ChaosFaultInjectionTester,
      (c) =>
        new ChaosFaultInjectionTester({
          temporalMonitor: c.resolve(TOKENS.RuntimeTemporalContractMonitor),
        }),
    );
    container.register('chaosFaultInjectionTester', (c) =>
      c.resolve(TOKENS.ChaosFaultInjectionTester),
    );

    container.registerSingleton(
      TOKENS.ConformalAbstentionGuard,
      () => new ConformalAbstentionGuard(),
    );
    container.register('conformalAbstentionGuard', (c) =>
      c.resolve(TOKENS.ConformalAbstentionGuard),
    );

    container.register(
      TOKENS.RecursiveEvolutionEngine,
      (c) =>
        new RecursiveEvolutionEngine({
          clock: c.resolve(TOKENS.Clock),
          surfaceRegistry: c.resolve(TOKENS.HarnessSurfaceRegistry),
          toolkit: c.resolve(TOKENS.HarnessManifestToolkit),
          diagnoser: c.resolve(TOKENS.HarnessDiagnoser),
          proposer: c.resolve(TOKENS.HarnessProposer),
          regularizer: c.resolve(TOKENS.CandidateRegularizer),
          probeRunner: c.resolve(TOKENS.HarnessProbeRunner),
          contrastAnalyzer: c.resolve(TOKENS.BehavioralContrastAnalyzer),
          composer: c.resolve(TOKENS.HarnessComposer),
          selector: c.resolve(TOKENS.HarnessCandidateSelector),
          admissionGate: c.resolve(TOKENS.HarnessAdmissionGate),
          library: c.resolve(TOKENS.HarnessExperienceLibrary),
          taskSelector: c.resolve(TOKENS.DiscriminativeTaskSelector),
          memoSynthesizer: c.resolve(TOKENS.MemoHarnessSynthesizer),
          adversarialProbeGenerator: c.resolve(TOKENS.AdversarialProbeGenerator),
          preferenceExporter: c.resolve(TOKENS.ContrastivePreferenceExporter),
          viforgeBridge: c.resolve(TOKENS.ViForgeCoEvolutionBridge),
          shapleyAttributor: c.resolve(TOKENS.ShapleyComponentAttributor),
          tournamentRanker: c.resolve(TOKENS.BradleyTerryHarnessRanker),
          evolutionLedger: c.resolve(TOKENS.CryptographicEvolutionLedger),
          metaRouter: c.resolve(TOKENS.ContextualBanditMetaRouter),
          mapElitesArchive: c.resolve(TOKENS.MapElitesHarnessArchive),
          policyVerifier: c.resolve(TOKENS.StructuralPolicyInvariantVerifier),
          conformalCalibrator: c.resolve(TOKENS.ConformalUtilityCalibrator),
          surrogateModel: c.resolve(TOKENS.BayesianHarnessSurrogateModel),
          epistaticAnalyzer: c.resolve(TOKENS.EpistaticSurfaceGraphAnalyzer),
          temporalMonitor: c.resolve(TOKENS.RuntimeTemporalContractMonitor),
          hypervolumeSelector: c.resolve(TOKENS.HypervolumeParetoSelector),
          skillDistiller: c.resolve(TOKENS.SkillSubagentDistiller),
          chaosTester: c.resolve(TOKENS.ChaosFaultInjectionTester),
          conformalAbstentionGuard: c.resolve(TOKENS.ConformalAbstentionGuard),
        }),
    );
    container.register('recursiveEvolutionEngine', (c) =>
      c.resolve(TOKENS.RecursiveEvolutionEngine),
    );

    container.register(
      TOKENS.ContinuousEvolutionDaemon,
      (c) =>
        new ContinuousEvolutionDaemon({
          engine: c.resolve(TOKENS.RecursiveEvolutionEngine),
          canaryController: c.resolve(TOKENS.CanaryDeploymentController),
          bisectionDiagnoser: c.resolve(TOKENS.LineageBisectionDiagnoser),
          policyVerifier: c.resolve(TOKENS.StructuralPolicyInvariantVerifier),
          mapElitesArchive: c.resolve(TOKENS.MapElitesHarnessArchive),
        }),
    );
    container.register('continuousEvolutionDaemon', (c) =>
      c.resolve(TOKENS.ContinuousEvolutionDaemon),
    );
  }
}


