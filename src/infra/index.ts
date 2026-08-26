/**
 * Infrastructure layer barrel export.
 */

// ID
export { UuidV7IdFactory } from './id/uuid-id-factory.js';

// Logging
export { ConsoleLogger } from './logging/console-logger.js';

// Time
export { SystemClock } from './time/system-clock.js';
export { TestClock } from './time/test-clock.js';

// Config
export { EnvConfiguration } from './config/env-configuration.js';
export type { EnvConfigurationOptions } from './config/env-configuration.js';
export { ConfigSchemaValidator, RuntimeConfigSchema } from './config/config-schema.js';
export type { RuntimeConfig } from './config/config-schema.js';

// Model Providers & Resilience
export { MockModelProvider } from './model/mock-model-provider.js';
export type { MockModelProviderOptions } from './model/mock-model-provider.js';

export { FailingModelProvider } from './model/failing-model-provider.js';
export type { FailingModelProviderOptions } from './model/failing-model-provider.js';

export { OpenAICompatibleProvider } from './model/openai-compatible-provider.js';
export type { OpenAICompatibleProviderOptions } from './model/openai-compatible-provider.js';

export { AnthropicModelProvider } from './model/anthropic-provider.js';
export type { AnthropicProviderOptions } from './model/anthropic-provider.js';

export { GeminiModelProvider } from './model/gemini-provider.js';
export type { GeminiProviderOptions } from './model/gemini-provider.js';

export {
  executeResiliently,
  mapProviderError,
  DEFAULT_RESILIENCE_OPTIONS,
} from './model/provider-resilience.js';
export type { ResilientExecutionOptions } from './model/provider-resilience.js';
export { ScriptedModelProvider } from './model/scripted-model-provider.js';
export type {
  ScriptedStep,
  ScriptStepHandler,
  ScriptedModelProviderOptions,
} from './model/scripted-model-provider.js';
export { ProviderMessageAdapter } from './model/provider-message-adapter.js';
export type {
  AnthropicMessage,
  AnthropicPayload,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
} from './model/provider-message-adapter.js';
export { SimulatedFaultModelProvider } from './model/simulated-fault-model-provider.js';
export type {
  SimulatedFaultType,
  SimulatedFaultProviderOptions,
} from './model/simulated-fault-model-provider.js';
export { StructuredOutputValidator } from './model/structured-output-validator.js';
export type {
  StructuredValidationResult,
  StructuredValidationSuccess,
  StructuredValidationFailure,
} from './model/structured-output-validator.js';
export { CircuitBreaker } from './model/circuit-breaker.js';
export type { CircuitBreakerOptions, CircuitState } from './model/circuit-breaker.js';

// Telemetry & OTLP
export { OtlpTelemetryExporter } from './telemetry/otlp-telemetry-exporter.js';
export type { OtlpExporterOptions } from './telemetry/otlp-telemetry-exporter.js';

// Metrics
export { InMemoryMetricsCollector } from './metrics/in-memory-metrics-collector.js';

// Router
export { CapabilityMatcher } from './router/capability-matcher.js';
export { ModelHealthRegistry } from './router/health-registry.js';
export { CostPolicy } from './router/cost-policy.js';
export { UtilityModelRouter } from './router/utility-model-router.js';
export type { UtilityModelRouterOptions } from './router/utility-model-router.js';

// Context Store & Graph
export { ContextGraph } from './context/context-graph.js';
export { InMemoryContextStore } from './context/in-memory-context-store.js';
export type { InMemoryContextStoreOptions } from './context/in-memory-context-store.js';
export { DynamicContextManager } from './context/dynamic-context-manager.js';
export type { DynamicContextState } from './context/dynamic-context-manager.js';

// Syntax & Source Code Indexer (Aider-Style Repo-Map)
export { SourceCodeIndexer } from './syntax/source-code-indexer.js';

