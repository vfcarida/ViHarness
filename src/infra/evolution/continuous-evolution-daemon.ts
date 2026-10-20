/**
 * Wave 8.6 — Autonomous Self-Healing & Continuous Evolution Daemon (`ContinuousEvolutionDaemon`).
 *
 * Closes the autonomous operations loop between production telemetry anomalies,
 * lineage bisection, formal policy verification, MAP-Elites quality-diversity archiving,
 * and staged 10% canary deployment:
 *
 * 1. **Incident Queue Ingestion**: Collects production task failures, CUSUM canary rollback
 *    alarms, and recurring failure signals.
 * 2. **Automated Lineage Bisection & Surgical Excision**: When a canary rollback incident
 *    includes a multi-generation lineage $[H_0, \dots, H_k]$, runs `LineageBisectionDiagnoser`
 *    to excise the culprit mutation and re-stages the repaired manifest.
 * 3. **Bounded Self-Healing Evolution Tick**: When queued incidents reach `minIncidentsToTrigger`,
 *    executes `RecursiveEvolutionEngine.runCycle()`, validates & repairs policies via
 *    `StructuralPolicyInvariantVerifier`, updates `MapElitesHarnessArchive`, and stages
 *    admitted candidates into `CanaryDeploymentController` at `10%` traffic.
 */
import { createId } from '../../core/types/identifiers.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import type { FailureSignalType } from '../../core/evolution/failure-taxonomy.js';
import type {
  EvolutionCycleReport,
  RecursiveEvolutionEngine,
} from './recursive-evolution-engine.js';
import type {
  CanaryDeploymentController,
  CanaryHealthSnapshot,
} from './canary-deployment-controller.js';
import {
  MapElitesHarnessArchive,
  type MapElitesArchiveSnapshot,
} from './map-elites-archive.js';
import {
  StructuralPolicyInvariantVerifier,
  type StructuralPolicyVerificationReport,
} from './structural-policy-verifier.js';
import {
  LineageBisectionDiagnoser,
  type LineageBisectionReport,
  type LineageHealthPredicate,
} from './lineage-bisection-diagnoser.js';

export interface ProductionAnomalyIncident {
  readonly incidentId: string;
  readonly taskId: string;
  readonly prompt: string;
  readonly domain?: string;
  readonly failureSignal: FailureSignalType;
  readonly canaryRollbackTriggered?: boolean;
  readonly regressingLineage?: ReadonlyArray<HarnessManifest>;
  readonly lineageHealthPredicate?: LineageHealthPredicate;
  readonly timestamp?: string;
}

export interface SelfHealingTickReport {
  readonly actionTaken:
    | 'IDLE_BELOW_THRESHOLD'
    | 'LINEAGE_BISECTION_AND_CANARY_RESTAGE'
    | 'EVOLUTION_CYCLE_AND_CANARY_STAGE';
  readonly incidentsProcessed: number;
  readonly bisectionReport?: LineageBisectionReport;
  readonly evolutionReport?: EvolutionCycleReport;
  readonly policyVerification?: StructuralPolicyVerificationReport;
  readonly mapElitesSnapshot: MapElitesArchiveSnapshot;
  readonly canarySnapshot: CanaryHealthSnapshot;
  readonly rationale: string;
}

export interface ContinuousEvolutionDaemonOptions {
  readonly engine: RecursiveEvolutionEngine;
  readonly canaryController: CanaryDeploymentController;
  readonly mapElitesArchive?: MapElitesHarnessArchive;
  readonly policyVerifier?: StructuralPolicyInvariantVerifier;
  readonly bisectionDiagnoser?: LineageBisectionDiagnoser;
  readonly minIncidentsToTrigger?: number;
}

export class ContinuousEvolutionDaemon {
  private readonly engine: RecursiveEvolutionEngine;
  private readonly canaryController: CanaryDeploymentController;
  private readonly mapElitesArchive: MapElitesHarnessArchive;
  private readonly policyVerifier: StructuralPolicyInvariantVerifier;
  private readonly bisectionDiagnoser: LineageBisectionDiagnoser;
  private readonly minIncidentsToTrigger: number;

  private readonly incidentQueue: ProductionAnomalyIncident[] = [];
  private ticksExecuted = 0;

  constructor(options: ContinuousEvolutionDaemonOptions) {
    this.engine = options.engine;
    this.canaryController = options.canaryController;
    this.mapElitesArchive =
      options.mapElitesArchive ?? new MapElitesHarnessArchive();
    this.policyVerifier =
      options.policyVerifier ?? new StructuralPolicyInvariantVerifier();
    this.bisectionDiagnoser =
      options.bisectionDiagnoser ?? new LineageBisectionDiagnoser();
    this.minIncidentsToTrigger = options.minIncidentsToTrigger ?? 2;
  }

  /**
   * Queues a production anomaly or canary rollback incident for self-healing processing.
   */
  ingestIncident(incident: ProductionAnomalyIncident): number {
    this.incidentQueue.push(incident);
    return this.incidentQueue.length;
  }

  getQueuedIncidentCount(): number {
    return this.incidentQueue.length;
  }

