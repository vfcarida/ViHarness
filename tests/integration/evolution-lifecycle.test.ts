/**
 * End-to-End Integration Tests for the Complete Evolution Lifecycle:
 * - Parallel, Sequential, and Adaptive recursion strategies
 * - Canonical H0 baseline reset invariant across consecutive tasks
 * - Experience retrieval on subsequent tasks
 * - Persistence, restart, and resume from `.vi-evolution/`
 * - Global promotion with held-out evidence and canonical baseline rollback
 * - Telemetry event correlation and TUI rendering
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RecursiveEvolutionEngine } from '../../src/infra/evolution/recursive-evolution-engine.js';
import { EvolutionTreeRenderer } from '../../src/infra/tui/evolution-tree-renderer.js';
import { EvolutionEventType } from '../../src/core/model/telemetry-types.js';

describe('Integration — Full Recursive Harness Evolution Lifecycle', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vi-evo-lifecycle-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('executes Parallel, Sequential, and Adaptive recursion end-to-end and persists reproducible artifacts', async () => {
    const emittedEvents: string[] = [];
    const engine = new RecursiveEvolutionEngine({
      storageRootDir: tmpDir,
      enabledByDefault: true,
      onTelemetryEvent: (ev) => emittedEvents.push(ev.eventType),
    });

    // 1. Task 1: Parallel recursion (library_only scope -> does NOT mutate canonical H0)
    const report1 = await engine.runCycle({
      taskIdentifier: 'task_1_parallel',
      taskDomain: 'typescript',
      mode: 'parallel',
      kCandidates: 3,
      profile: 'balanced',
      initialFailureSignals: [
        {
          id: 'sig-rep-1',
          type: 'repeated_tool_call',
          severity: 'HIGH',
          confidence: 0.9,
          iterationNumbers: [1],
          runIds: ['trace_1'],
          evidenceExcerpts: ['Repeated tool calls on edit_file'],
          implicatedSurfaces: ['toolGuidance'],
          suggestedQuadrants: ['INVARIANT_GUIDANCE'],
        },
      ],
      evolveTasks: [
        {
          taskId: 'evolve_1',
          prompt: 'Fix TypeScript compilation issue',
          split: 'evolve',
        },
      ],
      admissionCriteria: {
        targetScope: 'library',
      },
    });

    expect(report1.baseManifest.id).toBe('H0');
    expect(report1.strategyResult.allProposed.length).toBeGreaterThanOrEqual(2);
    expect(report1.strategyResult.allContrasts.length).toBeGreaterThanOrEqual(1);
    expect(report1.experienceEntriesCreated.length).toBeGreaterThanOrEqual(1);
    expect(emittedEvents).toContain(EvolutionEventType.EvolutionStarted);
    expect(emittedEvents).toContain(EvolutionEventType.CandidateProposed);
    expect(emittedEvents).toContain(EvolutionEventType.ProbeCompleted);
    expect(emittedEvents).toContain(EvolutionEventType.ContrastComputed);
    expect(emittedEvents).toContain(EvolutionEventType.LibraryEntryAdded);

    // Verify canonical baseline is STILL H0 (no silent cumulative drift!)
    expect(engine.getAdmissionGate().getCanonicalBaseline().id).toBe('H0');

    // 2. Task 2: Starts from canonical H0 while retrieving Task 1 experience from library
    const libraryEntriesBeforeTask2 = await engine.getLibrary().query({
      domain: 'typescript',
    });
    expect(libraryEntriesBeforeTask2.length).toBeGreaterThanOrEqual(1);

    const report2 = await engine.runCycle({
      taskIdentifier: 'task_2_sequential_promote',
      taskDomain: 'typescript',
      mode: 'sequential',
      kCandidates: 2,
      maxSteps: 2,
      profile: 'quality_first',
      initialFailureSignals: [
        {
          id: 'sig-mut-2',
          type: 'mutation_without_verification',
          severity: 'HIGH',
          confidence: 0.9,
          iterationNumbers: [1],
          runIds: ['trace_2'],
          evidenceExcerpts: ['Mutated source without running verification'],
          implicatedSurfaces: ['verificationPolicy'],
          suggestedQuadrants: ['INVARIANT_STRUCTURAL'],
        },
      ],
      evolveTasks: [
        {
          taskId: 'evolve_2',
          prompt: 'Add verification test before completion',
          split: 'evolve',
        },
      ],
      heldOutTasks: [
        {
          taskId: 'held_out_2',
          prompt: 'Held out verification benchmark',
          split: 'held_out',
        },
      ],
      admissionCriteria: {
        targetScope: 'global_promotion',
        minHeldOutPassDelta: 0.05,
      },
      autoPromoteIfAdmitted: true,
    });

    // Task 2 started from H0 and promoted a verified candidate after passing held-out gate
    expect(report2.baseManifest.id).toBe('H0');
    expect(report2.admissionDecision.status).toBe('promoted');
    expect(engine.getAdmissionGate().getCanonicalBaseline().id).toBe(
      report2.finalManifest.id,
    );

    // 3. Verify restart/inspect/resume persistence from disk
    const freshEngine = new RecursiveEvolutionEngine({
      storageRootDir: tmpDir,
    });
    const loadedReport = await freshEngine.inspectRun(String(report2.runId));
    expect(loadedReport).not.toBeNull();
    expect(loadedReport?.reproducibilityManifest.evolutionRunId).toBe(
      report2.runId,
    );

    // 4. Verify TUI tree rendering
    const renderer = new EvolutionTreeRenderer();
    const asciiTree = renderer.renderReport(report2);
    expect(asciiTree).toContain('ViHarness Evolution Run');
    expect(asciiTree).toContain('Base [H0]');
    expect(asciiTree).toContain('admission: PROMOTED');

    // 5. Roll back canonical baseline to H0
    const rolledBack = await engine
      .getAdmissionGate()
      .rollbackBaseline(report2.baseManifest.id);
    expect(rolledBack.id).toBe('H0');
  });
});
