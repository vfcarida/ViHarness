/**
 * Iteration Executor.
 *
 * "The model proposes; the runtime decides."
 *
 * Executes a single pass through the stateful, evidence-driven agent cycle:
 * OBSERVE -> CONTEXT -> MODEL -> PROPOSE -> POLICY -> ACT -> OBSERVE RESULT -> VERIFY -> EVIDENCE -> STATE -> NEXT ITERATION
 *
 * Explicit Iteration Phases:
 * 1. Observation (durable state, prior iteration outcomes, prior evidence)
 * 2. Context Compilation (model-aware context including prior tool results & structured errors)
 * 3. Model Decision (routing and completion execution)
 * 4. Action Proposals (parsing single or multiple tool calls)
 * 5. Policy Decisions (Deny-First security evaluation)
 * 6. Tool Executions (safe parallel, mutating serial execution with structured error formatting)
 * 7. Verification Results (running actual verification checks — no synthetic pass)
 * 8. Evidence (recording evidence in EvidenceStore)
 * 9. State Transition (derived strictly from actual evidence & tool results)
 * 10. Termination Decision (evaluating stop conditions & trajectory metrics)
 */
import type {
  IdFactory,
  ExecutionId,
  TaskId,
  HypothesisId,
  EvidenceId,
} from '../core/types/identifiers.js';
import type { Clock } from '../core/interfaces/clock.js';
import type { ModelRouter } from '../core/interfaces/model-router.js';
import type { ContextCompiler } from '../core/interfaces/context-compiler.js';
import type { PolicyEngine } from '../core/interfaces/policy-engine.js';
import type { ToolExecutor } from '../core/interfaces/tool-executor.js';
import type { VerificationEngine } from '../core/interfaces/verification-engine.js';
import type { EvidenceStore } from '../core/interfaces/evidence-store.js';
import type { Goal } from '../core/model/goal.js';
import type { Task } from '../core/model/task.js';
import type { StateMachine } from '../core/state-machine/state-machine.js';
import type {
  IterationRecord,
  ExecutionOptions,
  IterationPhases,
  PolicyDecisionRecord,
} from '../core/model/runtime-types.js';
import { AgentEventType } from '../core/model/runtime-types.js';
import type { AgentObserverHub } from './agent-observer.js';
import { ActionPlanner } from './action-planner.js';
import { TerminationController } from './termination-controller.js';
import { ToolCallValidator } from './tool-call-validator.js';
import { ProviderMessageAdapter } from '../infra/model/provider-message-adapter.js';
import { executeResiliently } from '../infra/model/provider-resilience.js';
import { StateEvent, AgentPhase } from '../core/model/state.js';
import { TaskCategory } from '../core/model/router-types.js';
import type { Evidence } from '../core/model/evidence.js';
import { EvidenceType, EvidenceOutcome } from '../core/model/evidence.js';
import type { ActionResult, ActionProposal } from '../core/model/action.js';
import { ActionResultStatus, ActionType } from '../core/model/action.js';
import type { ModelRequest, ModelResponse, ModelMessage } from '../core/model/model-io.js';
import { MessageRole, FinishReason } from '../core/model/model-io.js';
import { PolicyDecisionType } from '../core/model/policy.js';
import type { Iteration } from '../core/model/iteration.js';
import { IterationOutcome } from '../core/model/iteration.js';
import { ContextTier } from '../core/model/context.js';
import type { ContextObject } from '../core/model/context-object.js';
import {
  VerificationProfile,
  VerificationStatus,
  type VerificationResult,
} from '../core/model/verification.js';
import { PreStepPipeline } from './pre-step-pipeline.js';
import { ArchitectExecutor, type ArchitectExecutionResult } from './architect-executor.js';

export interface IterationExecutorParams {
  readonly executionId: ExecutionId;
  readonly goal: Goal;
  readonly task: Task;
  readonly stateMachine: StateMachine;
  readonly router: ModelRouter;
  readonly compiler: ContextCompiler;
  readonly policyEngine?: PolicyEngine;
  readonly toolExecutor?: ToolExecutor;
  readonly verificationEngine?: VerificationEngine;
  readonly evidenceStore?: EvidenceStore;
  readonly observerHub: AgentObserverHub;
  readonly idFactory: IdFactory;
  readonly clock: Clock;
  readonly options?: ExecutionOptions;
  readonly iterationsSoFar: ReadonlyArray<IterationRecord>;
  readonly startTimeMs: number;
  readonly totalCostDollars: number;
}

