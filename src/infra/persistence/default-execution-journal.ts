/**
 * Default Execution Journal.
 *
 * Implements ExecutionJournal interface:
 * Logs action proposals (PROPOSED), policy authorization (AUTHORIZED), execution start (STARTED),
 * completion (COMPLETED), failure (FAILED), and unknown status (UNKNOWN) with unique execution IDs.
 * Detects interrupted executions left uncompleted upon crash restart.
 */
import type { ExecutionJournal } from '../../core/interfaces/execution-journal.js';
import type { ExecutionId, TaskId, IdFactory } from '../../core/types/identifiers.js';
import type { Clock } from '../../core/interfaces/clock.js';
import type { JournalEntry } from '../../core/model/recovery-types.js';
import { ActionExecutionStatus } from '../../core/model/recovery-types.js';
import type { ActionProposal, ActionResult } from '../../core/model/action.js';
import { ActionType } from '../../core/model/action.js';

export interface DefaultExecutionJournalOptions {
  readonly idFactory: IdFactory;
  readonly clock: Clock;
}

export class DefaultExecutionJournal implements ExecutionJournal {
  private readonly entries = new Map<ExecutionId, JournalEntry>();
  private readonly idFactory: IdFactory;
  private readonly clock: Clock;

  constructor(options: DefaultExecutionJournalOptions) {
    this.idFactory = options.idFactory;
    this.clock = options.clock;
  }

  async logProposal(
    proposal: ActionProposal,
    isDestructiveOverride?: boolean,
  ): Promise<ExecutionId> {
    const executionId: ExecutionId = (proposal.id as any) ?? this.idFactory.create<'Execution'>();
    const now = this.clock.now();

    const isDestructive =
      isDestructiveOverride ??
      (proposal.type === ActionType.FILE_DELETE ||
        proposal.irreversible ||
        proposal.description.toLowerCase().includes('rm ') ||
        proposal.description.toLowerCase().includes('delete') ||
        proposal.description.toLowerCase().includes('drop') ||
        proposal.description.toLowerCase().includes('format'));

    const entry: JournalEntry = {
      executionId,
      taskId: proposal.taskId,
      iteration: 0,
      actionProposal: proposal,
      status: ActionExecutionStatus.PROPOSED,
      isDestructive,
      startedAt: now,
    };

    this.entries.set(executionId, entry);
    return executionId;
  }

  async logAuthorization(executionId: ExecutionId): Promise<void> {
    const entry = this.entries.get(executionId);
    if (entry) {
      this.entries.set(executionId, {
        ...entry,
        status: ActionExecutionStatus.AUTHORIZED,
        authorizedAt: this.clock.now(),
      });
    }
  }

  async logStart(executionId: ExecutionId): Promise<void> {
    const entry = this.entries.get(executionId);
    if (entry) {
      this.entries.set(executionId, {
        ...entry,
        status: ActionExecutionStatus.STARTED,
      });
    }
  }

  async logCompletion(executionId: ExecutionId, result?: ActionResult): Promise<void> {
    const entry = this.entries.get(executionId);
    if (entry) {
      this.entries.set(executionId, {
        ...entry,
        status: ActionExecutionStatus.COMPLETED,
        completedAt: this.clock.now(),
        result,
      });
    }
  }

  async logFailure(executionId: ExecutionId, error: string): Promise<void> {
    const entry = this.entries.get(executionId);
    if (entry) {
      this.entries.set(executionId, {
        ...entry,
        status: ActionExecutionStatus.FAILED,
        completedAt: this.clock.now(),
        error,
      });
    }
  }

  async logUnknown(executionId: ExecutionId, reason: string): Promise<void> {
    const entry = this.entries.get(executionId);
    if (entry) {
      this.entries.set(executionId, {
        ...entry,
        status: ActionExecutionStatus.UNKNOWN,
        unknownReason: reason,
      });
    }
  }

  async getEntry(executionId: ExecutionId): Promise<JournalEntry | undefined> {
    return this.entries.get(executionId);
  }

  async getInterruptedEntries(taskId: TaskId): Promise<ReadonlyArray<JournalEntry>> {
    const taskEntries = await this.listForTask(taskId);
    return taskEntries.filter(
      (e) =>
        e.status === ActionExecutionStatus.PROPOSED ||
        e.status === ActionExecutionStatus.AUTHORIZED ||
        e.status === ActionExecutionStatus.STARTED ||
        e.status === ActionExecutionStatus.UNKNOWN,
    );
  }

  async listForTask(taskId: TaskId): Promise<ReadonlyArray<JournalEntry>> {
    return Array.from(this.entries.values()).filter((e) => e.taskId === taskId);
  }
}
