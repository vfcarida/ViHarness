/**
 * Model-Facing Skill Tools (from DeepSeek Harness).
 *
 * Implements:
 * - `list_skills`: browse available skills in catalog.
 * - `load_skill`: load and mount a skill into active session context.
 */
import type { Tool } from '../../core/interfaces/tool.js';
import type { SkillRegistry, SelfModification } from '../../core/interfaces/skill-registry.js';
import type { ToolInput, ToolResult, ToolExecutionContext } from '../../core/model/tool-types.js';
import { ToolCategory, ToolRiskLevel } from '../../core/model/tool-types.js';
import type { ToolCallId } from '../../core/types/identifiers.js';

export function createListSkillsTool(registry: SkillRegistry): Tool {
  return {
    definition: {
      name: 'list_skills',
      version: '1.0.0',
      description: 'Browse available skills and templates in the skill catalog.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: true,
      defaultTimeoutMs: 5000,
      requiredPermissions: ['skills:read'],
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    async execute(_input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
      const startTime = Date.now();
      const catalog = registry.catalog();
      const output = JSON.stringify(catalog, null, 2);

      return {
        toolCallId: (context.correlationId || 'call_list_skills') as ToolCallId,
        name: 'list_skills',
        output,
        success: true,
        durationMs: Date.now() - startTime,
        metadata: { count: catalog.length },
      };
    },
  };
}

export function createLoadSkillTool(
  registry: SkillRegistry,
  selfModification?: SelfModification,
): Tool {
  return {
    definition: {
      name: 'load_skill',
      version: '1.0.0',
      description:
        'Load a specific skill into context by name and mount its instructions for the current session.',
      category: ToolCategory.READ,
      riskLevel: ToolRiskLevel.LOW,
      mutating: false,
      idempotent: true,
      defaultTimeoutMs: 5000,
      requiredPermissions: ['skills:read'],
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the skill to load from the catalog',
          },
        },
        required: ['name'],
      },
    },
    async execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolResult> {
      const startTime = Date.now();
      const skillName = String(input['name'] ?? '');

      if (!skillName) {
        return {
          toolCallId: (context.correlationId || 'call_load_skill') as ToolCallId,
          name: 'load_skill',
          output: '',
          success: false,
          durationMs: Date.now() - startTime,
          error: 'Missing required parameter "name"',
        };
      }

      const skill = registry.load(skillName);
      if (!skill) {
        return {
          toolCallId: (context.correlationId || 'call_load_skill') as ToolCallId,
          name: 'load_skill',
          output: '',
          success: false,
          durationMs: Date.now() - startTime,
          error: `Skill [${skillName}] not found in registry.`,
        };
      }

      if (selfModification) {
        selfModification.mountSkill(skillName);
      }

      return {
        toolCallId: (context.correlationId || 'call_load_skill') as ToolCallId,
        name: 'load_skill',
        output: `Skill [${skill.name}] loaded successfully:\n\n${skill.content}`,
        success: true,
        durationMs: Date.now() - startTime,
        metadata: {
          skillName: skill.name,
          source: skill.source,
          tags: skill.tags,
          mounted: selfModification !== undefined,
        },
      };
    },
  };
}
