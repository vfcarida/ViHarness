/**
 * Vi-Harness Interactive Chat / REPL Mode (Claude Code & Aider Style).
 *
 * Provides a stateful, interactive terminal loop with:
 * - Real-time command streaming and state updates
 * - Human-in-the-loop permission gates for mutating tools (write_file, edit_file, run_command)
 * - Slash commands: /diff, /undo, /model, /cost, /dashboard, /compact, /help, /exit
 * - Continuous conversation memory across turns
 */
import * as readline from 'node:readline';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as child_process from 'node:child_process';
import { UuidV7IdFactory } from '../../infra/id/uuid-id-factory.js';
import { SystemClock } from '../../infra/time/system-clock.js';
import { DefaultAgentRuntime } from '../../runtime/default-agent-runtime.js';
import { DefaultContextCompiler } from '../../infra/compiler/default-context-compiler.js';
import { DefaultToolRegistry } from '../../infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../infra/tools/default-tool-executor.js';
import { createWorkspaceTools } from '../../infra/tools/workspace-tools.js';
import { UtilityModelRouter } from '../../infra/router/utility-model-router.js';
import { OpenAICompatibleProvider } from '../../infra/model/openai-compatible-provider.js';
import { MockModelProvider } from '../../infra/model/mock-model-provider.js';
import { TerminalDashboardRenderer, type DashboardState } from '../../infra/tui/terminal-dashboard-renderer.js';
import { ReplVisualizers } from '../../infra/tui/repl-visualizers.js';
import { ProjectRuleLoader } from '../../infra/config/project-rule-loader.js';
import { RealGitManager } from '../../infra/git/real-git-manager.js';
import { GoalStatus, type Goal } from '../../core/model/goal.js';
import { AgentEventType, type AgentEvent } from '../../core/model/runtime-types.js';
import { AgentPhase } from '../../core/model/state.js';
import type { Tool } from '../../core/interfaces/tool.js';
import type { ToolExecutor, ToolExecutionRequest } from '../../core/interfaces/tool-executor.js';
import type { ToolResult, ToolCategory } from '../../core/model/tool-types.js';
import type { ToolCallId } from '../../core/types/identifiers.js';

export interface ChatCliArgs {
  cwd: string;
  modelId: string;
  providerId: string;
  baseUrl?: string;
  apiKey?: string;
  autoApprove: boolean;
  architect: boolean;
  promptCaching: boolean;
  maxIterationsPerTurn: number;
  help: boolean;
}

export function parseChatArgs(args: string[]): ChatCliArgs {
  const result: ChatCliArgs = {
    cwd: process.cwd(),
    modelId:
      process.env['MODEL_ID'] ??
      process.env['OPENAI_MODEL'] ??
      'gpt-4o',
    providerId: 'openai-compatible',
    autoApprove: false,
    architect: false,
    promptCaching: true,
    maxIterationsPerTurn: 15,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--cwd' && i + 1 < args.length) {
      result.cwd = path.resolve(process.cwd(), args[++i]!);
    } else if ((arg === '--model' || arg === '-m') && i + 1 < args.length) {
      result.modelId = args[++i]!;
    } else if (arg === '--base-url' && i + 1 < args.length) {
      result.baseUrl = args[++i]!;
    } else if (arg === '--api-key' && i + 1 < args.length) {
      result.apiKey = args[++i]!;
    } else if (arg === '--provider-id' && i + 1 < args.length) {
      result.providerId = args[++i]!;
    } else if (arg === '--auto-approve' || arg === '-y') {
      result.autoApprove = true;
    } else if (arg === '--architect') {
      result.architect = true;
    } else if (arg === '--prompt-caching') {
      result.promptCaching = true;
    } else if (arg === '--no-prompt-caching') {
      result.promptCaching = false;
    } else if (arg === '--max-iterations' && i + 1 < args.length) {
      result.maxIterationsPerTurn = parseInt(args[++i]!, 10) || 15;
    }
  }

  return result;
}

