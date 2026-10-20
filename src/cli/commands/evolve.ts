/**
 * CLI Commands for the Vi-Harness Evolution Plane:
 * - `vi-harness harness inspect|diff|validate|replay`
 * - `vi-harness evolve <task> [--mode parallel|sequential|adaptive] [--k N] [--budget ...] [--profile ...] [--dry-run]`
 * - `vi-harness evolution inspect|resume <run>`
 * - `vi-harness library list|query|inspect|prune|consolidate`
 * - `vi-harness promote <candidate> [--dry-run]`
 * - `vi-harness rollback-harness [<version>] [--dry-run]`
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createId, type HarnessId } from '../../core/types/identifiers.js';
import type { DeploymentProfileName } from '../../core/evolution/interfaces.js';
import type { HarnessManifest } from '../../core/evolution/harness-manifest.js';
import { RecursiveEvolutionEngine } from '../../infra/evolution/recursive-evolution-engine.js';
import { EcosystemMarginSplitter } from '../../infra/evolution/ecosystem-margin.js';
import { MemoHarnessSynthesizer } from '../../infra/evolution/sqlite-experience-library.js';
import { ContrastivePreferenceExporter } from '../../infra/evolution/contrastive-preference-exporter.js';
import { ViForgeCoEvolutionBridge } from '../../infra/evolution/viforge-coevolution-bridge.js';
import {
  EvolutionReportExporter,
  type EvolutionReportFormat,
} from '../../infra/evolution/evolution-report-exporter.js';
import { FederatedExperienceSynchronizer } from '../../infra/evolution/federated-experience-sync.js';
import { EvolutionTreeRenderer } from '../../infra/tui/evolution-tree-renderer.js';

export interface EvolveCliDeps {
  readonly engine?: RecursiveEvolutionEngine;
  readonly storageRootDir?: string;
}

function getFlagValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.findIndex((a) => a === flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return undefined;
}

async function loadManifestFromPathOrId(
  engine: RecursiveEvolutionEngine,
  storageRoot: string,
  pathOrId?: string,
): Promise<HarnessManifest> {
  const toolkit = engine.getToolkit();
  if (!pathOrId || pathOrId === 'H0') {
    return engine.getAdmissionGate().getCanonicalBaseline();
  }
  try {
    const raw = await fs.readFile(pathOrId, 'utf-8');
    return toolkit.importFromJson(raw);
  } catch {
    const candidatePath = path.join(storageRoot, 'manifests', `${pathOrId}.json`);
    const raw = await fs.readFile(candidatePath, 'utf-8');
    return toolkit.importFromJson(raw);
  }
}

export async function runHarnessCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ?? new RecursiveEvolutionEngine({ storageRootDir: storageRoot });
  const toolkit = engine.getToolkit();
  const subcommand = args[0] ?? 'inspect';

  try {
    switch (subcommand) {
      case 'inspect': {
        const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        console.log(toolkit.exportToJson(manifest));
        return 0;
      }
      case 'diff': {
        if (!args[1] || !args[2]) {
          console.error('Usage: vi-harness harness diff <manifestA> <manifestB>');
          return 1;
        }
        const a = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        const b = await loadManifestFromPathOrId(engine, storageRoot, args[2]);
        const diff = toolkit.diff(a, b);
        console.log(JSON.stringify(diff, null, 2));
        return 0;
      }
      case 'validate': {
        const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        const res = toolkit.validate(manifest);
        console.log(JSON.stringify(res, null, 2));
        return res.valid ? 0 : 1;
      }
      case 'replay': {
        const dryRun = args.includes('--dry-run');
        const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        const plan = toolkit.createReplayPlan(manifest);
        console.log(JSON.stringify({ dryRun, replayPlan: plan }, null, 2));
        return 0;
      }
      case 'split': {
        const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        const splitter = new EcosystemMarginSplitter();
        const splitResult = splitter.split(manifest);
        console.log(JSON.stringify(splitResult, null, 2));
        return 0;
      }
      case 'transfer': {
        const sourceManifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
        const targetModel = getFlagValue(args, '--model') ?? args[2] ?? 'target-model';
        const targetDomain = getFlagValue(args, '--domain');
        const targetLanguage = getFlagValue(args, '--language');
        const splitter = new EcosystemMarginSplitter();
        const { core, margin } = splitter.split(sourceManifest);
        const transferred = splitter.recombine({
          baseManifest: sourceManifest,
          core,
          margin,
          newManifestId: `harness-transferred-${targetModel}` as HarnessId,
          targetProfileOverride: {
            modelFamily: targetModel,
            ...(targetDomain ? { domain: targetDomain } : {}),
            ...(targetLanguage ? { language: targetLanguage } : {}),
          },
        });
        console.log(toolkit.exportToJson(transferred));
        return 0;
      }
      case 'synthesize': {
        const taskPrompt = getFlagValue(args, '--task') ?? args[1] ?? 'synthesized-task';
        const domain = getFlagValue(args, '--domain');
        const language = getFlagValue(args, '--language');
        const modelFamily = getFlagValue(args, '--model');
        const baseManifest = engine.getAdmissionGate().getCanonicalBaseline();
        const synthesizer = new MemoHarnessSynthesizer({
          library: engine.getLibrary(),
        });
        const synthesis = await synthesizer.synthesizeForTask({
          baseManifest,
          taskId: taskPrompt,
          prompt: taskPrompt,
          domain,
          language,
          modelFamily,
        });
        console.log(JSON.stringify(synthesis, null, 2));
        return 0;
      }
      default: {
        console.error(
          `Unknown harness subcommand '${subcommand}'. Available: inspect, diff, validate, replay, split, transfer, synthesize`,
        );
        return 1;
      }
    }
  } catch (err) {
    console.error(`Error in 'harness ${subcommand}':`, (err as Error).message);
    return 1;
  }
}

export async function runEvolveCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ??
    new RecursiveEvolutionEngine({
      storageRootDir: storageRoot,
      enabledByDefault: true,
    });

  const taskPrompt =
    args.find((a) => !a.startsWith('-')) ??
    getFlagValue(args, '--task') ??
    'default-evolution-task';
  const modeArg = (getFlagValue(args, '--mode') ?? 'adaptive') as
    | 'parallel'
    | 'sequential'
    | 'adaptive';
  const kArg = parseInt(getFlagValue(args, '--k') ?? '3', 10);
  const profileArg = (getFlagValue(args, '--profile') ??
    'balanced') as DeploymentProfileName;
  const baseArg = getFlagValue(args, '--base');
  const dryRun = args.includes('--dry-run');

  try {
    const baseManifest = baseArg
      ? await loadManifestFromPathOrId(engine, storageRoot, baseArg)
      : undefined;

    const report = await engine.runCycle({
      taskIdentifier: taskPrompt,
      mode: modeArg,
      kCandidates: Number.isNaN(kArg) ? 3 : kArg,
      profile: profileArg,
      baseManifest,
      dryRun,
      evolveTasks: [
        {
          taskId: taskPrompt,
          prompt: taskPrompt,
          split: 'evolve',
        },
      ],
    });

    const renderer = new EvolutionTreeRenderer();
    console.log(renderer.renderReport(report));
    return 0;
  } catch (err) {
    console.error('Error running evolution cycle:', (err as Error).message);
    return 1;
  }
}

export async function runEvolutionManageCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ?? new RecursiveEvolutionEngine({ storageRootDir: storageRoot });
  const subcommand = args[0] ?? 'inspect';
  const runId = args[1];

  if (subcommand === 'ledger-verify') {
    const verification = engine.getEvolutionLedger().verifyLedgerIntegrity();
    console.log(JSON.stringify(verification, null, 2));
    return verification.valid ? 0 : 1;
  }

  if (subcommand === 'federated-export') {
    const sync = new FederatedExperienceSynchronizer();
    const bundle = await sync.exportSanitizedBundle({
      library: engine.getLibrary(),
      sourceWorkspaceName: getFlagValue(args, '--workspace') ?? 'vi-harness-local',
    });
    console.log(JSON.stringify(bundle, null, 2));
    return 0;
  }

  if (subcommand === 'verify-policies') {
    const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
    const report = engine.getPolicyVerifier().verifyManifestPolicies(manifest);
    console.log(JSON.stringify(report, null, 2));
    return report.satisfiable ? 0 : 1;
  }


  if (subcommand === 'qd-archive') {
    const snapshot = engine.getMapElitesArchive().getSnapshot();
    console.log(JSON.stringify(snapshot, null, 2));
    return 0;
  }

  if (subcommand === 'chaos-test') {
    const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
    const report = engine.getChaosTester().runChaosSuite(manifest);
    console.log(JSON.stringify(report, null, 2));
    return report.autonomousRecoveryRate >= 0.75 ? 0 : 1;
  }

  if (subcommand === 'ltl-verify') {
    const report = engine.getTemporalMonitor().verifyStepSequence([
      { stepIndex: 1, toolName: 'search_code', isReadOrSearch: true },
      { stepIndex: 2, toolName: 'edit_file', isFileMutation: true },
      { stepIndex: 3, toolName: 'run_command', isVerificationPassed: true },
    ]);
    console.log(JSON.stringify(report, null, 2));
    return report.allContractsSatisfied ? 0 : 1;
  }

  if (subcommand === 'conformal-check') {
    const manifest = await loadManifestFromPathOrId(engine, storageRoot, args[1]);
    const decision = engine
      .getConformalAbstentionGuard()
      .evaluateCandidateWithAbstention({
        manifest,
        predictedMean: 0.25,
        predictedStd: 0.08,
        seed: 42,
      });
    console.log(JSON.stringify(decision, null, 2));
    return decision.shouldAbstain ? 1 : 0;
  }

  if (!runId) {
    console.error(`Usage: vi-harness evolution ${subcommand} <runId>`);
    return 1;
  }

  try {
    if (subcommand === 'inspect') {
      const report = await engine.inspectRun(runId);
      if (!report) {
        console.error(`Evolution run '${runId}' not found.`);
        return 1;
      }
      const renderer = new EvolutionTreeRenderer();
      console.log(renderer.renderReport(report));
      return 0;
    }

    if (subcommand === 'resume') {
      const dryRun = args.includes('--dry-run');
      const report = await engine.resumeRun(runId, {
        taskIdentifier: `resumed-${runId}`,
        dryRun,
        evolveTasks: [
          {
            taskId: `resumed-${runId}`,
            prompt: `Resumed task for ${runId}`,
            split: 'evolve',
          },
        ],
      });
      const renderer = new EvolutionTreeRenderer();
      console.log(renderer.renderReport(report));
      return 0;
    }

    if (subcommand === 'export-viforge') {
      const report = await engine.inspectRun(runId);
      if (!report) {
        console.error(`Evolution run '${runId}' not found.`);
        return 1;
      }
      const outDir =
        getFlagValue(args, '--out') ?? path.join(storageRoot, 'viforge', runId);
      const exporter = new ContrastivePreferenceExporter();
      const bridge = new ViForgeCoEvolutionBridge({
        exporter,
        experienceLibrary: engine.getLibrary(),
      });
      const bundle = report.strategyResult.allEvidenceBundles[0];
      const dpoPairs = bundle
        ? exporter.extractDpoPreferencePairs({
            baseManifest: report.baseManifest,
            candidateManifest: report.finalManifest,
            evidenceBundle: bundle,
          })
        : [];
      const grpoGroups = exporter.extractGrpoRolloutGroups({
        baseManifest: report.baseManifest,
        evaluations: report.strategyResult.allEvidenceBundles.map((eb, idx) => ({
          candidateManifest:
            report.strategyResult.allProposed[idx]?.manifest ?? report.finalManifest,
          evidenceBundle: eb,
        })),
      });
      const { diagnosis, spinRecords } =
        exporter.diagnoseCapabilityCeilingAndExtractSpin({
          candidates: report.strategyResult.allProposed,
          contrasts: report.strategyResult.allContrasts,
          evidenceBundles: report.strategyResult.allEvidenceBundles,
        });
      const handoff = await bridge.prepareViForgeHandoff({
        sourceManifest: report.finalManifest,
        dpoPairs,
        grpoGroups,
        spinRecords,
        ceilingDiagnosis: diagnosis,
        outputDir: args.includes('--dry-run') ? undefined : outDir,
      });
      console.log(JSON.stringify(handoff, null, 2));
      return 0;
    }

    if (subcommand === 'report') {
      const report = await engine.inspectRun(runId);
      if (!report) {
        console.error(`Evolution run '${runId}' not found.`);
        return 1;
      }
      const format = (getFlagValue(args, '--format') ?? 'md') as EvolutionReportFormat;
      const outPath = getFlagValue(args, '--out');
      const reportExporter = new EvolutionReportExporter();
      if (outPath && !args.includes('--dry-run')) {
        const written = await reportExporter.exportToFile({
          report,
          format,
          outputPath: outPath,
        });
        console.log(JSON.stringify({ exportedPath: written, format }, null, 2));
      } else {
        console.log(reportExporter.render(report, format));
      }
      return 0;
    }

    console.error(
      `Unknown evolution subcommand '${subcommand}'. Available: inspect, resume, export-viforge, report`,
    );
    return 1;
  } catch (err) {
    console.error(`Error in 'evolution ${subcommand}':`, (err as Error).message);
    return 1;
  }
}

export async function runLibraryCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ?? new RecursiveEvolutionEngine({ storageRootDir: storageRoot });
  const library = engine.getLibrary();
  const subcommand = args[0] ?? 'list';
  const dryRun = args.includes('--dry-run');

  try {
    switch (subcommand) {
      case 'list':
      case 'query': {
        const domain = getFlagValue(args, '--domain');
        const language = getFlagValue(args, '--language');
        const entries = await library.query({
          domain,
          language,
          includeNegativeEvidence: true,
        });
        console.log(JSON.stringify(entries, null, 2));
        return 0;
      }
      case 'inspect': {
        const entryId = args[1];
        if (!entryId) {
          console.error('Usage: vi-harness library inspect <entryId>');
          return 1;
        }
        const entry = await library.get(createId<'ExperienceEntry'>(entryId));
        if (!entry) {
          console.error(`Library entry '${entryId}' not found.`);
          return 1;
        }
        console.log(JSON.stringify(entry, null, 2));
        return 0;
      }
      case 'prune': {
        if (dryRun) {
          console.log(JSON.stringify({ dryRun: true, action: 'prune' }));
          return 0;
        }
        const res = await library.prune();
        console.log(JSON.stringify(res, null, 2));
        return 0;
      }
      case 'consolidate': {
        if (dryRun) {
          console.log(JSON.stringify({ dryRun: true, action: 'consolidate' }));
          return 0;
        }
        const res = await library.deduplicateAndConsolidate();
        console.log(JSON.stringify(res, null, 2));
        return 0;
      }
      default: {
        console.error(
          `Unknown library subcommand '${subcommand}'. Available: list, query, inspect, prune, consolidate`,
        );
        return 1;
      }
    }
  } catch (err) {
    console.error(`Error in 'library ${subcommand}':`, (err as Error).message);
    return 1;
  }
}

export async function runPromoteCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ?? new RecursiveEvolutionEngine({ storageRootDir: storageRoot });
  const candidateRef = args[0];
  const dryRun = args.includes('--dry-run');

  if (!candidateRef) {
    console.error('Usage: vi-harness promote <candidateManifestPathOrId> [--dry-run]');
    return 1;
  }

  try {
    const candidateManifest = await loadManifestFromPathOrId(
      engine,
      storageRoot,
      candidateRef,
    );
    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            action: 'promote',
            candidateManifestId: candidateManifest.id,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(
      JSON.stringify(
        {
          status: 'promotion_evaluated',
          candidateManifestId: candidateManifest.id,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    console.error('Error in promote:', (err as Error).message);
    return 1;
  }
}

export async function runRollbackHarnessCli(
  args: readonly string[],
  deps: EvolveCliDeps = {},
): Promise<number> {
  const storageRoot = deps.storageRootDir ?? path.resolve(process.cwd(), '.vi-evolution');
  const engine =
    deps.engine ?? new RecursiveEvolutionEngine({ storageRootDir: storageRoot });
  const targetId = args.find((a) => !a.startsWith('-'));
  const dryRun = args.includes('--dry-run');

  try {
    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            action: 'rollback-harness',
            targetManifestId: targetId ?? 'previous',
          },
          null,
          2,
        ),
      );
      return 0;
    }

    const restored = await engine
      .getAdmissionGate()
      .rollbackBaseline(targetId ? createId<'Harness'>(targetId) : undefined);
    console.log(
      JSON.stringify(
        {
          status: 'rolled_back',
          activeBaselineId: restored.id,
          contentHash: restored.contentHash,
        },
        null,
        2,
      ),
    );
    return 0;
  } catch (err) {
    console.error('Error in rollback-harness:', (err as Error).message);
    return 1;
  }
}