// Context Compiler
export { ContextDeduplicator } from './compiler/context-deduplicator.js';
export { ContextRanker } from './compiler/context-ranker.js';
export { ContextCompressor } from './compiler/context-compressor.js';
export type {
  MultiTierCompressorOptions,
  CompressionResult,
} from './compiler/context-compressor.js';
export { ContextCollapser, InMemoryCollapseStore } from './compiler/context-collapse.js';
export type {
  ApplyCollapseOptions,
  CollapseApplicationResult,
} from './compiler/context-collapse.js';
export { DefaultToolResultPruner } from './compiler/tool-result-pruner.js';
export type { PruneOptions } from './compiler/tool-result-pruner.js';
export { InMemoryCompactionLock } from './compiler/compaction-lock.js';
export type { LockState, InMemoryCompactionLockOptions } from './compiler/compaction-lock.js';
export { ContextValidator } from './compiler/context-validator.js';
export { CachePrefixTracker } from './compiler/cache-prefix-tracker.js';
export type { CacheEfficiencyReport } from './compiler/cache-prefix-tracker.js';
export { DefaultContextCompiler } from './compiler/default-context-compiler.js';
export type { DefaultContextCompilerOptions } from './compiler/default-context-compiler.js';

// Memory Subsystem
export { MemoryScorer } from './memory/memory-scorer.js';
export { MemoryLifecycle } from './memory/memory-lifecycle.js';
export { MemoryRetriever } from './memory/memory-retriever.js';
export { InMemoryMemoryProvider } from './memory/in-memory-memory-provider.js';
export { InMemoryMemoryStore } from './memory/in-memory-memory-store.js';
export type { InMemoryMemoryStoreOptions } from './memory/in-memory-memory-store.js';

// Tool Execution Layer
export { CommandSanitizer } from './tools/command-sanitizer.js';
export { DefaultToolRegistry } from './tools/default-tool-registry.js';
export { ReadFileTool } from './tools/builtin/read-file-tool.js';
export { WriteFileTool } from './tools/builtin/write-file-tool.js';
export { ListDirectoryTool } from './tools/builtin/list-directory-tool.js';
export { RunCommandTool } from './tools/builtin/run-command-tool.js';
export { DefaultToolExecutor } from './tools/default-tool-executor.js';
export type { DefaultToolExecutorOptions } from './tools/default-tool-executor.js';

// Security & Execution Policy Layer
export { ContextSanitizer } from './security/context-sanitizer.js';
export { SecretScrubber } from './security/secret-scrubber.js';
export { scrubEnv, SENSITIVE_PATTERNS, SecureTempManager } from './security/env-scrubber.js';
export { PathValidator } from './security/path-validator.js';
export type { PathValidationResult } from './security/path-validator.js';
export { RiskClassifier } from './security/risk-classifier.js';
export { CredentialProtectionRule } from './security/rules/credential-protection-rule.js';
export { PathRestrictionRule } from './security/rules/path-restriction-rule.js';
export { CommandRestrictionRule } from './security/rules/command-restriction-rule.js';
export { NetworkAccessRule } from './security/rules/network-access-rule.js';
export { ProductionProtectionRule } from './security/rules/production-protection-rule.js';
export { DefaultPolicyEngine } from './security/default-policy-engine.js';
export { LocalDevelopmentSandbox } from './security/local-development-sandbox.js';
export type { LocalDevelopmentSandboxOptions } from './security/local-development-sandbox.js';

// Verification & Evidence Layers
export { DefaultEvidenceStore } from './evidence/default-evidence-store.js';
export { DefaultEvidenceAggregator } from './evidence/default-evidence-aggregator.js';
export { ContradictoryEvidenceResolver } from './evidence/contradictory-evidence-resolver.js';
export { DefaultVerificationEngine } from './verification/default-verification-engine.js';
export type { DefaultVerificationEngineOptions } from './verification/default-verification-engine.js';

// Repository State Management & Checkpoints
export { DefaultCheckpointStore } from './checkpoint/default-checkpoint-store.js';
export type { DefaultCheckpointStoreOptions } from './checkpoint/default-checkpoint-store.js';
export { DefaultGitManager } from './git/default-git-manager.js';
export type { DefaultGitManagerOptions } from './git/default-git-manager.js';
export { RealGitManager } from './git/real-git-manager.js';
export type { RealGitManagerOptions } from './git/real-git-manager.js';
export { DefaultRollbackManager } from './git/default-rollback-manager.js';

