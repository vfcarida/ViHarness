/**
 * Injection tokens.
 *
 * Each token is a unique Symbol that identifies a service in the container.
 * Using Symbol.for() ensures tokens are consistent across module boundaries.
 */

export const TOKENS = {
  // Cross-cutting
  Logger: Symbol.for('vi-harness.Logger'),
  Clock: Symbol.for('vi-harness.Clock'),
  Configuration: Symbol.for('vi-harness.Configuration'),
  IdFactory: Symbol.for('vi-harness.IdFactory'),

  // Model
  ModelProvider: Symbol.for('vi-harness.ModelProvider'),
  ModelRouter: Symbol.for('vi-harness.ModelRouter'),

  // Context
  ContextStore: Symbol.for('vi-harness.ContextStore'),
  MemoryStore: Symbol.for('vi-harness.MemoryStore'),
  ContextCompiler: Symbol.for('vi-harness.ContextCompiler'),

  // Tools
  ToolExecutor: Symbol.for('vi-harness.ToolExecutor'),

  // Policy
  PolicyEngine: Symbol.for('vi-harness.PolicyEngine'),

  // Verification
  VerificationEngine: Symbol.for('vi-harness.VerificationEngine'),

  // Evidence
  EvidenceStore: Symbol.for('vi-harness.EvidenceStore'),

  // Checkpoint
  CheckpointStore: Symbol.for('vi-harness.CheckpointStore'),

  // State
  StateStore: Symbol.for('vi-harness.StateStore'),

  // Runtime & Architecture
  AgentRuntime: Symbol.for('vi-harness.AgentRuntime'),
  ArchitectMode: Symbol.for('vi-harness.ArchitectMode'),

  // Model Providers & Exporters
  AnthropicProvider: Symbol.for('vi-harness.AnthropicProvider'),
  GeminiProvider: Symbol.for('vi-harness.GeminiProvider'),
  OtlpExporter: Symbol.for('vi-harness.OtlpExporter'),

  // Synthesis Modules & Subsystems
  Compaction: Symbol.for('vi-harness.Compaction'),
  CacheCompaction: Symbol.for('vi-harness.CacheCompaction'),
  RepoMap: Symbol.for('vi-harness.RepoMap'),
  GitManager: Symbol.for('vi-harness.GitManager'),
  GoalBudgets: Symbol.for('vi-harness.GoalBudgets'),
  MemoryManager: Symbol.for('vi-harness.MemoryManager'),
  SessionStore: Symbol.for('vi-harness.SessionStore'),
  ExperienceStore: Symbol.for('vi-harness.ExperienceStore'),
  McpTransport: Symbol.for('vi-harness.McpTransport'),
  Storage: Symbol.for('vi-harness.Storage'),
  MetricsSink: Symbol.for('vi-harness.MetricsSink'),

  // Evolution Plane
  HarnessSurfaceRegistry: Symbol.for('vi-harness.HarnessSurfaceRegistry'),
  HarnessManifestToolkit: Symbol.for('vi-harness.HarnessManifestToolkit'),
  HarnessDiagnoser: Symbol.for('vi-harness.HarnessDiagnoser'),
  HarnessProposer: Symbol.for('vi-harness.HarnessProposer'),
  CandidateRegularizer: Symbol.for('vi-harness.CandidateRegularizer'),
  HarnessProbeRunner: Symbol.for('vi-harness.HarnessProbeRunner'),
  BehavioralContrastAnalyzer: Symbol.for('vi-harness.BehavioralContrastAnalyzer'),
  HarnessComposer: Symbol.for('vi-harness.HarnessComposer'),
  HarnessCandidateSelector: Symbol.for('vi-harness.HarnessCandidateSelector'),
  HarnessAdmissionGate: Symbol.for('vi-harness.HarnessAdmissionGate'),
  HarnessExperienceLibrary: Symbol.for('vi-harness.HarnessExperienceLibrary'),
  RecursiveEvolutionEngine: Symbol.for('vi-harness.RecursiveEvolutionEngine'),
  DiscriminativeTaskSelector: Symbol.for('vi-harness.DiscriminativeTaskSelector'),
  ContrastivePreferenceExporter: Symbol.for('vi-harness.ContrastivePreferenceExporter'),
  MemoHarnessSynthesizer: Symbol.for('vi-harness.MemoHarnessSynthesizer'),
  EcosystemMarginSplitter: Symbol.for('vi-harness.EcosystemMarginSplitter'),
  AdversarialProbeGenerator: Symbol.for('vi-harness.AdversarialProbeGenerator'),
  ExecutableSurfaceAstVerifier: Symbol.for('vi-harness.ExecutableSurfaceAstVerifier'),
  ViForgeCoEvolutionBridge: Symbol.for('vi-harness.ViForgeCoEvolutionBridge'),
  EvolutionRpcDispatcher: Symbol.for('vi-harness.EvolutionRpcDispatcher'),
  WorktreeProbeSandboxManager: Symbol.for('vi-harness.WorktreeProbeSandboxManager'),
  ShapleyComponentAttributor: Symbol.for('vi-harness.ShapleyComponentAttributor'),
  CanaryDeploymentController: Symbol.for('vi-harness.CanaryDeploymentController'),
  BradleyTerryHarnessRanker: Symbol.for('vi-harness.BradleyTerryHarnessRanker'),
  EvolutionReportExporter: Symbol.for('vi-harness.EvolutionReportExporter'),
  LiveManifestHotSwapOrchestrator: Symbol.for('vi-harness.LiveManifestHotSwapOrchestrator'),
  CryptographicEvolutionLedger: Symbol.for('vi-harness.CryptographicEvolutionLedger'),
  CounterfactualTraceSplicer: Symbol.for('vi-harness.CounterfactualTraceSplicer'),
  ContextualBanditMetaRouter: Symbol.for('vi-harness.ContextualBanditMetaRouter'),
  FederatedExperienceSynchronizer: Symbol.for('vi-harness.FederatedExperienceSynchronizer'),
  EvolutionCockpitServer: Symbol.for('vi-harness.EvolutionCockpitServer'),
  MapElitesHarnessArchive: Symbol.for('vi-harness.MapElitesHarnessArchive'),
  SubmodularBenchmarkCoEvolver: Symbol.for('vi-harness.SubmodularBenchmarkCoEvolver'),
  StructuralPolicyInvariantVerifier: Symbol.for('vi-harness.StructuralPolicyInvariantVerifier'),
  LineageBisectionDiagnoser: Symbol.for('vi-harness.LineageBisectionDiagnoser'),
  ConformalUtilityCalibrator: Symbol.for('vi-harness.ConformalUtilityCalibrator'),
  ContinuousEvolutionDaemon: Symbol.for('vi-harness.ContinuousEvolutionDaemon'),
  BayesianHarnessSurrogateModel: Symbol.for('vi-harness.BayesianHarnessSurrogateModel'),
  EpistaticSurfaceGraphAnalyzer: Symbol.for('vi-harness.EpistaticSurfaceGraphAnalyzer'),
  RuntimeTemporalContractMonitor: Symbol.for('vi-harness.RuntimeTemporalContractMonitor'),
  HypervolumeParetoSelector: Symbol.for('vi-harness.HypervolumeParetoSelector'),
  SkillSubagentDistiller: Symbol.for('vi-harness.SkillSubagentDistiller'),
  ChaosFaultInjectionTester: Symbol.for('vi-harness.ChaosFaultInjectionTester'),
  ConformalAbstentionGuard: Symbol.for('vi-harness.ConformalAbstentionGuard'),
} as const;



