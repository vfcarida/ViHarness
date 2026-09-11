/**
 * Micro-Compactor: Multi-Tier Dynamic Context Pruning & Micro-Compaction.
 *
 * Implements SOTA 2026 Context Efficiency & Compaction Pipeline:
 *
 * 1. DYNAMIC STALE READ INVALIDATION (Tombstoning):
 *    Identifies files that were read in earlier iterations or context entries but subsequently
 *    modified (written or edited). Replaces out-of-date bulky file dumps with a lightweight tombstone,
 *    preventing the model from hallucinating superseded code while freeing up thousands of tokens.
 *
 * 2. RESOLVED COMMAND & TEST FAILURE COMPACTION:
 *    Detects when an earlier command or test failure (e.g. build failure, pytest error, linter crash)
 *    is subsequently resolved by a successful execution of that command or test suite.
 *    Compacts the catastrophic 100+ line dead stack trace into a concise resolution note while
 *    preserving the memory of the fix.
 *
 * 3. CONSECUTIVE REDUNDANT OUTPUT COLLAPSE:
 *    Collapses consecutive repetitive polling checks or identical non-mutating tool queries
 *    into consolidated summary tokens.
 *
 * 4. DUAL-LAYER ADAPTER:
 *    Seamlessly operates on both graph-level ContextObjects (for ContextCompiler / ContextCompressor)
 *    and execution-level ActionResults (for IterationExecutor).
 */

import type { MicroCompactorConfig } from '../../core/model/compiler-types.js';
import type { ContextObject } from '../../core/model/context-object.js';
import { ContextObjectType } from '../../core/model/context-object.js';
import type { ActionResult } from '../../core/model/action.js';
import { ActionResultStatus } from '../../core/model/action.js';
import { SwePruner, type SwePrunerOptions } from './swe-pruner.js';

export interface MicroCompactorOptions extends MicroCompactorConfig {
  /**
   * Fallback options passed to underlying SwePruner.
   */
  readonly swePrunerOptions?: SwePrunerOptions;
}

export interface MicroCompactedEntry {
  readonly id: string;
  readonly kind: 'stale_read' | 'resolved_failure' | 'redundant_output';
  readonly target: string;
  readonly originalLength: number;
  readonly compactedLength: number;
  readonly summary: string;
}

export interface MicroCompactionResult {
  readonly objects: ContextObject[];
  readonly compactedEntries: ReadonlyArray<MicroCompactedEntry>;
  readonly staleReadsCount: number;
  readonly resolvedFailuresCount: number;
  readonly redundantOutputsCount: number;
  readonly charactersSaved: number;
  readonly tokensSavedEstimate: number;
}

export interface IterationToolResultCompaction {
  readonly output: string;
  readonly wasCompacted: boolean;
  readonly kind?: 'stale_read' | 'resolved_failure' | 'age_compacted' | 'unmodified';
  readonly isError: boolean;
}

export interface PriorIterationRecord {
  readonly sequenceNumber: number;
  readonly toolResults?: ReadonlyArray<ActionResult>;
  readonly actionProposals?: ReadonlyArray<{
    readonly id?: string;
    readonly type?: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
  }>;
}

export class MicroCompactor {
  private readonly options: Required<Omit<MicroCompactorOptions, 'swePrunerOptions'>> & {
    swePrunerOptions?: SwePrunerOptions;
  };

  constructor(options: MicroCompactorOptions = {}) {
    this.options = {
      invalidateStaleReads: options.invalidateStaleReads ?? true,
      compactResolvedFailures: options.compactResolvedFailures ?? true,
      collapseRedundantOutputs: options.collapseRedundantOutputs ?? true,
      minCharThreshold: options.minCharThreshold ?? 120,
      swePrunerOptions: options.swePrunerOptions,
    };
  }

  /**
   * Normalizes file paths for cross-platform comparison (handles slashes and casing).
   */
  static normalizePath(rawPath: string): string {
    if (!rawPath) return '';
    return rawPath
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .toLowerCase();
  }