// Subagent Subsystem
export { DefaultSubagentManager } from './subagent/default-subagent-manager.js';
export type { DefaultSubagentManagerOptions } from './subagent/default-subagent-manager.js';

// Human Escalation Subsystem
export { DefaultEscalationManager } from './escalation/default-escalation-manager.js';
export type { DefaultEscalationManagerOptions } from './escalation/default-escalation-manager.js';

// Observability, Telemetry & Cost Subsystem
export { DefaultCostTracker } from './cost/default-cost-tracker.js';
export { DefaultBudgetTracker } from './cost/default-budget-tracker.js';
export { DefaultTelemetryCollector } from './telemetry/default-telemetry-collector.js';
export type { DefaultTelemetryCollectorOptions } from './telemetry/default-telemetry-collector.js';

// Persistence & Crash Recovery Subsystem
export { DefaultStateStore } from './persistence/default-state-store.js';
export type { DefaultStateStoreOptions } from './persistence/default-state-store.js';
export { DefaultEventStore } from './persistence/default-event-store.js';
export type { DefaultEventStoreOptions } from './persistence/default-event-store.js';
export { JsonlEventStore } from './persistence/jsonl-event-store.js';
export type { JsonlEventStoreOptions } from './persistence/jsonl-event-store.js';
export { DefaultExecutionJournal } from './persistence/default-execution-journal.js';
export type { DefaultExecutionJournalOptions } from './persistence/default-execution-journal.js';
export { DefaultRecoveryManager } from './persistence/default-recovery-manager.js';
export { DefaultResumeManager } from './persistence/default-resume-manager.js';
export type { DefaultResumeManagerOptions } from './persistence/default-resume-manager.js';
export { StateCorruptionValidator } from './persistence/state-corruption-validator.js';

// Evaluation & Resilience
export { FaultInjector, FaultMode } from './resilience/fault-injector.js';
export { BASELINE_SCENARIOS, CANONICAL_BASELINE_SUITE } from './eval/baseline-scenarios.js';
export { StatisticalCalculator } from './eval/statistical-calculator.js';
export { WorkspaceIsolationManager } from './eval/workspace-isolation.js';
export type { WorkspaceIsolationOptions, IsolatedWorkspace } from './eval/workspace-isolation.js';
export { ViHarnessAdapterRunner } from './eval/vi-harness-adapter-runner.js';
export type { ViHarnessAdapterRunnerOptions } from './eval/vi-harness-adapter-runner.js';
export { PiHarnessAdapterRunner } from './eval/pi-harness-adapter-runner.js';
export type { PiHarnessAdapterRunnerOptions } from './eval/pi-harness-adapter-runner.js';
export { MarkdownReportGenerator } from './eval/markdown-report-generator.js';
export { DefaultBenchmarkRunner } from './eval/default-benchmark-runner.js';
export type { DefaultBenchmarkRunnerOptions } from './eval/default-benchmark-runner.js';
export { DualModelCostEvaluator } from './eval/dual-model-cost-evaluator.js';
export type {
  DualModelEvaluationReport,
  PhaseCostBreakdown,
} from './eval/dual-model-cost-evaluator.js';

// Performance Optimization Subsystem
export { PerformanceProfiler, TelemetryCategory } from './optimization/performance-profiler.js';
export { AdaptiveContextBudget } from './optimization/adaptive-context-budget.js';
export { EvidenceCache } from './optimization/evidence-cache.js';
export { ParallelToolExecutor } from './tools/parallel-tool-executor.js';

// Context Efficiency Benchmark Subsystem
export { ContextTrajectoryGenerator } from './eval/context-trajectory-generator.js';
export { ContextBenchmarkRunner } from './eval/context-benchmark-runner.js';
export { ContextBenchmarkReport } from './eval/context-benchmark-report.js';
export { NaiveAccumulationStrategy } from './eval/strategies/naive-accumulation-strategy.js';
export { PiCompactionStrategy } from './eval/strategies/pi-compaction-strategy.js';
export type { PiCompactionOptions } from './eval/strategies/pi-compaction-strategy.js';
export { ViContextCompilerStrategy } from './eval/strategies/vi-context-compiler-strategy.js';
export type { ViContextCompilerOptions } from './eval/strategies/vi-context-compiler-strategy.js';
export type {
  ContextBenchmarkStrategy,
  StrategyStepResult,
  RetentionEvaluationResult,
} from './eval/strategies/context-strategy.js';