export class IterationExecutor {
  static async executeIteration(params: IterationExecutorParams): Promise<IterationRecord> {
    const {
      executionId,
      goal,
      task,
      stateMachine,
      router,
      compiler,
      evidenceStore,
      observerHub,
      idFactory,
      clock,
      options,
      iterationsSoFar,
      startTimeMs,
      totalCostDollars,
    } = params;

    const iterationId = idFactory.create<'Iteration'>();
    const sequenceNumber = iterationsSoFar.length + 1;
    const iterationStart = clock.now();
    const stateBefore = stateMachine.phase;

    // Emit IterationStarted
    observerHub.emit({
      type: AgentEventType.IterationStarted,
      executionId,
      taskId: task.id,
      timestamp: iterationStart,
      data: { sequenceNumber, stateBefore },
    });

    // -----------------------------------------------------------------------
    // PHASE 1: OBSERVATION
    // -----------------------------------------------------------------------
    const currentState = stateMachine.state;
    const recentEvidence = await evidenceStore?.listForTask(task.id);
    const priorToolResultsCount = iterationsSoFar.reduce((acc, r) => acc + r.toolResults.length, 0);
    const priorEvidenceCount = iterationsSoFar.reduce(
      (acc, r) => acc + r.evidenceCreated.length,
      0,
    );

    // -----------------------------------------------------------------------
    // PHASE 2: CONTEXT COMPILATION
    // -----------------------------------------------------------------------
    const initialObjects = options?.relevantObjects ?? [];
    const estimatedContextTokens =
      initialObjects.reduce((acc: number, o: ContextObject) => acc + o.costTokens, 0) +
      Math.ceil((goal.description.length + task.description.length) / 4) +
      (recentEvidence
        ? recentEvidence.reduce(
            (acc: number, e: Evidence) => acc + Math.ceil(e.summary.length / 4),
            0,
          )
        : 0);
    const targetRole =
      options?.targetRole ??
      (currentState.phase === AgentPhase.PLAN
        ? 'ARCHITECT'
        : currentState.phase === AgentPhase.IMPLEMENT || currentState.phase === AgentPhase.REPAIR
          ? 'EDITOR'
          : undefined);

    const dualModelConfig = options?.dualModelConfig ?? (goal.metadata?.['dualModelConfig'] as any);

    const taskCategory =
      options?.taskCategory ??
      (currentState.phase === AgentPhase.PLAN ? TaskCategory.ARCHITECTURE : TaskCategory.CODE_GEN);

    const contextTokenCount = Math.max(1000, estimatedContextTokens);

    const routingDecision = await router.route({
      taskCategory,
      complexity: options?.complexity ?? (targetRole === 'ARCHITECT' ? 'HIGH' : 'MEDIUM'),
      risk: options?.riskLevel ?? 'LOW',
      currentState: currentState.phase,
      targetRole,
      dualModelConfig,
      contextTokenCount,
      remainingBudgetDollars: goal.constraints.maxCostDollars - totalCostDollars,
      iterationCount: sequenceNumber,
    });

    observerHub.emit({
      type: AgentEventType.ModelSelected,
      executionId,
      taskId: task.id,
      timestamp: clock.now(),
      data: {
        providerId: routingDecision.selectedProvider.providerId,
        modelId: routingDecision.selectedModelId,
        rationale: routingDecision.rationale,
      },
    });

    const compilationResult = await compiler.compile({
      goal,
      task,
      currentState,
      targetModelDescriptor: routingDecision.selectedProvider.descriptor,
      budget: {
        maxTokens: Math.min(
          10000,
          routingDecision.selectedProvider.descriptor.capabilities.maxContextTokens,
        ),
        softLimitTokens: 8000,
      },
      relevantObjects: options?.relevantObjects,
      frozenMemoryObjects: options?.frozenMemoryObjects,
    });

    // Construct structured messages for model (including prior tool outputs & evidence)
    const messages: ModelMessage[] = [];

    // Inject mounted skill instructions (from DeepSeek Harness SelfModification)
    if (options?.selfModification) {
      const mountedContent = options.selfModification.getMountedSkillContent();
      if (mountedContent && mountedContent.trim().length > 0) {
        messages.push({
          role: MessageRole.SYSTEM,
          content: `# Active Mounted Skills & Instructions:\n\n${mountedContent}`,
        });
      }
    }

    if (compilationResult.compiledContext.entries.length > 0) {
      for (const entry of compilationResult.compiledContext.entries) {
        const roleStr = String(entry.metadata['role'] ?? '');
        const role =
          roleStr === 'system' || entry.tier === ContextTier.L3_REPOSITORY
            ? MessageRole.SYSTEM
            : roleStr === 'assistant'
              ? MessageRole.ASSISTANT
              : roleStr === 'tool'
                ? MessageRole.TOOL
                : MessageRole.USER;

        messages.push({
          role,
          content: entry.content,
          toolCallId: entry.metadata['toolCallId']
            ? String(entry.metadata['toolCallId'])
            : undefined,
          name: entry.metadata['toolName'] ? String(entry.metadata['toolName']) : undefined,
        });
      }
    } else {
      messages.push({
        role: MessageRole.USER,
        content: `Goal: ${goal.description}\nTask: ${task.description}`,
      });
    }

    // Append prior iteration assistant tool calls, tool results & evidence as structured messages
    for (const priorIter of iterationsSoFar) {
      if (priorIter.actionProposals && priorIter.actionProposals.length > 0) {
        const priorToolCalls = priorIter.actionProposals
          .filter((p) => p.type !== ActionType.MODEL_CALL)
          .map((p) => ({
            id: String(p.parameters['toolCallId'] ?? p.id),
            name: String(p.parameters['toolName'] ?? extractToolName(p)),
            input: (p.parameters['input'] as Record<string, unknown>) ?? p.parameters,
          }));

        if (priorToolCalls.length > 0) {
          messages.push(ProviderMessageAdapter.createToolCallMessage(priorToolCalls));
        }
      }

      for (const res of priorIter.toolResults) {
        const toolCallId = String(res.metadata['toolCallId'] ?? res.actionId);
        const toolName = String(res.metadata['toolName'] ?? 'tool');
        const isError =
          res.status === ActionResultStatus.FAILURE || res.status === ActionResultStatus.DENIED;
        messages.push(
          ProviderMessageAdapter.createToolResultMessage({
            toolCallId,
            name: toolName,
            output: res.output || (res.error ? res.error : 'Execution finished'),
            isError,
          }),
        );
      }
      for (const ev of priorIter.evidenceCreated) {
        messages.push({
          role: MessageRole.SYSTEM,
          content: `[VERIFICATION_EVIDENCE] Check: ${ev.checkId ?? ev.id}, Outcome: ${ev.outcome}, Pass: ${ev.pass}, Summary: ${ev.summary}`,
        });
      }
    }

    // -----------------------------------------------------------------------
    // PHASE 3: MODEL DECISION (PRE-STEP WATERFALL & ARCHITECT/EDITOR DUAL-MODEL)
    // -----------------------------------------------------------------------
    let stepMessages: ReadonlyArray<ModelMessage> = messages;
    let isPreStepRejected = false;
    let preStepRejectReason: string | undefined;

    if (options?.preStepInterceptors && options.preStepInterceptors.length > 0) {
      const preStepDecision = await PreStepPipeline.runWaterfall(options.preStepInterceptors, {
        messages,
        turn: sequenceNumber,
        step: sequenceNumber,
        signal: options.signal,
        metadata: { taskId: task.id, goalId: goal.id, phase: currentState.phase },
      });

      if (preStepDecision.kind === 'reject') {
        isPreStepRejected = true;
        preStepRejectReason = preStepDecision.reason ?? 'Step rejected by pre-step interceptor';
      } else {
        stepMessages = preStepDecision.messages;
      }
    }

    let modelResponse: ModelResponse;
    let architectExecutionData: ArchitectExecutionResult | undefined;

    const evidenceCreated: Evidence[] = [];

    if (isPreStepRejected) {
      modelResponse = {
        requestId: idFactory.create<'Evidence'>(),
        modelId: routingDecision.selectedModelId,
        providerId: routingDecision.selectedProvider.providerId,
        content: `[REJECTED] ${preStepRejectReason}`,
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: FinishReason.STOP,
        latencyMs: 0,
        estimatedCostDollars: 0,
      };

      const rejectEv: Evidence = {
        id: idFactory.create<'Evidence'>(),
        taskId: task.id,
        type: EvidenceType.RUNTIME_OUTPUT,
        outcome: EvidenceOutcome.FAIL,
        summary: `PRE_STEP_REJECTED: ${preStepRejectReason}`,
        data: { reason: preStepRejectReason },
        createdAt: clock.now(),
        pass: false,
        confidence: 1.0,
        affectedFiles: [],
      };
      evidenceCreated.push(rejectEv);
      if (evidenceStore) {
        await evidenceStore.record(rejectEv);
      }
      observerHub.emit({
        type: AgentEventType.EvidenceCreated,
        executionId,
        taskId: task.id,
        timestamp: clock.now(),
        data: { evidence: rejectEv },
      });
    } else if (options?.architectMode) {
      const toolDefs = params.toolExecutor?.listTools().map((t) => t.definition);
      architectExecutionData = await ArchitectExecutor.executePlanAndExecute({
        goal,
        task,
        messages: stepMessages,
        router,
        tools: toolDefs,
        dualModelConfig,
        signal: options?.signal,
        executionId,
        observerHub,
        clock,
        contextTokenCount,
        remainingBudgetDollars: goal.constraints.maxCostDollars - totalCostDollars,
        currentState: currentState.phase,
      });

      modelResponse = architectExecutionData.combinedResponse;
    } else {
      const toolDefs = params.toolExecutor?.listTools().map((t) => t.definition);
      const modelRequest: ModelRequest = {
        modelId: routingDecision.selectedModelId,
        messages: stepMessages,
        tools: toolDefs,
        signal: options?.signal,
      };

      modelResponse = await executeResiliently(routingDecision.selectedProvider, modelRequest, {
        maxRetries: 2,
        defaultTimeoutMs: 15000,
      });
    }

    observerHub.emit({
      type: AgentEventType.ModelCalled,
      executionId,
      taskId: task.id,
      timestamp: clock.now(),
      data: {
        tokens: modelResponse.usage,
        latencyMs: modelResponse.latencyMs,
        costDollars: modelResponse.estimatedCostDollars,
        isArchitectMode: Boolean(options?.architectMode),
        ...(architectExecutionData
          ? {
              architectCostDollars: architectExecutionData.architect.costDollars,
              editorCostDollars: architectExecutionData.editor.costDollars,
              architectTokens: architectExecutionData.architect.usage,
              editorTokens: architectExecutionData.editor.usage,
              plan: architectExecutionData.plan,
            }
          : {}),
      },
    });

    // -----------------------------------------------------------------------
    // PHASE 4: ACTION PROPOSALS (MULTIPLE TOOL CALL SUPPORT)
    // -----------------------------------------------------------------------
    const actionProposals = ActionPlanner.parseProposals(
      modelResponse,
      task.id,
      iterationId,
      idFactory,
      params.toolExecutor as any,
    );

    const isStoppingWithoutTools =
      modelResponse.finishReason === FinishReason.STOP &&
      (!modelResponse.toolCalls || modelResponse.toolCalls.length === 0);

    for (const proposal of actionProposals) {
      observerHub.emit({
        type: AgentEventType.ActionProposed,
        executionId,
        taskId: task.id,
        timestamp: clock.now(),
        data: { action: proposal },
      });
    }

    // -----------------------------------------------------------------------
    // PHASE 5 & 6: POLICY DECISIONS & TOOL EXECUTIONS (ACT)
    // -----------------------------------------------------------------------
    const policyDecisions: PolicyDecisionRecord[] = [];
    const toolResults: ActionResult[] = [];

    if (actionProposals.length > 0 && params.toolExecutor) {
      const safeProposals: { proposal: ActionProposal; index: number }[] = [];
      const mutatingProposals: { proposal: ActionProposal; index: number }[] = [];

      for (let i = 0; i < actionProposals.length; i++) {
        const prop = actionProposals[i]!;
        if (prop.type === ActionType.MODEL_CALL) continue;

        const toolName = extractToolName(prop);
        const tool = params.toolExecutor.getTool(toolName);

        if (tool && !tool.definition.mutating) {
          safeProposals.push({ proposal: prop, index: i });
        } else {
          mutatingProposals.push({ proposal: prop, index: i });
        }
      }

      const proposalResults: ActionResult[] = new Array(actionProposals.length);

      // Execute safe read-only tools concurrently
      await Promise.all(
        safeProposals.map(async ({ proposal, index }) => {
          const res = await executeSingleProposalWithPolicy(
            proposal,
            params,
            clock,
            policyDecisions,
          );
          proposalResults[index] = res;
        }),
      );

      // Execute mutating tools serially in sequence
      for (const { proposal, index } of mutatingProposals) {
        const res = await executeSingleProposalWithPolicy(proposal, params, clock, policyDecisions);
        proposalResults[index] = res;
      }

      for (const res of proposalResults) {
        if (res) {
          toolResults.push(res);
          observerHub.emit({
            type: AgentEventType.ToolCompleted,
            executionId,
            taskId: task.id,
            timestamp: clock.now(),
            data: { result: res },
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // PHASE 7 & 8: OBSERVE RESULT, VERIFICATION & EVIDENCE RECORDING
    // -----------------------------------------------------------------------
    const now = clock.now();
    const hasFailingTool = toolResults.some(
      (t) => t.status === ActionResultStatus.FAILURE || t.status === ActionResultStatus.DENIED,
    );

    // Record explicit failure evidence for any tool call that failed (e.g. UNKNOWN_TOOL, POLICY_DENIED, etc.)
    for (const res of toolResults) {
      if (
        res.status === ActionResultStatus.FAILURE ||
        res.status === ActionResultStatus.DENIED ||
        res.metadata?.['errorCode'] === 'UNKNOWN_TOOL'
      ) {
        const isUnknownTool = res.metadata?.['errorCode'] === 'UNKNOWN_TOOL';
        const isPolicyDenied =
          res.metadata?.['errorCode'] === 'POLICY_DENIED' ||
          res.status === ActionResultStatus.DENIED;
        const evSummary = isUnknownTool
          ? `UNKNOWN_TOOL: Tool [${res.metadata?.['toolName'] ?? 'unknown'}] is not registered in ToolRegistry`
          : isPolicyDenied
            ? `POLICY_DENIED: Action on [${res.metadata?.['toolName'] ?? 'tool'}] blocked by security policy`
            : `TOOL_FAILURE: Execution failed for tool [${res.metadata?.['toolName'] ?? 'tool'}]: ${res.error ?? 'error'}`;

        const ev: Evidence = {
          id: idFactory.create<'Evidence'>(),
          taskId: task.id,
          type: EvidenceType.RUNTIME_OUTPUT,
          outcome: EvidenceOutcome.FAIL,
          summary: evSummary,
          data: {
            errorCode: res.metadata?.['errorCode'] ?? 'TOOL_EXECUTION_FAILED',
            actionId: res.actionId,
            error: res.error,
          },
          createdAt: now,
          pass: false,
          confidence: 0.0,
          affectedFiles: [],
        };
        evidenceCreated.push(ev);
        if (params.evidenceStore) {
          await params.evidenceStore.record(ev);
        }
        observerHub.emit({
          type: AgentEventType.EvidenceCreated,
          executionId,
          taskId: task.id,
          timestamp: now,
          data: { evidence: ev },
        });
      }
    }

    // Auto-Lint / Auto-Test Feedback Loop (Aider-style automatic verification after write)
    for (const res of toolResults) {
      if (res.status === ActionResultStatus.SUCCESS) {
        const toolName = String(res.metadata?.['toolName'] ?? '').toLowerCase();
        const writtenFilePath = String(
          res.metadata?.['path'] ??
            res.metadata?.['filePath'] ??
            res.metadata?.['targetFile'] ??
            '',
        );

        const isWriteAction =
          toolName === 'write_file' ||
          toolName === 'edit_file' ||
          toolName === 'apply_patch' ||
          toolName.includes('write') ||
          toolName.includes('edit');

        if (isWriteAction && writtenFilePath && params.verificationEngine) {
          const maxAutoCorrections = options?.maxAutoCorrectionsPerFile ?? 2;

          // Count previous auto-correction failures for this file in prior iterations
          let priorCorrectionsForFile = 0;
          for (const iter of iterationsSoFar) {
            for (const ev of iter.evidenceCreated) {
              if (
                ev.affectedFiles.includes(writtenFilePath) &&
                (ev.summary.includes('[AUTO-LINT FAILURE]') ||
                  ev.summary.includes('[AUTO-TEST FAILURE]'))
              ) {
                priorCorrectionsForFile++;
              }
            }
          }

          if (priorCorrectionsForFile < maxAutoCorrections) {
            // 1. Auto-Lint Check
            if (options?.autoLintAfterWrite) {
              try {
                const lintResult = await params.verificationEngine.verify(
                  { type: 'lint', path: writtenFilePath, taskId: task.id },
                  VerificationProfile.FAST,
                );
                if (lintResult.status === VerificationStatus.FAILED) {
                  const ev: Evidence = {
                    id: idFactory.create<'Evidence'>(),
                    taskId: task.id,
                    type: EvidenceType.LINT_RESULT,
                    outcome: EvidenceOutcome.FAIL,
                    summary: `[AUTO-LINT FAILURE] in ${writtenFilePath}: ${lintResult.summary}`,
                    data: {
                      file: writtenFilePath,
                      lintResult,
                      retryCount: priorCorrectionsForFile + 1,
                    },
                    createdAt: now,
                    pass: false,
                    confidence: 0.95,
                    affectedFiles: [writtenFilePath],
                  };
                  evidenceCreated.push(ev);
                  if (params.evidenceStore) {
                    await params.evidenceStore.record(ev);
                  }
                  observerHub.emit({
                    type: AgentEventType.EvidenceCreated,
                    executionId,
                    taskId: task.id,
                    timestamp: now,
                    data: { evidence: ev },
                  });
                }
              } catch {
                // Ignore verification invocation failure
              }
            }

            // 2. Auto-Test Check (Impacted Tests)
            if (options?.autoTestAfterWrite) {
              try {
                const testResult = await params.verificationEngine.verify(
                  { type: 'test-impacted', path: writtenFilePath, taskId: task.id },
                  VerificationProfile.FAST,
                );
                if (testResult.status === VerificationStatus.FAILED) {
                  const ev: Evidence = {
                    id: idFactory.create<'Evidence'>(),
                    taskId: task.id,
                    type: EvidenceType.TEST_RESULT,
                    outcome: EvidenceOutcome.FAIL,
                    summary: `[AUTO-TEST FAILURE] in ${writtenFilePath}: ${testResult.summary}`,
                    data: {
                      file: writtenFilePath,
                      testResult,
                      retryCount: priorCorrectionsForFile + 1,
                    },
                    createdAt: now,
                    pass: false,
                    confidence: 0.95,
                    affectedFiles: [writtenFilePath],
                  };
                  evidenceCreated.push(ev);
                  if (params.evidenceStore) {
                    await params.evidenceStore.record(ev);
                  }
                  observerHub.emit({
                    type: AgentEventType.EvidenceCreated,
                    executionId,
                    taskId: task.id,
                    timestamp: now,
                    data: { evidence: ev },
                  });
                }
              } catch {
                // Ignore verification invocation failure
              }
            }
          }
        }
      }
    }

    const hasTestRunAction = actionProposals.some((p) => {
      if (p.type === ActionType.TEST_RUN) return true;
      const desc = p.description.toLowerCase();
      const cmd = String(
        p.parameters['cmd'] ?? p.parameters['command'] ?? p.parameters['input'] ?? '',
      ).toLowerCase();
      return desc.includes('test') || cmd.includes('test');
    });

    if (params.verificationEngine) {
      if (
        currentState.phase === AgentPhase.VERIFY ||
        hasTestRunAction ||
        (currentState.phase === AgentPhase.REPAIR && (isStoppingWithoutTools || hasTestRunAction))
      ) {
        let vResult: VerificationResult;
        try {
          vResult = await params.verificationEngine.verify({
            type: 'test-suite',
            content: task.description,
          });
        } catch (err: any) {
          vResult = {
            status: VerificationStatus.INCONCLUSIVE,
            summary: `Verification execution failed: ${err?.message ?? String(err)}`,
            evidenceIds: [],
            taskId: task.id,
            verifiedAt: now,
            suiteId: 'error-suite',
            durationMs: 0,
            confidence: 0.0,
            scope: 'repository',
            affectedFiles: [],
            checkExecutions: [],
          };
        }

        const isPassed = vResult.status === VerificationStatus.PASSED;
        const isInconclusive = vResult.status === VerificationStatus.INCONCLUSIVE;

        const ev: Evidence = {
          id: idFactory.create<'Evidence'>(),
          taskId: task.id,
          type: EvidenceType.TEST_RESULT,
          outcome: isPassed
            ? EvidenceOutcome.PASS
            : isInconclusive
              ? EvidenceOutcome.INCONCLUSIVE
              : EvidenceOutcome.FAIL,
          summary:
            vResult.summary ??
            (isPassed ? 'Verification Suite Passed' : 'Verification Suite Failed'),
          data: { status: vResult.status },
          createdAt: now,
          pass: isPassed,
          confidence: vResult.confidence ?? (isPassed ? 0.95 : 0.0),
          affectedFiles: vResult.affectedFiles ?? [],
        };

        evidenceCreated.push(ev);
        if (params.evidenceStore) {
          await params.evidenceStore.record(ev);
        }

        observerHub.emit({
          type: AgentEventType.EvidenceCreated,
          executionId,
          taskId: task.id,
          timestamp: now,
          data: { evidence: ev },
        });
      }
    } else if (goal.constraints.requireVerification) {
      // Missing verification MUST NOT become PASS when verification IS required. Synthetic success prohibited.
      const ev: Evidence = {
        id: idFactory.create<'Evidence'>(),
        taskId: task.id,
        type: EvidenceType.VERIFICATION,
        outcome: EvidenceOutcome.INCONCLUSIVE,
        summary: 'VERIFICATION_UNAVAILABLE: Verification engine not configured',
        data: { status: 'UNAVAILABLE' },
        createdAt: now,
        pass: false,
        confidence: 0.0,
        affectedFiles: [],
      };
      evidenceCreated.push(ev);
      if (params.evidenceStore) {
        await params.evidenceStore.record(ev);
      }

      observerHub.emit({
        type: AgentEventType.EvidenceCreated,
        executionId,
        taskId: task.id,
        timestamp: now,
        data: { evidence: ev },
      });
    } else if (isStoppingWithoutTools && !hasFailingTool) {
      const ev: Evidence = {
        id: idFactory.create<'Evidence'>(),
        taskId: task.id,
        type: EvidenceType.RUNTIME_OUTPUT,
        outcome: EvidenceOutcome.PASS,
        summary: 'TASK_COMPLETION: Task execution completed without verification requirement',
        data: { status: 'COMPLETED' },
        createdAt: now,
        pass: true,
        confidence: 0.95,
        affectedFiles: [],
      };
      evidenceCreated.push(ev);
      if (params.evidenceStore) {
        await params.evidenceStore.record(ev);
      }

      observerHub.emit({
        type: AgentEventType.EvidenceCreated,
        executionId,
        taskId: task.id,
        timestamp: now,
        data: { evidence: ev },
      });
    }

    // -----------------------------------------------------------------------
    // PHASE 9: DERIVED STATE TRANSITION (STRICT RESULTS-BASED)
    // -----------------------------------------------------------------------
    const hasFailingEvidence = evidenceCreated.some(
      (e) => !e.pass && e.outcome === EvidenceOutcome.FAIL,
    );
    const hasInconclusiveEvidence = evidenceCreated.some(
      (e) => e.outcome === EvidenceOutcome.INCONCLUSIVE,
    );
    const hasPassedEvidence = evidenceCreated.some(
      (e) => e.pass && e.outcome === EvidenceOutcome.PASS,
    );

    const hasFileWriteAction = actionProposals.some((p) => {
      if (p.type === ActionType.FILE_WRITE || p.type === ActionType.FILE_DELETE) return true;
      const toolName = extractToolName(p);
      return (
        toolName === 'write_file' ||
        toolName === 'edit_file' ||
        toolName === 'apply_patch' ||
        toolName.includes('write') ||
        toolName.includes('edit') ||
        toolName.includes('patch')
      );
    });

    let nextEvent: StateEvent | null = null;

    if (stateBefore === AgentPhase.INIT) {
      nextEvent = StateEvent.START;
    } else if (stateBefore === AgentPhase.EXPLORE) {
      if (hasFailingTool) {
        // Tool failed (e.g. unknown tool) -> remain in EXPLORE to allow recovery without advancing phase
        nextEvent = null;
      } else if (hasFileWriteAction) {
        nextEvent = StateEvent.PLAN_READY; // directly start implementing
      } else if (hasTestRunAction || isStoppingWithoutTools) {
        nextEvent = StateEvent.EXPLORE_COMPLETE;
      } else {
        // Continue exploration (e.g. read_file, search, inspect)
        nextEvent = null;
      }
    } else if (stateBefore === AgentPhase.PLAN) {
      if (hasFailingTool) {
        nextEvent = null;
      } else if (hasFileWriteAction || isStoppingWithoutTools) {
        nextEvent = StateEvent.PLAN_READY;
      } else {
        nextEvent = null;
      }
    } else if (stateBefore === AgentPhase.IMPLEMENT) {
      if (hasFailingTool) {
        nextEvent = null;
      } else if (hasTestRunAction || isStoppingWithoutTools) {
        nextEvent = StateEvent.IMPLEMENTATION_COMPLETE;
      } else {
        // Still implementing / editing files
        nextEvent = null;
      }
    } else if (stateBefore === AgentPhase.VERIFY) {
      if (hasPassedEvidence && !hasFailingEvidence && !hasInconclusiveEvidence) {
        nextEvent = StateEvent.VERIFICATION_PASSED;
      } else if (hasFailingEvidence || hasInconclusiveEvidence) {
        nextEvent = StateEvent.VERIFICATION_FAILED;
      } else {
        nextEvent = null;
      }
    } else if (stateBefore === AgentPhase.REPAIR) {
      if (hasPassedEvidence && !hasFailingEvidence && !hasInconclusiveEvidence) {
        nextEvent = StateEvent.REPAIR_COMPLETE;
      } else if (hasFailingEvidence || hasInconclusiveEvidence) {
        const maxRepairs = goal.constraints.maxRepairAttempts ?? 3;
        if (stateMachine.state.repairCount >= maxRepairs) {
          nextEvent = StateEvent.MAX_REPAIRS_EXCEEDED;
        } else if (isStoppingWithoutTools || hasTestRunAction) {
          nextEvent = StateEvent.REPAIR_COMPLETE;
        } else {
          nextEvent = null;
        }
      } else {
        // Still inspecting or writing fixes
        nextEvent = null;
      }
    }

    if (nextEvent && stateMachine.phase !== AgentPhase.DONE && !stateMachine.isTerminal) {
      try {
        const validEvidenceIds = evidenceCreated.filter((e) => e.pass).map((e) => e.id);
        stateMachine.apply(nextEvent, {
          evidenceIds: validEvidenceIds.length > 0 ? validEvidenceIds : undefined,
        });

        // Cascade transition to DONE if verification passed or non-verification task is completed
        if (
          !goal.constraints.requireVerification &&
          isStoppingWithoutTools &&
          !hasFailingTool &&
          !hasFailingEvidence &&
          !hasInconclusiveEvidence
        ) {
          while (
            (stateMachine.phase as AgentPhase) !== AgentPhase.DONE &&
            !stateMachine.isTerminal
          ) {
            const currentPhase = stateMachine.phase as AgentPhase;
            if (currentPhase === AgentPhase.EXPLORE) {
              stateMachine.apply(StateEvent.EXPLORE_COMPLETE);
            } else if (currentPhase === AgentPhase.PLAN) {
              stateMachine.apply(StateEvent.PLAN_READY);
            } else if (currentPhase === AgentPhase.IMPLEMENT) {
              stateMachine.apply(StateEvent.IMPLEMENTATION_COMPLETE);
            } else if (currentPhase === AgentPhase.VERIFY) {
              const doneEvidenceId = validEvidenceIds[0] ?? (evidenceCreated[0]?.id as EvidenceId);
              if (doneEvidenceId) {
                stateMachine.apply(StateEvent.MARK_DONE, { evidenceIds: [doneEvidenceId] });
              } else {
                break;
              }
            } else {
              break;
            }
          }
        } else if (
          (stateMachine.phase as AgentPhase) === AgentPhase.VERIFY &&
          evidenceCreated.length > 0
        ) {
          if (hasPassedEvidence && !hasFailingEvidence && !hasInconclusiveEvidence) {
            const passedEvIds = evidenceCreated.filter((e) => e.pass).map((e) => e.id);
            if (passedEvIds.length > 0) {
              stateMachine.apply(StateEvent.VERIFICATION_PASSED, {
                evidenceIds: passedEvIds,
              });
            }
          } else if (hasFailingEvidence || hasInconclusiveEvidence) {
            stateMachine.apply(StateEvent.VERIFICATION_FAILED, {
              evidenceIds: evidenceCreated.map((e) => e.id),
            });
          }
        }
      } catch {
        if (
          stateMachine.phase === AgentPhase.REPAIR &&
          (hasFailingEvidence || hasInconclusiveEvidence)
        ) {
          try {
            stateMachine.apply(StateEvent.ESCALATE);
          } catch {
            // Ignore if escalation not possible
          }
        }
      }
    }

    const stateAfter = stateMachine.phase;

    observerHub.emit({
      type: AgentEventType.StateUpdated,
      executionId,
      taskId: task.id,
      timestamp: clock.now(),
      data: { from: stateBefore, to: stateAfter, event: nextEvent },
    });

    // -----------------------------------------------------------------------
    // PHASE 10: TERMINATION DECISION
    // -----------------------------------------------------------------------
    const elapsedMs = clock.now().getTime() - startTimeMs;
    const currentCost = totalCostDollars + modelResponse.estimatedCostDollars;
    const failingEvidenceIds = evidenceCreated.filter((e) => !e.pass).map((e) => e.id);

    const iterationOutcome =
      hasFailingEvidence || hasFailingTool
        ? IterationOutcome.VERIFICATION_FAILED
        : hasPassedEvidence
          ? IterationOutcome.VERIFICATION_PASSED
          : IterationOutcome.PROGRESS;

    const iterationModels: Iteration[] = iterationsSoFar.map(
      (rec) => rec.iterationModel ?? buildIterationDomainModel(rec, task.id),
    );

    const filesModified = toolResults
      .map((r) => String(r.metadata['path'] ?? ''))
      .filter((p) => p.length > 0);

    const failingTool = toolResults.find(
      (r) => r.status === ActionResultStatus.FAILURE || r.status === ActionResultStatus.DENIED,
    );
    const toolFailureSignature = failingTool
      ? `${failingTool.metadata['toolName'] ?? 'tool'}:${failingTool.metadata['errorCode'] ?? failingTool.status}`
      : null;

    const currentIterationModel: Iteration = {
      id: iterationId,
      taskId: task.id,
      sequenceNumber,
      outcome: iterationOutcome,
      fingerprint: {
        filesModified,
        hypothesisId: actionProposals[0]?.id
          ? (actionProposals[0].id as unknown as HypothesisId)
          : null,
        errorSignature: hasFailingEvidence ? `ERR_VERIFICATION_SEQ_${sequenceNumber}` : null,
        patchSignature:
          filesModified.length > 0 ? `patch-${filesModified.join(',')}-${sequenceNumber}` : null,
        failingTests: failingEvidenceIds,
        phaseAtStart: stateBefore,
        stateTrajectory: stateBefore === stateAfter ? [stateBefore] : [stateBefore, stateAfter],
        toolFailureSignature,
      },
      evidenceIds: evidenceCreated.map((e) => e.id),
      actionIds: actionProposals.map((a) => a.id),
      startedAt: iterationStart,
      completedAt: clock.now(),
      durationMs: clock.now().getTime() - iterationStart.getTime(),
      costDollars: modelResponse.estimatedCostDollars,
      metadata: {},
    };

    const terminationDecision = TerminationController.evaluate({
      state: stateMachine.state,
      constraints: goal.constraints,
      iterations: [...iterationModels, currentIterationModel],
      transitions: stateMachine.history,
      elapsedMs,
      totalCostDollars: currentCost,
    });

    const iterationEnd = clock.now();

    const phases: IterationPhases = {
      observation: {
        stateBefore,
        sequenceNumber,
        priorToolResultsCount,
        priorEvidenceCount,
      },
      context: {
        compiledTokens:
          compilationResult.metrics.tokensAfter ??
          compilationResult.compiledContext.totalTokenEstimate,
        entriesCount: compilationResult.compiledContext.entries.length,
      },
      modelDecision: {
        providerId: routingDecision.selectedProvider.providerId,
        modelId: routingDecision.selectedModelId,
        usage: modelResponse.usage,
        latencyMs: modelResponse.latencyMs,
        isArchitectMode: Boolean(options?.architectMode),
        architect: architectExecutionData
          ? {
              providerId: architectExecutionData.architect.providerId,
              modelId: architectExecutionData.architect.modelId,
              usage: architectExecutionData.architect.usage,
              latencyMs: architectExecutionData.architect.latencyMs,
              costDollars: architectExecutionData.architect.costDollars,
              plan: architectExecutionData.plan,
            }
          : undefined,
        editor: architectExecutionData
          ? {
              providerId: architectExecutionData.editor.providerId,
              modelId: architectExecutionData.editor.modelId,
              usage: architectExecutionData.editor.usage,
              latencyMs: architectExecutionData.editor.latencyMs,
              costDollars: architectExecutionData.editor.costDollars,
            }
          : undefined,
      },
      actionProposals,
      policyDecisions,
      toolExecutions: toolResults,
      verificationResults: {
        performed: evidenceCreated.length > 0,
        status: evidenceCreated[0]?.outcome,
        summary: evidenceCreated[0]?.summary,
      },
      evidence: evidenceCreated,
      stateTransition: {
        from: stateBefore,
        to: stateAfter,
        event: nextEvent,
      },
      terminationDecision,
    };

    const iterationRecord: IterationRecord = {
      iterationId,
      sequenceNumber,
      startedAt: iterationStart,
      completedAt: iterationEnd,
      stateBefore,
      stateAfter,
      modelId: routingDecision.selectedModelId,
      providerId: routingDecision.selectedProvider.providerId,
      actionProposed: actionProposals[0] ?? null,
      actionProposals,
      toolResults,
      evidenceCreated,
      tokenUsage: modelResponse.usage,
      costDollars: modelResponse.estimatedCostDollars,
      terminationDecision,
      phases,
      iterationModel: currentIterationModel,
      metadata: {
        ...(architectExecutionData
          ? {
              architectMode: true,
              architectPlan: architectExecutionData.plan,
              architectCostDollars: architectExecutionData.architect.costDollars,
              editorCostDollars: architectExecutionData.editor.costDollars,
              architectTokens: architectExecutionData.architect.usage,
              editorTokens: architectExecutionData.editor.usage,
            }
          : {}),
      },
    };

    observerHub.emit({
      type: AgentEventType.IterationCompleted,
      executionId,
      taskId: task.id,
      timestamp: iterationEnd,
      data: { iterationId, sequenceNumber, terminationDecision },
    });

    return iterationRecord;
  }
}

function extractToolName(proposal: ActionProposal): string {
  if (proposal.parameters['toolName']) {
    return String(proposal.parameters['toolName']);
  }
  const match = proposal.description.match(/^Execute tool \[([^\]]+)\]$/);
  if (match && match[1]) {
    return match[1];
  }
  return proposal.description;
}

async function executeSingleProposalWithPolicy(
  proposal: ActionProposal,
  params: IterationExecutorParams,
  clock: Clock,
  policyDecisions: PolicyDecisionRecord[],
): Promise<ActionResult> {
  const toolName = extractToolName(proposal);
  const toolCallId = String(proposal.parameters['toolCallId'] ?? proposal.id);
  const input = (proposal.parameters['input'] as Record<string, unknown>) ?? proposal.parameters;

  const toolRegistryAdapter = params.toolExecutor
    ? {
        getTool: (name: string) => params.toolExecutor?.getTool(name),
        listTools: (cat?: any) => params.toolExecutor?.listTools(cat) ?? [],
        validateInput: (name: string, _inp: Record<string, unknown>) => {
          const t = params.toolExecutor?.getTool(name);
          if (!t)
            return { valid: false, errors: [`Tool [${name}] is not registered in ToolRegistry`] };
          return { valid: true };
        },
      }
    : undefined;

  const validation = ToolCallValidator.validate(
    { id: toolCallId, name: toolName, input },
    toolRegistryAdapter as any,
  );

  if (!validation.valid) {
    const errorPayload = JSON.stringify({
      success: false,
      errorCode: validation.isUnknownTool ? 'UNKNOWN_TOOL' : 'TOOL_INVALID_INPUT',
      message: validation.modelFeedbackMessage ?? validation.error ?? 'Tool execution failed',
    });
    return {
      actionId: proposal.id,
      status: ActionResultStatus.FAILURE,
      output: errorPayload,
      durationMs: 0,
      error: errorPayload,
      executedAt: clock.now(),
      metadata: {
        toolCallId,
        toolName,
        errorCode: validation.isUnknownTool ? 'UNKNOWN_TOOL' : 'TOOL_INVALID_INPUT',
        outcome: validation.isUnknownTool ? 'UNKNOWN_TOOL' : 'TOOL_INVALID_INPUT',
        modelFeedbackMessage: validation.modelFeedbackMessage,
      },
    };
  }

  const tool = validation.tool ?? params.toolExecutor?.getTool(toolName);
  if (!tool) {
    const errorPayload = JSON.stringify({
      success: false,
      errorCode: 'UNKNOWN_TOOL',
      message: `Tool [${toolName}] is not registered in ToolRegistry`,
    });
    return {
      actionId: proposal.id,
      status: ActionResultStatus.FAILURE,
      output: errorPayload,
      durationMs: 0,
      error: errorPayload,
      executedAt: clock.now(),
      metadata: { toolCallId, toolName, errorCode: 'UNKNOWN_TOOL', outcome: 'UNKNOWN_TOOL' },
    };
  }

  if (params.policyEngine) {
    const action = {
      type: tool.definition.category,
      resource: tool.definition.name,
      metadata: input,
      irreversible: proposal.irreversible,
    };
    const evaluation = await params.policyEngine.evaluate(action);
    policyDecisions.push({
      actionId: proposal.id as any,
      toolName: tool.definition.name,
      decision: evaluation.decision,
      ruleId: evaluation.ruleId,
      reason: evaluation.reason,
    });

    if (evaluation.decision === PolicyDecisionType.DENY) {
      const errorPayload = JSON.stringify({
        success: false,
        errorCode: 'POLICY_DENIED',
        message: `Execution denied by policy rule [${evaluation.ruleId ?? 'default'}]: ${evaluation.reason}`,
      });
      return {
        actionId: proposal.id,
        status: ActionResultStatus.DENIED,
        output: errorPayload,
        durationMs: 0,
        error: errorPayload,
        executedAt: clock.now(),
        metadata: {
          toolCallId,
          toolName,
          ruleId: evaluation.ruleId,
          errorCode: 'POLICY_DENIED',
          outcome: 'POLICY_DENIED',
        },
      };
    }

    if (
      evaluation.decision === PolicyDecisionType.REQUIRE_APPROVAL ||
      evaluation.decision === PolicyDecisionType.ESCALATE
    ) {
      const errorPayload = JSON.stringify({
        success: false,
        errorCode: 'REQUIRES_APPROVAL',
        message: `Execution requires approval by policy rule [${evaluation.ruleId ?? 'default'}]: ${evaluation.reason}`,
      });
      return {
        actionId: proposal.id,
        status: ActionResultStatus.DENIED,
        output: errorPayload,
        durationMs: 0,
        error: errorPayload,
        executedAt: clock.now(),
        metadata: {
          toolCallId,
          toolName,
          ruleId: evaluation.ruleId,
          errorCode: 'REQUIRES_APPROVAL',
          outcome: 'REQUIRES_APPROVAL',
        },
      };
    }
  }

  try {
    const result = await params.toolExecutor!.execute({
      tool,
      input,
    });

    const outputContent = result.success
      ? result.output
      : result.error && result.error.startsWith('{')
        ? result.error
        : JSON.stringify({
            success: false,
            errorCode: (result.metadata?.['errorCode'] as string) ?? 'TOOL_EXECUTION_FAILED',
            message: result.error ?? 'Tool execution failed',
          });

    return {
      actionId: proposal.id,
      status: result.success ? ActionResultStatus.SUCCESS : ActionResultStatus.FAILURE,
      output: outputContent,
      durationMs: result.durationMs,
      error: result.error,
      executedAt: clock.now(),
      metadata: { toolCallId, toolName, ...(result.metadata ?? {}) },
    };
  } catch (err) {
    const errorPayload = JSON.stringify({
      success: false,
      errorCode: 'TOOL_EXECUTION_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      actionId: proposal.id,
      status: ActionResultStatus.FAILURE,
      output: errorPayload,
      durationMs: 0,
      error: errorPayload,
      executedAt: clock.now(),
      metadata: { toolCallId, toolName, errorCode: 'TOOL_EXECUTION_FAILED' },
    };
  }
}

function buildIterationDomainModel(rec: IterationRecord, taskId: TaskId): Iteration {
  const hasFailingEvidence = rec.evidenceCreated.some((e) => !e.pass);
  const hasPassedEvidence = rec.evidenceCreated.some((e) => e.pass);
  const hasFailingTool = rec.toolResults.some(
    (t) => t.status === ActionResultStatus.FAILURE || t.status === ActionResultStatus.DENIED,
  );

  const outcome =
    hasFailingEvidence || hasFailingTool
      ? IterationOutcome.VERIFICATION_FAILED
      : hasPassedEvidence
        ? IterationOutcome.VERIFICATION_PASSED
        : IterationOutcome.PROGRESS;

  const filesModified = rec.toolResults
    .map((r) => String(r.metadata['path'] ?? ''))
    .filter((p) => p.length > 0);

  const failingTool = rec.toolResults.find(
    (r) => r.status === ActionResultStatus.FAILURE || r.status === ActionResultStatus.DENIED,
  );
  const toolFailureSignature = failingTool
    ? `${failingTool.metadata['toolName'] ?? 'tool'}:${failingTool.metadata['errorCode'] ?? failingTool.status}`
    : null;

  const failingTests = rec.evidenceCreated.filter((e) => !e.pass).map((e) => e.id as string);
  const patchSignature =
    filesModified.length > 0 ? `patch-${filesModified.join(',')}-${rec.sequenceNumber}` : null;

  return {
    id: rec.iterationId,
    taskId,
    sequenceNumber: rec.sequenceNumber,
    outcome,
    fingerprint: {
      filesModified,
      hypothesisId: rec.actionProposed?.id
        ? (rec.actionProposed.id as unknown as HypothesisId)
        : null,
      errorSignature: hasFailingEvidence ? `ERR_VERIFICATION_SEQ_${rec.sequenceNumber}` : null,
      patchSignature,
      failingTests,
      phaseAtStart: rec.stateBefore,
      stateTrajectory:
        rec.stateBefore === rec.stateAfter ? [rec.stateBefore] : [rec.stateBefore, rec.stateAfter],
      toolFailureSignature,
    },
    evidenceIds: rec.evidenceCreated.map((e) => e.id),
    actionIds: (rec.actionProposals ?? (rec.actionProposed ? [rec.actionProposed] : [])).map(
      (a) => a.id,
    ),
    startedAt: rec.startedAt,
    completedAt: rec.completedAt,
    durationMs: rec.completedAt.getTime() - rec.startedAt.getTime(),
    costDollars: rec.costDollars,
    metadata: {},
  };
}