  /**
   * Normalizes command strings by trimming whitespace and normalizing flag spacing.
   */
  static normalizeCommand(rawCmd: string): string {
    if (!rawCmd) return '';
    return rawCmd.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /**
   * Compact an array of ContextObjects for the ContextCompiler pipeline.
   */
  compactContextObjects(objects: ReadonlyArray<ContextObject>): MicroCompactionResult {
    const minThreshold = this.options.minCharThreshold;
    const compactedEntries: MicroCompactedEntry[] = [];
    let staleReadsCount = 0;
    let resolvedFailuresCount = 0;
    let redundantOutputsCount = 0;
    let charactersSaved = 0;

    // 1. Index file modifications and command outcomes
    const fileModifications = new Map<string, { timestamp: number; index: number }>();
    const successfulCommands = new Map<string, { timestamp: number; index: number }>();

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i]!;
      const ts = obj.timestamp ? obj.timestamp.getTime() : i;

      // Detect file mutation (write_file, edit_file, or ARTIFACT with file path)
      const filePath = this.extractFilePathFromObject(obj);
      const isMutation =
        obj.tags.includes('file_write') ||
        obj.tags.includes('file_edit') ||
        obj.tags.includes('write_file') ||
        obj.tags.includes('edit_file') ||
        obj.metadata['toolName'] === 'write_file' ||
        obj.metadata['toolName'] === 'edit_file';

      if (filePath && isMutation) {
        const normPath = MicroCompactor.normalizePath(filePath);
        fileModifications.set(normPath, { timestamp: ts, index: i });
      }

      // Detect successful command or test
      const cmd = this.extractCommandFromObject(obj);
      const isSuccess =
        obj.type === ContextObjectType.TEST ||
        obj.tags.includes('success') ||
        obj.tags.includes('command_success') ||
        obj.metadata['exitCode'] === 0 ||
        obj.metadata['status'] === 'SUCCESS';

      if (cmd && isSuccess) {
        const normCmd = MicroCompactor.normalizeCommand(cmd);
        successfulCommands.set(normCmd, { timestamp: ts, index: i });
      }
    }

    // 2. Perform object transformations
    const resultObjects: ContextObject[] = [];

    for (let i = 0; i < objects.length; i++) {
      let obj = objects[i]!;

      // Invariant check: never micro-compact must-preserve items or user instructions
      if (
        obj.tags.includes('must_preserve') ||
        obj.type === ContextObjectType.USER_INSTRUCTION ||
        obj.type === ContextObjectType.DECISION ||
        obj.type === ContextObjectType.SECURITY_RULE
      ) {
        resultObjects.push(obj);
        continue;
      }

      // Stage A: Dynamic Stale Read Invalidation
      if (this.options.invalidateStaleReads) {
        const filePath = this.extractFilePathFromObject(obj);
        const isRead =
          obj.type === ContextObjectType.FILE ||
          obj.tags.includes('read_file') ||
          obj.tags.includes('file_read') ||
          obj.metadata['toolName'] === 'read_file';

        if (filePath && isRead) {
          const normPath = MicroCompactor.normalizePath(filePath);
          const modification = fileModifications.get(normPath);

          if (modification && modification.index > i && obj.content.length > minThreshold) {
            const originalLength = obj.content.length;
            const tombstone = `[Stale Read Tombstone: '${filePath}' was read earlier, but superseded by subsequent modifications. File content omitted to prevent stale state hallucination.]`;
            const compactedTokens = Math.ceil(tombstone.length / 4);

            charactersSaved += originalLength - tombstone.length;
            staleReadsCount++;

            compactedEntries.push({
              id: obj.id,
              kind: 'stale_read',
              target: filePath,
              originalLength,
              compactedLength: tombstone.length,
              summary: tombstone,
            });

            obj = {
              ...obj,
              content: tombstone,
              costTokens: compactedTokens,
              tags: [...obj.tags, 'stale_read_tombstone'],
              metadata: {
                ...obj.metadata,
                isStaleReadTombstone: true,
                supersededByIndex: modification.index,
              },
            };
          }
        }
      }

      // Stage B: Resolved Failure Compaction
      if (this.options.compactResolvedFailures) {
        const isFailure =
          obj.type === ContextObjectType.FAILURE ||
          obj.tags.includes('failure') ||
          obj.tags.includes('error') ||
          (typeof obj.metadata['exitCode'] === 'number' && obj.metadata['exitCode'] !== 0);

        const cmd = this.extractCommandFromObject(obj);

        if (isFailure && cmd) {
          const normCmd = MicroCompactor.normalizeCommand(cmd);
          const success = successfulCommands.get(normCmd);

          if (success && success.index > i && obj.content.length > minThreshold) {
            const originalLength = obj.content.length;
            const exitCode = obj.metadata['exitCode'] ?? 'non-zero';
            const resolution = `[Resolved Failure: command '${cmd}' previously failed (exit code ${exitCode}), subsequently succeeded. Full stack trace compacted.]`;
            const compactedTokens = Math.ceil(resolution.length / 4);

            charactersSaved += originalLength - resolution.length;
            resolvedFailuresCount++;

            compactedEntries.push({
              id: obj.id,
              kind: 'resolved_failure',
              target: cmd,
              originalLength,
              compactedLength: resolution.length,
              summary: resolution,
            });

            obj = {
              ...obj,
              content: resolution,
              costTokens: compactedTokens,
              tags: [...obj.tags, 'resolved_failure'],
              metadata: {
                ...obj.metadata,
                isResolvedFailure: true,
                resolvedByIndex: success.index,
              },
            };
          }
        }
      }

      // Stage C: Consecutive Redundant Output Collapse
      if (this.options.collapseRedundantOutputs && resultObjects.length > 0) {
        const prevObj = resultObjects[resultObjects.length - 1]!;
        const isObservation =
          obj.type === ContextObjectType.OBSERVATION || obj.tags.includes('tool_output');
        const prevIsObservation =
          prevObj.type === ContextObjectType.OBSERVATION || prevObj.tags.includes('tool_output');

        if (isObservation && prevIsObservation) {
          const sigCurrent = this.computeSignature(obj.content);
          const sigPrev = this.computeSignature(prevObj.content);

          if (sigCurrent === sigPrev && obj.content.length > minThreshold) {
            const originalLength = prevObj.content.length;
            const summary = `[Micro-Compacted Redundant Output: identical check repeated, see subsequent output]`;
            const compactedTokens = Math.ceil(summary.length / 4);

            charactersSaved += originalLength - summary.length;
            redundantOutputsCount++;

            compactedEntries.push({
              id: prevObj.id,
              kind: 'redundant_output',
              target: prevObj.scopeTarget ?? 'redundant_output',
              originalLength,
              compactedLength: summary.length,
              summary,
            });

            resultObjects[resultObjects.length - 1] = {
              ...prevObj,
              content: summary,
              costTokens: compactedTokens,
              tags: [...prevObj.tags, 'redundant_output_collapsed'],
            };
          }
        }
      }

      resultObjects.push(obj);
    }