// Pi Replacement Compatibility Layer Adapter
export { ViHarness } from './adapter/vi-harness-adapter.js';

// Meta-Harness & Verification Additions
export { MetaHarnessTraceLogger } from './logging/meta-harness-trace-logger.js';
export type { MetaHarnessTraceLoggerOptions } from './logging/meta-harness-trace-logger.js';
export { PrefixCachingCompiler } from './compiler/prefix-caching-compiler.js';
export type { PrefixCachingCompilerInput } from './compiler/prefix-caching-compiler.js';
export { ImpactedTestSelector } from './verification/impacted-test-selector.js';
export type { TestSelectionRule } from './verification/impacted-test-selector.js';

// Meta-Harness Outer-Loop Diagnostic & Telemetry
export { TraceDistiller } from './telemetry/trace-distiller.js';
export type { ToolPerformanceMetrics, CausalTraceAnalysis } from './telemetry/trace-distiller.js';
export { HarnessDiagnosticEngine } from './telemetry/harness-diagnostic-engine.js';
export type {
  HarnessRecommendation,
  HarnessDiagnosticReport,
} from './telemetry/harness-diagnostic-engine.js';

// Dynamic Context Budget Balancer
export { ContextBudgetBalancer } from './compiler/context-budget-balancer.js';
export type { TierAllocation, BalancedContextBudget } from './compiler/context-budget-balancer.js';

// Streaming Tool Parser
export { StreamingToolParser } from './model/streaming-tool-parser.js';
export type { IncrementalToolState } from './model/streaming-tool-parser.js';

// Cryptographic Audit Integrity
export { AuditIntegritySigner } from './security/audit-integrity-signer.js';
export type { SignedAuditPayload } from './security/audit-integrity-signer.js';

// Model Context Protocol (MCP) Subsystem
export { McpServer } from './mcp/mcp-server.js';
export type { McpServerOptions } from './mcp/mcp-server.js';
export { McpClientAdapter } from './mcp/mcp-client-adapter.js';
export type { McpClientAdapterOptions, McpTransport } from './mcp/mcp-client-adapter.js';
export type {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpToolDefinition,
  McpResourceDefinition,
  McpResourceContent,
  McpCallToolResult,
} from './mcp/mcp-types.js';

// Terminal UI (TUI) Dashboard
export { TerminalDashboardRenderer } from './tui/terminal-dashboard-renderer.js';
export type { DashboardState } from './tui/terminal-dashboard-renderer.js';

// Trajectory Distillation (SFT & DPO)
export { TrajectoryDatasetExporter } from './telemetry/trajectory-dataset-exporter.js';
export type {
  SftTrainingExample,
  DpoTrainingExample,
} from './telemetry/trajectory-dataset-exporter.js';

// Frozen Memory Snapshot & Self-Improvement
export { FrozenMemorySnapshot } from './memory/frozen-memory-snapshot.js';
export type {
  FrozenMemorySnapshotOptions,
  CreateSnapshotParams,
} from './memory/frozen-memory-snapshot.js';
export { SkillExtractor } from './memory/skill-extractor.js';
export type { SkillExtractorOptions } from './memory/skill-extractor.js';
export { SkillCurator } from './memory/skill-curator.js';
export type { SkillCuratorOptions, CurationReport } from './memory/skill-curator.js';

// Skills Catalog & Tools
export { DefaultSkillRegistry } from './skills/default-skill-registry.js';
export { createListSkillsTool, createLoadSkillTool } from './skills/skill-tools.js';

