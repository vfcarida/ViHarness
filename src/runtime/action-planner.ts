/**
 * Action Planner.
 *
 * "The model proposes; the runtime decides."
 *
 * Parses vendor-neutral ModelResponse content and tool calls into
 * explicit ActionProposal domain objects.
 * Tool identity comes strictly from registered tool definitions — no heuristic string mapping.
 *
 * Security:
 * - Approval Spoofing Defense: Strips any model-injected approval flags (userApproved, permissionContext).
 * - Prototype Pollution Defense: Filters prototype properties from parameters.
 */
import type { IdFactory } from '../core/types/identifiers.js';
import type { TaskId, IterationId } from '../core/types/identifiers.js';
import type { ModelResponse } from '../core/model/model-io.js';
import type { ActionProposal } from '../core/model/action.js';
import { ActionType } from '../core/model/action.js';
import type { ToolRegistry } from '../core/interfaces/tool-registry.js';
import { ToolCategory } from '../core/model/tool-types.js';

export class ActionPlanner {
  /**
   * Parse a ModelResponse into structured ActionProposals.
   * Derives action type and risk strictly from the tool registry definition.
   */
  static parseProposals(
    response: ModelResponse,
    taskId: TaskId,
    iterationId: IterationId,
    idFactory: IdFactory,
    toolRegistry?: ToolRegistry,
  ): ReadonlyArray<ActionProposal> {
    const proposals: ActionProposal[] = [];
    const now = new Date();

    // 1. Tool Call Proposals
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        const canonicalName = (tc.name ?? '').trim().toLowerCase();
        const tool = toolRegistry?.getTool(canonicalName) ?? toolRegistry?.getTool(tc.name);
        const actionType = tool
          ? mapCategoryToActionType(tool.definition.category)
          : ActionType.TOOL_CALL;
        const irreversible = tool
          ? tool.definition.mutating ||
            tool.definition.riskLevel === 'HIGH' ||
            tool.definition.riskLevel === 'CRITICAL'
          : false;

        // Strip any approval spoofing or permission override keys from model input
        const cleanInput: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(tc.input ?? {})) {
          if (
            k === '__proto__' ||
            k === 'constructor' ||
            k === 'prototype' ||
            k.toLowerCase() === 'userapproved' ||
            k.toLowerCase() === 'permissioncontext' ||
            k.toLowerCase() === 'securityoverride' ||
            k.toLowerCase() === 'isapproved' ||
            k.toLowerCase() === 'authorized'
          ) {
            continue;
          }
          cleanInput[k] = v;
        }

        proposals.push({
          id: idFactory.create<'Action'>(),
          taskId,
          iterationId,
          type: actionType,
          description: `Execute tool [${tc.name.trim()}]`,
          parameters: {
            ...cleanInput,
            toolName: tc.name.trim(),
            toolCallId: tc.id,
          },
          irreversible,
          proposedAt: now,
        });
      }
    } else if (response.content && response.content.trim().length > 0) {
      // 2. Text response / reasoning action proposal
      proposals.push({
        id: idFactory.create<'Action'>(),
        taskId,
        iterationId,
        type: ActionType.MODEL_CALL,
        description: 'Text completion / reasoning response',
        parameters: { text: response.content.slice(0, 200) },
        irreversible: false,
        proposedAt: now,
      });
    }

    return proposals;
  }
}

function mapCategoryToActionType(category: ToolCategory): ActionType {
  switch (category) {
    case ToolCategory.READ:
      return ActionType.FILE_READ;
    case ToolCategory.WRITE:
      return ActionType.FILE_WRITE;
    case ToolCategory.DESTRUCTIVE:
      return ActionType.FILE_DELETE;
    case ToolCategory.EXECUTE:
      return ActionType.SHELL_EXECUTE;
    default:
      return ActionType.TOOL_CALL;
  }
}
