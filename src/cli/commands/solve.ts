#!/usr/bin/env node
/**
 * Vi-Harness Solve Command.
 *
 * Autonomous Agent CLI Entrypoint:
 * - Runs a real autonomous agent loop on an arbitrary repository workspace (--cwd).
 * - Provides workspace tools (read_file, write_file, edit_file, revert_file, list_directory, run_command).
 * - Routes model requests to OpenAI/OpenRouter/LiteLLM endpoints with configurable base URL, keys, timeouts, and reasoning effort.
 * - Streams events in JSONL (--mode jsonl) or human-readable format.
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as child_process from 'node:child_process';
import { DefaultAgentRuntime } from '../../runtime/default-agent-runtime.js';
import { DefaultContextCompiler } from '../../infra/compiler/default-context-compiler.js';
import { DefaultToolRegistry } from '../../infra/tools/default-tool-registry.js';
import { DefaultToolExecutor } from '../../infra/tools/default-tool-executor.js';
import { createWorkspaceTools } from '../../infra/tools/workspace-tools.js';
import { OpenAICompatibleProvider } from '../../infra/model/openai-compatible-provider.js';
import { BedrockConverseProvider } from '../../infra/model/bedrock-provider.js';
import { MockModelProvider } from '../../infra/model/mock-model-provider.js';
import { UuidV7IdFactory } from '../../infra/id/uuid-id-factory.js';
import { SystemClock } from '../../infra/time/system-clock.js';
import { UtilityModelRouter } from '../../infra/router/utility-model-router.js';
import { GoalStatus, type Goal } from '../../core/model/goal.js';
import { AgentEventType, type AgentEvent } from '../../core/model/runtime-types.js';
import { RealGitManager } from '../../infra/git/real-git-manager.js';
import { SourceCodeIndexer } from '../../infra/syntax/source-code-indexer.js';
import { OjFeedbackIngester } from '../../infra/eval/oj-feedback-ingester.js';

const IGNORED_SCAN_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  'bin',
  'obj',
  '.cache',
  'CMakeFiles',
  'target',
  'vendor',
]);

const SOURCE_FILE_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.cxx',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.kts',
  '.scala',
  '.sh',
  '.bash',
  '.sql',
  '.dart',
  '.lua',
  '.zig',
]);

export function scanWorkspaceFiles(
  rootPath: string,
  maxFiles = 60,
  maxSizeBytes = 100 * 1024,
): Map<string, string> {
  const result = new Map<string, string>();

  function walk(currentDir: string): void {
    if (result.size >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (result.size >= maxFiles) break;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (IGNORED_SCAN_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_FILE_EXTS.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size <= maxSizeBytes) {
              const content = fs.readFileSync(fullPath, 'utf-8');
              result.set(relPath, content);
            }
          } catch {
            // Ignore unreadable file during workspace scan
          }
        }
      }
    }
  }

  walk(rootPath);
  return result;
}

export interface SolveCliArgs {
  prompt: string;
  cwd: string;
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  providerId: string;
  mode: 'text' | 'json' | 'jsonl';
  reasoningEffort?: 'low' | 'medium' | 'high';
  requestTimeoutMs?: number;
  maxRetries?: number;
  maxIterations: number;
  git: boolean;
  architect: boolean;
  autoLint: boolean;
  autoRollback: boolean;
  outputPatch?: string;
  sandbox: 'local' | 'docker';
  dockerImage: string;
  promptCaching: boolean;
  strictCompiler: boolean;
  maxCpuTimeSec?: number;
  maxMemoryMb?: number;
  ingestFeedback?: string;
  help: boolean;
}

export function printSolveHelp(): void {
  console.log(`
Vi-Harness Solve — Autonomous Headless Agent Runner

USAGE:
  vi-harness solve [options]
  vi-harness -p "<task>" [options]
  vih solve -p "<task>" [options]

OPTIONS:
  -p, --prompt, --message <task>  Task prompt / instructions (required)
  --cwd <dir>                     Target repository working directory (default: current directory)
  -m, --model <id>                Model identifier (default: process.env.MODEL_ID or gpt-4o)
  --base-url <url>                API Base URL (OpenRouter, LiteLLM, or OpenAI-compatible)
  --api-key <key>                 API key for the provider
  --provider-id <id>              Provider identifier (default: openai-compatible)
  --mode <text|json|jsonl>        Output format: human text or machine-readable JSONL stream (default: text)
  --reasoning-effort <effort>     Reasoning effort level: low, medium, or high
  --request-timeout-ms <ms>       Per-request model timeout in ms (default: 180000 / 3 minutes)
  --max-retries <n>               Maximum request retries (default: 1)
  --max-iterations <n>            Maximum agent loop iterations (default: 30)
  --auto-lint                     Enable automatic lint verification after file writes (default: false)
  --auto-rollback / --no-auto-rollback  Automatically revert workspace on oscillation/stagnation anomalies (default: true)
  --prompt-caching / --no-prompt-caching  Enable static prefix prompt caching breakpoints (default: true)
  --strict-compiler / --no-strict-compiler  Treat compiler warnings as fatal errors (ACMOJ / SWE-bench strict gate, default: false)
  --max-cpu-time-sec <sec>        Limit execution time for local commands (detects TLE)
  --max-memory-mb <mb>            Limit virtual memory for local commands (detects MLE)
  --ingest-feedback <file|json>   Ingest external Online Judge (ACMOJ / SWE-bench) verdict/log for targeted repair
  --output-patch <file>           Export git diff patch of agent modifications (SWE-bench / ProjDevBench format)
  --sandbox <local|docker>        Command execution environment: local or docker container (default: local)
  --docker-image <image>          Docker image used when --sandbox is docker (default: ubuntu:22.04)
  --git / --no-git                Commit changes via git upon completion (default: false)
  --architect                     Enable dual-model Architect Mode
  -h, --help                      Show this help message

ENVIRONMENT VARIABLES:
  OPENROUTER_BASE_URL, OPENAI_BASE_URL      Custom endpoint URL
  OPENROUTER_API_KEY, OPENAI_API_KEY        Model API key
  VI_HARNESS_REQUEST_TIMEOUT_MS             Default request timeout in milliseconds
  VI_HARNESS_MAX_RETRIES                    Default request retries
  VI_HARNESS_REASONING_EFFORT               Default reasoning effort (low, medium, high)
  MODEL_ID, OPENAI_MODEL                    Default model ID
  VI_HARNESS_STRICT_COMPILER                Default strict compiler enforcement (true/false)
  VI_HARNESS_MAX_CPU_TIME_SEC               Default CPU time limit in seconds
  VI_HARNESS_MAX_MEMORY_MB                  Default virtual memory limit in MB
`);
}

export function parseSolveArgs(args: string[]): SolveCliArgs {
  const result: SolveCliArgs = {
    prompt: '',
    cwd: process.cwd(),
    modelId:
      process.env['MODEL_ID'] ??
      process.env['OPENAI_MODEL'] ??
      'gpt-4o',
    providerId: 'openai-compatible',
    mode: 'text',
    maxIterations: 30,
    git: false,
    architect: false,
    autoLint: false,
    autoRollback: true,
    sandbox: 'local',
    dockerImage: 'ubuntu:22.04',
    promptCaching: true,
    strictCompiler: process.env['VI_HARNESS_STRICT_COMPILER'] === 'true' || false,
    maxCpuTimeSec: process.env['VI_HARNESS_MAX_CPU_TIME_SEC']
      ? parseInt(process.env['VI_HARNESS_MAX_CPU_TIME_SEC'], 10)
      : undefined,
    maxMemoryMb: process.env['VI_HARNESS_MAX_MEMORY_MB']
      ? parseInt(process.env['VI_HARNESS_MAX_MEMORY_MB'], 10)
      : undefined,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (
      (arg === '--prompt' || arg === '-p' || arg === '--message') &&
      i + 1 < args.length
    ) {
      result.prompt = args[++i]!;
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
    } else if (arg === '--mode' && i + 1 < args.length) {
      const m = args[++i]!.toLowerCase();
      if (m === 'json' || m === 'jsonl') {
        result.mode = 'jsonl';
      } else {
        result.mode = 'text';
      }
    } else if (arg === '--reasoning-effort' && i + 1 < args.length) {
      const re = args[++i]!.toLowerCase();
      if (re === 'low' || re === 'medium' || re === 'high') {
        result.reasoningEffort = re;
      }
    } else if (arg === '--request-timeout-ms' && i + 1 < args.length) {
      result.requestTimeoutMs = parseInt(args[++i]!, 10) || 180000;
    } else if (arg === '--max-retries' && i + 1 < args.length) {
      result.maxRetries = parseInt(args[++i]!, 10) || 1;
    } else if (arg === '--max-iterations' && i + 1 < args.length) {
      result.maxIterations = parseInt(args[++i]!, 10) || 30;
    } else if (arg === '--git') {
      result.git = true;
    } else if (arg === '--no-git') {
      result.git = false;
    } else if (arg === '--architect') {
      result.architect = true;
    } else if (arg === '--auto-lint') {
      result.autoLint = true;
    } else if (arg === '--auto-rollback') {
      result.autoRollback = true;
    } else if (arg === '--no-auto-rollback') {
      result.autoRollback = false;
    } else if (arg === '--prompt-caching') {
      result.promptCaching = true;
    } else if (arg === '--no-prompt-caching') {
      result.promptCaching = false;
    } else if (arg === '--strict-compiler') {
      result.strictCompiler = true;
    } else if (arg === '--no-strict-compiler') {
      result.strictCompiler = false;
    } else if (arg === '--max-cpu-time-sec' && i + 1 < args.length) {
      result.maxCpuTimeSec = parseInt(args[++i]!, 10);
    } else if (arg === '--max-memory-mb' && i + 1 < args.length) {
      result.maxMemoryMb = parseInt(args[++i]!, 10);
    } else if (arg === '--ingest-feedback' && i + 1 < args.length) {
      result.ingestFeedback = args[++i]!;
    } else if (arg === '--output-patch' && i + 1 < args.length) {
      result.outputPatch = args[++i]!;
    } else if (arg === '--sandbox' && i + 1 < args.length) {
      const s = args[++i]!.toLowerCase();
      if (s === 'docker' || s === 'local') {
        result.sandbox = s;
      }
    } else if (arg === '--docker-image' && i + 1 < args.length) {
      result.dockerImage = args[++i]!;
    } else if (!result.prompt && !arg.startsWith('-')) {
      // Positional argument treated as prompt if not already set
      result.prompt = arg;
    }
  }

  return result;
}

export async function runSolveCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseSolveArgs(args);

  if (parsed.help) {
    printSolveHelp();
    return 0;
  }

  if (!parsed.prompt) {
    console.error('Error: Task prompt is required. Use -p "<prompt>" or --prompt "<prompt>".\n');
    printSolveHelp();
    return 1;
  }

  const workspacePath = path.resolve(parsed.cwd);
  if (!fs.existsSync(workspacePath)) {
    console.error(`Error: Target workspace directory does not exist: ${workspacePath}`);
    return 1;
  }

  const isJsonl = parsed.mode === 'jsonl';

  const logInfo = (msg: string) => {
    if (isJsonl) {
      process.stderr.write(`[vi-harness] ${msg}\n`);
    } else {
      console.log(`[vi-harness] ${msg}`);
    }
  };

  const logError = (msg: string) => {
    console.error(`[vi-harness error] ${msg}`);
  };

  logInfo(`Initializing solve agent on workspace: ${workspacePath}`);
  logInfo(`Model: ${parsed.modelId} (provider: ${parsed.providerId})`);
  logInfo(`Prompt Caching: ${parsed.promptCaching ? 'enabled (ephemeral static prefix)' : 'disabled'}`);

  // 1. Initialize Core Identifiers and Clocks
  const idFactory = new UuidV7IdFactory();
  const clock = new SystemClock();

  // 2. Setup Provider
  let provider;
  if (parsed.providerId === 'mock') {
    provider = new MockModelProvider({
      descriptor: { id: parsed.modelId },
      providerId: 'mock',
      defaultResponseText: 'I will complete the requested task.',
    });
  } else if (parsed.providerId === 'bedrock') {
    provider = new BedrockConverseProvider({
      providerId: 'bedrock',
      defaultModelId: parsed.modelId,
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
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
      defaultModelId: parsed.modelId,
    });
  }

  const router = new UtilityModelRouter();
  router.registerProvider(provider);

  // 3. Register Workspace Tools (read_file, write_file, list_directory, run_command)
  const workspaceTools = createWorkspaceTools(workspacePath, {
    idFactory,
    commandTimeoutMs: 120000,
    sandbox: parsed.sandbox,
    dockerImage: parsed.dockerImage,
    strictCompilerCheck: parsed.strictCompiler,
    maxCpuTimeSec: parsed.maxCpuTimeSec,
    maxMemoryMb: parsed.maxMemoryMb,
  });

  const toolRegistry = new DefaultToolRegistry();
  for (const tool of workspaceTools) {
    toolRegistry.register(tool);
  }
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, idFactory });
  const compiler = new DefaultContextCompiler({ idFactory, clock });

  // 4. Instantiate Agent Runtime
  const runtime = new DefaultAgentRuntime({
    router,
    compiler,
    toolExecutor,
    idFactory,
    clock,
  });

  // 5. Event Streaming Observer
  runtime.subscribe({
    onEvent: (event: AgentEvent) => {
      if (isJsonl) {
        const streamObj = {
          event: event.type,
          timestamp: event.timestamp.toISOString(),
          executionId: event.executionId,
          taskId: event.taskId,
          data: event.data,
        };
        process.stdout.write(JSON.stringify(streamObj) + '\n');
      } else {
        switch (event.type) {
          case AgentEventType.AgentStarted:
            console.log(`🚀 Task Started: ${event.data.description}`);
            break;
          case AgentEventType.IterationStarted: {
            const seq = (event.data as any).sequenceNumber ?? 1;
            const phase = (event.data as any).stateBefore ?? 'RUNNING';
            console.log(`\n── Iteration ${seq} (Phase: ${phase}) ──`);
            break;
          }
          case AgentEventType.ActionProposed:
            console.log(`💡 Proposed Tool: ${(event.data as any).action?.toolName ?? 'unknown'}`);
            break;
          case AgentEventType.ToolCompleted: {
            const act = (event.data as any).result;
            const status = act?.status === 'SUCCESS' ? '✅' : '❌';
            const toolName = act?.toolName ?? act?.metadata?.['toolName'] ?? 'tool';
            console.log(`${status} Executed: ${toolName} (${act?.durationMs ?? 0}ms)`);
            if (act?.output) {
              const lines = String(act.output).trim().split('\n');
              const preview = lines.slice(0, 3).map((l: string) => `    │ ${l}`).join('\n');
              const more = lines.length > 3 ? `\n    │ ... (${lines.length - 3} more lines)` : '';
              console.log(preview + more);
            }
            break;
          }
          case AgentEventType.StateUpdated:
            console.log(`🔄 Phase: ${(event.data as any).from} ──> ${(event.data as any).to}`);
            break;
          case AgentEventType.AgentCompleted:
            console.log(`\n🎉 Task Completed Successfully in ${(event.data as any).iterationsCount} iterations!`);
            break;
          case AgentEventType.AgentFailed:
            console.error(`\n❌ Task Failed: ${(event.data as any).error ?? 'Unknown error'}`);
            break;
        }
      }
    },
  });

  // 6. Build Initial Repository Map (Aider-style AST symbol indexing)
  let repoMapSection = '';
  try {
    const workspaceFiles = scanWorkspaceFiles(workspacePath, 60);
    if (workspaceFiles.size > 0) {
      const repoMap = SourceCodeIndexer.buildRepoMap(workspaceFiles);
      const rendered = SourceCodeIndexer.renderRepoMap(repoMap, { maxTokens: 2000 });
      if (rendered.trim()) {
        repoMapSection = `\n\nRepository Map (Signatures & Symbol Outline):\n${rendered}`;
        logInfo(
          `Generated initial repository map (${repoMap.totalFiles} files, ${repoMap.totalSymbols} symbols).`,
        );
      }
    }
  } catch {
    // Non-fatal if indexer fails to scan or parse repository files
  }

  let feedbackSection = '';
  if (parsed.ingestFeedback) {
    const feedback = OjFeedbackIngester.parseFeedback(parsed.ingestFeedback, workspacePath);
    if (feedback) {
      feedbackSection = `\n\n${OjFeedbackIngester.formatFeedbackPrompt(feedback)}`;
      logInfo(
        `Ingested external Online Judge feedback: verdict=${feedback.verdict} (source: ${feedback.source})`,
      );
    } else {
      logInfo(`Warning: Unable to parse feedback from ${parsed.ingestFeedback}`);
    }
  }

  // 7. Build Task Prompt with Contract Guidelines
  const fullPrompt = `Task Instructions:
${parsed.prompt}
${repoMapSection}${feedbackSection}

Guidelines for this workspace:
1. First, inspect the workspace using 'list_directory' and 'read_file' to understand existing files, declarations, and structure.
2. Targeted Editing: Prefer using 'edit_file' for precise search-and-replace modifications instead of rewriting entire files with 'write_file'. This prevents accidental regressions, preserves unchanged function signatures, and avoids subtle type mismatch bugs.
3. Strict Compiler Quality: Always build and compile with strict compiler flags ('-Wall -Wextra -Werror' for C/C++, strict typecheck for TS/Python). Strict evaluation judges (such as ACMOJ or benchmark harnesses) treat warnings as fatal compile errors ('compile_error'). Ensure zero warnings and zero errors before concluding.
4. Implement complete code files and build configurations (e.g. CMakeLists.txt or Makefile). Ensure any build produces the expected binary target (e.g. 'code').
5. Use 'run_command' to compile and test your solution locally to verify correctness before finishing.
6. Ensure clean .gitignore ignoring build outputs (CMakeFiles/, CMakeCache.txt, binaries).
7. Do not run external submission scripts or make premature partial git commits. Produce complete, working code in the workspace.`;

  const goal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: fullPrompt,
    constraints: {
      maxIterations: parsed.maxIterations,
      maxCostDollars: 50.0,
      maxDurationMs: 3600000, // 1 hour
      maxRepairAttempts: 5,
      maxNoProgressIterations: 5,
      requireVerification: false,
    },
    status: GoalStatus.ACTIVE,
    createdAt: clock.now(),
    updatedAt: clock.now(),
    metadata: {
      workspacePath,
      cliInvocation: true,
    },
  };

  // 7. Execute Runtime Loop
  try {
    const result = await runtime.execute(goal, {
      architectMode: parsed.architect,
      requestTimeoutMs: parsed.requestTimeoutMs,
      maxRetries: parsed.maxRetries,
      reasoningEffort: parsed.reasoningEffort,
      autoLintAfterWrite: parsed.autoLint,
      autoRollback: parsed.autoRollback,
      rollbackOnAnomaly: parsed.autoRollback,
      promptCaching: parsed.promptCaching,
      toolExecutor,
    });

    // 8. Optional Output Patch Export (SWE-bench / ProjDevBench format)
    if (parsed.outputPatch) {
      try {
        const gitDir = path.join(workspacePath, '.git');
        if (!fs.existsSync(gitDir)) {
          try {
            child_process.execSync('git init', { cwd: workspacePath, stdio: 'ignore' });
          } catch {
            // Ignore if git init fails
          }
        }
        const gitManager = new RealGitManager({ workingDir: workspacePath });
        const diff = await gitManager.getDiff();
        const patchPath = path.resolve(process.cwd(), parsed.outputPatch);
        const patchDir = path.dirname(patchPath);
        if (!fs.existsSync(patchDir)) {
          fs.mkdirSync(patchDir, { recursive: true });
        }
        fs.writeFileSync(patchPath, diff ? `${diff}\n` : '', 'utf-8');
        logInfo(`Exported model patch to ${patchPath} (${Buffer.byteLength(diff, 'utf-8')} bytes)`);
      } catch (patchErr: any) {
        logError(`Failed to export patch: ${patchErr?.message ?? String(patchErr)}`);
      }
    }

    // 9. Optional Git Auto-Commit
    if (parsed.git) {
      try {
        const gitManager = new RealGitManager({ workingDir: workspacePath });
        if (await gitManager.isDirty()) {
          const sha = await gitManager.createCommit(`vi-harness: ${parsed.prompt.slice(0, 72)}`);
          logInfo(`Git commit created: ${sha}`);
        }
      } catch (gitErr: any) {
        logError(`Git commit failed: ${gitErr?.message ?? String(gitErr)}`);
      }
    }

    if (result.success) {
      logInfo(`Execution finished with status COMPLETED (${result.iterationCount} iterations, ${result.totalTokens} tokens).`);
      return 0;
    } else {
      logError(`Execution finished with status ${result.status}: ${result.summary}`);
      return 1;
    }
  } catch (err: any) {
    logError(`Execution uncaught error: ${err?.message ?? String(err)}`);
    return 1;
  }
}