export function printChatHelp(): void {
  console.log(`
Vi-Harness Interactive Chat / REPL Mode

USAGE:
  vi-harness chat [options]
  vi-harness repl [options]
  vih chat [options]

OPTIONS:
  --cwd <dir>                   Target repository working directory (default: current directory)
  -m, --model <id>              Initial model identifier (default: gpt-4o or MODEL_ID)
  --provider-id <id>            Provider identifier (default: openai-compatible)
  --base-url <url>              Custom endpoint URL
  --api-key <key>               Provider API key
  -y, --auto-approve            Auto-approve all mutating tool calls without interactive confirmation
  --architect                   Enable dual-model Architect Mode
  --prompt-caching / --no-prompt-caching  Toggle static prefix prompt caching (default: true)
  --max-iterations <n>          Maximum agent iterations per user turn (default: 15)
  -h, --help                    Show this help message

SLASH COMMANDS (within chat):
  /help                         Show available slash commands
  /context                      Visualize token economics, context window, and cache usage
  /rules                        Inspect active project instruction rules (VI.md, CLAUDE.md, AGENTS.md)
  /tree [depth]                 Display repository directory tree and file size footprint (default depth: 2)
  /diff                         Show uncommitted git changes in the workspace
  /undo                         Revert uncommitted modifications in the workspace
  /model <model-id>             Switch active model on the fly
  /cost                         Show total session tokens and financial expenditure
  /dashboard                    Display agent state dashboard
  /compact                      Trim prior conversation history
  /exit, /quit, /q              Exit the interactive session
`);
}

/**
 * Human-in-the-loop Interactive Tool Approval Wrapper.
 * Intercepts mutating tools (write_file, edit_file, run_command) and prompts the user.
 */
export class InteractiveApprovalToolExecutor implements ToolExecutor {
  private alwaysApproved: boolean;
  private readonly inner: ToolExecutor;
  private readonly askPrompt: (question: string) => Promise<string>;

  constructor(options: {
    inner: ToolExecutor;
    autoApprove?: boolean;
    askPrompt: (question: string) => Promise<string>;
  }) {
    this.inner = options.inner;
    this.alwaysApproved = options.autoApprove ?? false;
    this.askPrompt = options.askPrompt;
  }

  register(tool: Tool): void {
    this.inner.register(tool);
  }

  getTool(name: string): Tool | undefined {
    return this.inner.getTool(name);
  }

  listTools(category?: ToolCategory): ReadonlyArray<Tool> {
    return this.inner.listTools(category);
  }

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const toolName = request.toolName ?? request.tool?.definition.name ?? 'tool';
    const isMutating =
      toolName === 'write_file' ||
      toolName === 'edit_file' ||
      toolName === 'run_command';

    if (isMutating && !this.alwaysApproved) {
      let targetDesc = '';
      const input = (request.input ?? {}) as Record<string, unknown>;
      if (input['path']) {
        targetDesc = ` [path: ${input['path']}]`;
      } else if (input['targetFile']) {
        targetDesc = ` [file: ${input['targetFile']}]`;
      } else if (input['command']) {
        targetDesc = ` [cmd: ${input['command']}]`;
      }

      const answer = await this.askPrompt(
        `\n⚠️  [Permission Gate] Allow agent to execute tool "${toolName}"${targetDesc}? (y/n/always) [y]: `,
      );

      const trimmed = answer.trim().toLowerCase();
      if (trimmed === 'always' || trimmed === 'a') {
        this.alwaysApproved = true;
      } else if (trimmed === 'n' || trimmed === 'no') {
        return {
          toolCallId: ((request.context as Record<string, unknown> | undefined)?.['toolCallId'] ??
            `denied-${Date.now()}`) as ToolCallId,
          name: toolName,
          success: false,
          output: `User declined permission to execute tool [${toolName}]. Suggest an alternative or seek further clarification.`,
          error: `User declined permission to execute tool [${toolName}]. Suggest an alternative or seek further clarification.`,
          durationMs: 0,
          metadata: { errorCode: 'USER_PERMISSION_DENIED', toolName },
        };
      }
    }

    return this.inner.execute(request);
  }
}