    const tokensSavedEstimate = Math.ceil(charactersSaved / 4);

    return {
      objects: resultObjects,
      compactedEntries,
      staleReadsCount,
      resolvedFailuresCount,
      redundantOutputsCount,
      charactersSaved,
      tokensSavedEstimate,
    };
  }

  /**
   * Creates an iteration-level compactor initialized with historical iterations.
   * Designed for integration with IterationExecutor and prompt assembly.
   */
  static createIterationCompactor(
    iterations: ReadonlyArray<PriorIterationRecord>,
    currentSeq: number,
    options: MicroCompactorOptions = {},
  ): {
    compactToolResult: (params: {
      iterationSeq: number;
      actionResult: ActionResult;
    }) => IterationToolResultCompaction;
  } {
    const compactor = new MicroCompactor(options);
    const minThreshold = compactor.options.minCharThreshold;
    const swePruner = new SwePruner(compactor.options.swePrunerOptions);

    // 1. Map latest file modification sequence number per normalized path
    const latestFileWrites = new Map<string, number>();

    // 2. Map successful command executions (normalized command -> highest success sequence)
    const latestCommandSuccesses = new Map<string, number>();

    for (const iter of iterations) {
      const seq = iter.sequenceNumber;

      if (iter.toolResults) {
        for (const res of iter.toolResults) {
          const toolName = String(res.metadata['toolName'] ?? '').toLowerCase();
          const targetPath = String(
            res.metadata['path'] ??
              res.metadata['filePath'] ??
              res.metadata['targetFile'] ??
              '',
          );
          const command = String(res.metadata['command'] ?? '');
          const isSuccess =
            res.status === ActionResultStatus.SUCCESS && !res.error && res.metadata['exitCode'] === 0;

          if (
            (toolName === 'write_file' || toolName === 'edit_file') &&
            targetPath &&
            res.status === ActionResultStatus.SUCCESS
          ) {
            const normPath = MicroCompactor.normalizePath(targetPath);
            const prev = latestFileWrites.get(normPath) ?? -1;
            if (seq > prev) {
              latestFileWrites.set(normPath, seq);
            }
          }

          if (toolName === 'run_command' && command && isSuccess) {
            const normCmd = MicroCompactor.normalizeCommand(command);
            const prev = latestCommandSuccesses.get(normCmd) ?? -1;
            if (seq > prev) {
              latestCommandSuccesses.set(normCmd, seq);
            }
          }
        }
      }
    }

    return {
      compactToolResult: (params: {
        iterationSeq: number;
        actionResult: ActionResult;
      }): IterationToolResultCompaction => {
        const { iterationSeq, actionResult } = params;
        const toolName = String(actionResult.metadata['toolName'] ?? '').toLowerCase();
        const targetPath = String(
          actionResult.metadata['path'] ??
            actionResult.metadata['filePath'] ??
            actionResult.metadata['targetFile'] ??
            '',
        );
        const command = String(actionResult.metadata['command'] ?? '');
        const output = actionResult.output || (actionResult.error ?? '');
        const isError =
          actionResult.status === ActionResultStatus.FAILURE ||
          actionResult.status === ActionResultStatus.DENIED ||
          Boolean(actionResult.error);

        // 1. Check for Dynamic Stale Read Invalidation
        if (
          compactor.options.invalidateStaleReads &&
          toolName === 'read_file' &&
          targetPath &&
          output.length >= minThreshold
        ) {
          const normPath = MicroCompactor.normalizePath(targetPath);
          const writeSeq = latestFileWrites.get(normPath);

          if (typeof writeSeq === 'number' && writeSeq > iterationSeq) {
            return {
              output: `[Stale Read Tombstone: '${targetPath}' read in iteration #${iterationSeq}, superseded by modifications in iteration #${writeSeq}. Output omitted to prevent stale state hallucination.]`,
              wasCompacted: true,
              kind: 'stale_read',
              isError: false,
            };
          }
        }

        // 2. Check for Resolved Failure Compaction
        if (
          compactor.options.compactResolvedFailures &&
          isError &&
          toolName === 'run_command' &&
          command &&
          output.length >= minThreshold
        ) {
          const normCmd = MicroCompactor.normalizeCommand(command);
          const successSeq = latestCommandSuccesses.get(normCmd);

          if (typeof successSeq === 'number' && successSeq > iterationSeq) {
            const exitCode = actionResult.metadata['exitCode'] ?? 'error';
            return {
              output: `[Resolved Failure: command '${command}' failed in iteration #${iterationSeq} (exit code ${exitCode}), subsequently passed in iteration #${successSeq}. Full stack trace omitted as issue is resolved.]`,
              wasCompacted: true,
              kind: 'resolved_failure',
              isError: false,
            };
          }
        }

        // 3. Fallback to SwePruner for standard age-based compaction
        if (swePruner.shouldCompact(iterationSeq, currentSeq, actionResult)) {
          return {
            output: swePruner.compactOutput(actionResult),
            wasCompacted: true,
            kind: 'age_compacted',
            isError,
          };
        }

        // 4. Retain unmodified
        return {
          output,
          wasCompacted: false,
          kind: 'unmodified',
          isError,
        };
      },
    };
  }

  private extractFilePathFromObject(obj: ContextObject): string | undefined {
    if (obj.scopeTarget && (obj.scopeTarget.includes('.') || obj.scopeTarget.includes('/'))) {
      return obj.scopeTarget;
    }
    const metaPath =
      obj.metadata['filePath'] ?? obj.metadata['path'] ?? obj.metadata['targetFile'];
    if (typeof metaPath === 'string') {
      return metaPath;
    }
    return undefined;
  }

  private extractCommandFromObject(obj: ContextObject): string | undefined {
    const metaCmd = obj.metadata['command'] ?? obj.metadata['cmd'];
    if (typeof metaCmd === 'string') {
      return metaCmd;
    }
    if (obj.scopeTarget && (obj.scopeTarget.includes(' ') || obj.scopeTarget.includes('-'))) {
      return obj.scopeTarget;
    }
    // Attempt regex extraction from content if formatted
    const match = /(?:command|executing|ran):\s*[`"']([^`"']+)['"`]/i.exec(obj.content);
    if (match && match[1]) {
      return match[1];
    }
    return undefined;
  }

  private computeSignature(content: string): string {
    return content
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '<TIMESTAMP>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }
}