  /**
   * Executes a single bounded self-healing daemon tick.
   */
  async runSelfHealingTick(): Promise<SelfHealingTickReport> {
    this.ticksExecuted += 1;

    // 1. Priority path: Canary rollback incident with multi-generation lineage bisection
    const rollbackIncidentIdx = this.incidentQueue.findIndex(
      (inc) =>
        inc.canaryRollbackTriggered &&
        inc.regressingLineage &&
        inc.regressingLineage.length >= 2,
    );

    if (rollbackIncidentIdx >= 0) {
      const [incident] = this.incidentQueue.splice(rollbackIncidentIdx, 1);
      const lineage = incident!.regressingLineage!;
      const predicate: LineageHealthPredicate =
        incident!.lineageHealthPredicate ??
        ((m) => this.policyVerifier.verifyManifestPolicies(m).satisfiable);

      const bisectionReport = await this.bisectionDiagnoser.bisectAndExcise({
        lineage,
        healthPredicate: predicate,
      });

      const repairResult = this.policyVerifier.autoRepairManifest(
        bisectionReport.excisedManifest,
      );
      const safeManifest = repairResult.repairedManifest;

      this.mapElitesArchive.recordCandidate({
        manifest: safeManifest,
        quadrant: 'INVARIANT_STRUCTURAL',
        utilityScore: bisectionReport.excisedManifestPassedPredicate ? 0.85 : 0.5,
        passRate: bisectionReport.excisedManifestPassedPredicate ? 0.9 : 0.6,
        meanCostDollars: 0.02,
        generationStep: this.ticksExecuted,
      });

      const canarySnapshot = this.canaryController.startCanaryRollout({
        canaryManifest: safeManifest,
        initialStage: 10,
      });

      return {
        actionTaken: 'LINEAGE_BISECTION_AND_CANARY_RESTAGE',
        incidentsProcessed: 1,
        bisectionReport,
        policyVerification: repairResult.verificationAfterRepair,
        mapElitesSnapshot: this.mapElitesArchive.getSnapshot(),
        canarySnapshot,
        rationale: bisectionReport.rationale,
      };
    }

    // 2. Standard path: Wait until queued incidents >= minIncidentsToTrigger
    if (this.incidentQueue.length < this.minIncidentsToTrigger) {
      return {
        actionTaken: 'IDLE_BELOW_THRESHOLD',
        incidentsProcessed: 0,
        mapElitesSnapshot: this.mapElitesArchive.getSnapshot(),
        canarySnapshot: this.canaryController.getSnapshot(),
        rationale: `Queued incidents (${this.incidentQueue.length}) below trigger threshold (${this.minIncidentsToTrigger}).`,
      };
    }

    const batch = this.incidentQueue.splice(0, this.incidentQueue.length);
    const evolveTasks = batch.map((inc) => ({
      taskId: inc.taskId,
      prompt: inc.prompt,
      domain: inc.domain ?? 'general',
      split: 'evolve' as const,
    }));

    const evolutionReport = await this.engine.runCycle({
      runId: createId<'EvolutionRun'>(`daemon_tick_${this.ticksExecuted}`),
      taskIdentifier: batch[0]!.taskId,
      taskDomain: batch[0]!.domain ?? 'general',
      enableBanditMetaRouter: true,
      pruneFreeRiderSurfaces: true,
      evolveTasks,
    });

    const repairResult = this.policyVerifier.autoRepairManifest(
      evolutionReport.finalManifest,
    );
    const verifiedManifest = repairResult.repairedManifest;

    // Record all evaluated candidates into the MAP-Elites Quality-Diversity archive
    for (let i = 0; i < evolutionReport.strategyResult.allProposed.length; i++) {
      const cand = evolutionReport.strategyResult.allProposed[i]!;
      const contrast = evolutionReport.strategyResult.allContrasts[i];
      this.mapElitesArchive.recordCandidate({
        manifest: cand.manifest,
        quadrant: cand.hypothesis.quadrant,
        utilityScore: 0.5 + (contrast?.partialScoreDelta ?? 0.1),
        passRate: Math.max(0, Math.min(1, 0.7 + (contrast?.passRateDelta ?? 0.1))),
        meanCostDollars: Math.max(
          0.005,
          0.02 + (contrast?.meanCostDollarsDelta ?? 0),
        ),
        generationStep: this.ticksExecuted,
      });
    }

    let canarySnapshot = this.canaryController.getSnapshot();
    if (
      evolutionReport.admissionDecision.status === 'promoted' ||
      evolutionReport.admissionDecision.status === 'library_only' ||
      evolutionReport.admissionDecision.status === 'task_only'
    ) {
      canarySnapshot = this.canaryController.startCanaryRollout({
        canaryManifest: verifiedManifest,
        canaryExperienceId: evolutionReport.experienceEntriesCreated[0]?.id,
        initialStage: 10,
      });
    }

    return {
      actionTaken: 'EVOLUTION_CYCLE_AND_CANARY_STAGE',
      incidentsProcessed: batch.length,
      evolutionReport,
      policyVerification: repairResult.verificationAfterRepair,
      mapElitesSnapshot: this.mapElitesArchive.getSnapshot(),
      canarySnapshot,
      rationale: `Processed ${batch.length} production incident(s) in self-healing tick #${this.ticksExecuted}; staged '${verifiedManifest.id}' at ${canarySnapshot.stagePercentage}% canary traffic.`,
    };
  }
}