export async function runChatCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseChatArgs(args);

  if (parsed.help) {
    printChatHelp();
    return 0;
  }

  const workspacePath = parsed.cwd;
  if (!fs.existsSync(workspacePath)) {
    console.error(`Error: Workspace directory does not exist: ${workspacePath}`);
    return 1;
  }

  console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║                   VI-HARNESS INTERACTIVE CHAT (REPL)                   ║
╚════════════════════════════════════════════════════════════════════════╝
Workspace : ${workspacePath}
Model     : ${parsed.modelId} (${parsed.providerId})
Approvals : ${parsed.autoApprove ? 'Auto-approve (unrestricted)' : 'Human-in-the-loop (interactive confirmation)'}
Caching   : ${parsed.promptCaching ? 'Enabled' : 'Disabled'}
Type /help for slash commands or /exit to quit.
`);

  // Session state
  let currentModelId = parsed.modelId;
  let totalSessionTokens = 0;
  let totalSessionPromptTokens = 0;
  let totalSessionCompletionTokens = 0;
  let totalSessionCachedTokens = 0;
  let totalSessionCostDollars = 0;
  let totalSessionTurns = 0;
  let lastPhase: AgentPhase | string = AgentPhase.EXPLORE;
  const conversationHistory: string[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const askUser = (query: string): Promise<string> =>
    new Promise((resolve) => rl.question(query, resolve));

  const gitManager = new RealGitManager({ workingDir: workspacePath });

  try {
    while (true) {
      const input = await askUser(`\nvi-harness ❯ `);
      const trimmed = input.trim();

      if (!trimmed) continue;

      // Handle Slash Commands
      if (trimmed.startsWith('/')) {
        const [cmd, ...cmdArgs] = trimmed.split(/\s+/);
        const lowerCmd = cmd!.toLowerCase();

        if (lowerCmd === '/exit' || lowerCmd === '/quit' || lowerCmd === '/q') {
          console.log('\n👋 Session terminated. Goodbye!');
          break;
        }

        if (lowerCmd === '/help') {
          console.log(`
Available Slash Commands:
  /context              Visualize token economics, context window, and cache usage
  /rules                Inspect active project instruction rules (VI.md, CLAUDE.md, AGENTS.md)
  /tree [depth]         Display repository directory tree and file size footprint (default depth: 2)
  /diff                 Show current git diff of changes in workspace
  /undo                 Revert uncommitted modifications in the workspace
  /model <model_id>     Switch the active language model dynamically
  /cost                 Display accumulated session tokens and dollar costs
  /dashboard            Display runtime execution dashboard
  /compact              Clear prior multi-turn conversation memory
  /help                 Show this help overview
  /exit                 Exit the interactive REPL
`);
          continue;
        }

        if (lowerCmd === '/diff') {
          try {
            const diff = await gitManager.getDiff();
            if (!diff.trim()) {
              console.log('✨ Workspace clean — zero uncommitted modifications.');
            } else {
              console.log('\n── Workspace Git Diff ──');
              console.log(diff);
              console.log('────────────────────────');
            }
          } catch (err: any) {
            console.error(`Git diff error: ${err?.message ?? String(err)}`);
          }
          continue;
        }

        if (lowerCmd === '/undo') {
          const confirm = await askUser('⚠️  Revert all uncommitted workspace changes? (y/N): ');
          if (confirm.trim().toLowerCase() === 'y') {
            try {
              child_process.execSync('git checkout -- .', { cwd: workspacePath, stdio: 'ignore' });
              try {
                child_process.execSync('git clean -fd', { cwd: workspacePath, stdio: 'ignore' });
              } catch {
                // Ignore clean errors
              }
              console.log('✅ Workspace reverted to previous clean git state.');
            } catch (err: any) {
              console.error(`Undo error: ${err?.message ?? String(err)}`);
            }
          } else {
            console.log('Undo cancelled.');
          }
          continue;
        }

        if (lowerCmd === '/model') {
          const newModel = cmdArgs[0]?.trim();
          if (!newModel) {
            console.log(`Current model: ${currentModelId}`);
          } else {
            currentModelId = newModel;
            console.log(`🔄 Switched active model to: ${currentModelId}`);
          }
          continue;
        }

        if (lowerCmd === '/cost') {
          console.log(`