// Meta-Harness Experience Store & Auto-Tuning
export { DefaultExperienceStore } from './telemetry/experience-store.js';
export type {
  ExperienceStore,
  ExperienceStoreOptions,
  RunIndexEntry,
  RunRecord,
  RecordRunParams,
  RunTraceData,
  AutoTuneDecision,
} from './telemetry/experience-store.js';
export { HarnessAutoTuner } from './telemetry/harness-auto-tuner.js';
export type { AutoTuneOptions, AutoTuneResult } from './telemetry/harness-auto-tuner.js';
export type {
  RecommendationType,
  CrossRunAnalysisOptions,
  CrossRunAnalysisReport,
} from './telemetry/harness-diagnostic-engine.js';

// ProjDevBench (Project Development Benchmark)
export {
  ProjDevTaskLoader,
  ProjDevWorkspaceManager,
  ProjDevEvaluator,
  ProjDevExecutionAdapter,
  ProjDevReportGenerator,
  PROJDEVBENCH_KNOWN_LEADERBOARD,
} from './eval/projdevbench/index.js';
export type {
  ProjDevCategory,
  ProjDevDifficulty,
  ProjDevMode,
  TestVerdict,
  TestCaseResult,
  CodeReviewRule,
  ProjDevProblem,
  ProjDevProblemScore,
  ProjDevBenchmarkReport,
  LeaderboardEntry,
  ProjDevFilterOptions,
  ProjDevIsolatedWorkspace,
} from './eval/projdevbench/index.js';

// TBench (Terminal-Bench 2.0 / Harbor Framework)
export {
  TBenchTaskLoader,
  DefaultDockerEnvironment,
  MockDockerEnvironment,
  ViHarnessHarborAgent,
  TBenchRunner,
  TBenchReportGenerator,
  TBENCH_KNOWN_LEADERBOARD,
} from './eval/tbench/index.js';
export type {
  TBenchCategory,
  TBenchDifficulty,
  TBenchTask,
  FilterOpts as TBenchFilterOpts,
  Container as TBenchContainer,
  ExecResult as TBenchExecResult,
  DockerEnvironmentOptions,
  DockerEnvironment,
  TBenchRunConfig,
  TBenchTaskResult,
  TBenchCategoryStat,
  TBenchLeaderboardEntry,
  TBenchResults,
  TerminalConnection,
  ViHarnessHarborAgentOptions,
  TBenchRunnerOptions,
} from './eval/tbench/index.js';
export { TerminalTool } from './tools/terminal-tool.js';
export type { TerminalToolOptions } from './tools/terminal-tool.js';

// MCP Transports & Transport Registry
export { StdioTransport, HttpTransport } from './mcp/transports/index.js';
export type {
  Transport,
  JsonRpcHandler,
  StdioTransportOptions,
  HttpTransportOptions,
  TransportConfig,
} from './mcp/transports/index.js';
export { TransportRegistry } from './mcp/transport-registry.js';
export type { TransportFactory } from './mcp/transport-registry.js';

// Agent Client Protocol (ACP) Automation Server
export { AcpServer, AcpHandlers } from './acp/index.js';
export type {
  AcpNewSessionParams,
  AcpNewSessionResult,
  AcpSendMessageParams,
  AcpSendMessageResult,
  AcpSessionStatusParams,
  AcpSessionStatusResult,
  AcpCancelSessionParams,
  AcpCancelSessionResult,
  AcpSessionHistoryParams,
  AcpSessionHistoryResult,
  AcpAgentIdleParams,
  AcpAgentIdleResult,
  AcpAgentStatus,
  AcpHandlerOptions,
} from './acp/index.js';

// Persistent Storage (SQLite)
export {
  SqliteStore,
  SqliteSessionStore,
  SqliteExperienceStore,
  SqliteMemoryCurator,
  SqliteMetricsSink,
  computeTaskHash,
  MIGRATION_001_SQL,
} from './storage/index.js';
export type {
  BatchOp,
  StorageEngine,
  SessionSummary,
  SqliteSessionStoreOptions,
  ExperienceRecord,
  SqliteExperienceStoreOptions,
  MemoryEntry,
  SqliteMemoryCuratorOptions,
  MetricRecord,
  SessionMetricsAggregation,
  SqliteMetricsSinkOptions,
} from './storage/index.js';

// Profile System (DSH Reference)
export { ProfileLoader, ProfileManager, BUILTIN_PROFILES, KNOWN_BUNDLES } from './profile/index.js';