── Session Financial & Token Metrics ──
Total Turns          : ${totalSessionTurns}
Total Tokens         : ${totalSessionTokens.toLocaleString()}
Prompt Tokens        : ${totalSessionPromptTokens.toLocaleString()}
Completion Tokens    : ${totalSessionCompletionTokens.toLocaleString()}
Cached Tokens Read   : ${totalSessionCachedTokens.toLocaleString()}
Estimated Cost (USD) : $${totalSessionCostDollars.toFixed(5)}
───────────────────────────────────────`);
          continue;
        }

        if (lowerCmd === '/dashboard') {
          const state: DashboardState = {
            executionId: 'interactive-session',
            taskId: `turn-${totalSessionTurns}`,
            currentPhase: lastPhase,
            sequenceNumber: totalSessionTurns,
            modelId: currentModelId,
            providerId: parsed.providerId,
            promptTokens: totalSessionPromptTokens,
            completionTokens: totalSessionCompletionTokens,
            cachedTokens: totalSessionCachedTokens,
            costDollars: totalSessionCostDollars,
          };
          console.log('\n' + TerminalDashboardRenderer.render(state));
          continue;
        }

        if (lowerCmd === '/compact') {
          conversationHistory.length = 0;
          console.log('🧹 Multi-turn conversation context cleared.');
          continue;
        }

        if (lowerCmd === '/context') {
          let ruleChars = 0;
          try {
            const rules = await ProjectRuleLoader.loadRules(workspacePath);
            ruleChars = rules.totalCharacters;
          } catch {
            // Non-fatal
          }
          console.log(
            '\n' +
              ReplVisualizers.renderContextEconomics({
                modelId: currentModelId,
                promptTokens: totalSessionPromptTokens,
                completionTokens: totalSessionCompletionTokens,
                cachedTokens: totalSessionCachedTokens,
                costDollars: totalSessionCostDollars,
                historyTurnCount: conversationHistory.length,
                rulesCharCount: ruleChars,
              }),
          );
          continue;
        }

        if (lowerCmd === '/rules') {
          try {
            const rulesRes = await ProjectRuleLoader.loadRules(workspacePath);
            console.log('\n' + ReplVisualizers.renderProjectRules(rulesRes, workspacePath));
          } catch (err: any) {
            console.error(`Failed to load project rules: ${err?.message ?? String(err)}`);
          }
          continue;
        }

        if (lowerCmd === '/tree') {
          const depthArg = parseInt(cmdArgs[0] ?? '2', 10);
          const maxDepth = isNaN(depthArg) || depthArg < 1 ? 2 : Math.min(depthArg, 5);
          console.log('\n' + ReplVisualizers.renderDirectoryTree(workspacePath, maxDepth));
          continue;
        }

        console.log(`Unknown slash command: ${cmd}. Type /help for available options.`);
        continue;
      }

      // Execute agent turn
      totalSessionTurns++;
      const idFactory = new UuidV7IdFactory();
      const clock = new SystemClock();

      let provider;
      if (parsed.providerId === 'mock') {
        provider = new MockModelProvider({
          descriptor: { id: currentModelId },
          providerId: 'mock',
          defaultResponseText: 'I have analyzed your request and updated the workspace.',
        });
      } else {
        provider = new OpenAICompatibleProvider({
          providerId: parsed.providerId,
          baseUrl:
            parsed.baseUrl ??
            process.env['OPENROUTER_BASE_URL'] ??
            process.env['OPENAI_BASE_URL'],
          apiKey:
            parsed.apiKey ??
            process.env['OPENROUTER_API_KEY'] ??
            process.env['OPENAI_API_KEY'],
          defaultModelId: currentModelId,
        });
      }

      const router = new UtilityModelRouter();
      router.registerProvider(provider);

      const workspaceTools = createWorkspaceTools(workspacePath, {
        idFactory,
        commandTimeoutMs: 120000,
      });
      const toolRegistry = new DefaultToolRegistry();
      for (const t of workspaceTools) {
        toolRegistry.register(t);
      }
      const rawExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory });
      const approvalExecutor = new InteractiveApprovalToolExecutor({
        inner: rawExecutor,
        autoApprove: parsed.autoApprove,
        askPrompt: askUser,
      });

      const compiler = new DefaultContextCompiler({ idFactory, clock });
      const runtime = new DefaultAgentRuntime({
        router,
        compiler,
        toolExecutor: approvalExecutor,
        idFactory,
        clock,
      });

      // Stream events to terminal
      runtime.subscribe({
        onEvent: (event: AgentEvent) => {
          switch (event.type) {
            case AgentEventType.IterationStarted: {
              const seq = (event.data as any).sequenceNumber ?? 1;
              const phase = (event.data as any).stateBefore ?? 'RUNNING';
              lastPhase = phase;
              console.log(`\n── Step ${seq} (${phase}) ──`);
              break;
            }
            case AgentEventType.ActionProposed: {
              const act = (event.data as any).action;
              console.log(`💡 Proposing: ${act?.toolName ?? 'tool'}`);
              break;
            }
            case AgentEventType.ToolCompleted: {
              const act = (event.data as any).result;
              const status = act?.status === 'SUCCESS' ? '✅' : '❌';
              const name = act?.toolName ?? act?.metadata?.['toolName'] ?? 'tool';
              console.log(`${status} Executed: ${name} (${act?.durationMs ?? 0}ms)`);
              if (act?.output) {
                const lines = String(act.output).trim().split('\n');
                const preview = lines.slice(0, 3).map((l: string) => `    │ ${l}`).join('\n');
                const more = lines.length > 3 ? `\n    │ ... (${lines.length - 3} more lines)` : '';
                console.log(preview + more);
              }
              break;
            }
            case AgentEventType.StateUpdated: {
              const toPhase = (event.data as any).to;
              lastPhase = toPhase;
              console.log(`🔄 Phase: ${(event.data as any).from} ──> ${toPhase}`);
              break;
            }
            case AgentEventType.AgentCompleted:
              console.log(`\n🎉 Step Completed!`);
              break;
            case AgentEventType.AgentFailed:
              console.error(`\n❌ Error: ${(event.data as any).error ?? 'Unknown error'}`);
              break;
          }
        },
      });

      // Build task prompt with prior context
      let promptText = `User Request: ${trimmed}`;
      if (conversationHistory.length > 0) {
        const historyContext = conversationHistory.slice(-4).join('\n');
        promptText = `Prior Conversation Turns:\n${historyContext}\n\nCurrent User Request:\n${trimmed}`;
      }

      const goal: Goal = {
        id: idFactory.create<'Goal'>(),
        description: promptText,
        constraints: {
          maxIterations: parsed.maxIterationsPerTurn,
          maxCostDollars: 10.0,
          maxDurationMs: 600000,
          maxRepairAttempts: 3,
          maxNoProgressIterations: 3,
          requireVerification: false,
        },
        status: GoalStatus.ACTIVE,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        metadata: { workspacePath, interactiveTurn: totalSessionTurns },
      };

      try {
        const result = await runtime.execute(goal, {
          architectMode: parsed.architect,
          promptCaching: parsed.promptCaching,
          toolExecutor: approvalExecutor,
        });

        totalSessionCostDollars += result.totalCostDollars;
        totalSessionTokens += result.totalTokens;

        for (const iter of result.iterations) {
          totalSessionPromptTokens += iter.tokenUsage.inputTokens;
          totalSessionCompletionTokens += iter.tokenUsage.outputTokens;
          totalSessionCachedTokens += iter.tokenUsage.cacheReadTokens ?? 0;
        }

        conversationHistory.push(`User: ${trimmed}`);
        conversationHistory.push(`Assistant: ${result.summary}`);
      } catch (err: any) {
        console.error(`Execution error: ${err?.message ?? String(err)}`);
      }
    }
  } finally {
    rl.close();
  }

  return 0;
}
