/**
 * Example: SWE-bench Harness Integration
 *
 * Demonstrates how to use Vi-Harness with --judge-command for external oracle evaluation.
 * Uses ScriptedModelProvider for deterministic, API-key-free simulation.
 *
 * Run:
 *   npx tsx examples/swe-bench-harness/index.ts
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createRuntime,
  DefaultToolRegistry,
  DefaultToolExecutor,
  ReadFileTool,
  WriteFileTool,
  DefaultPolicyEngine,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  SystemClock,
  GoalStatus,
  JudgeInTheLoopOrchestrator,
  type Goal,
} from '../../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SweBenchHarnessResult {
  readonly success: boolean;
  readonly finalVerdict: string;
  readonly totalAttempts: number;
  readonly workspaceRoot: string;
}

export async function runSweBenchHarnessExample(): Promise<SweBenchHarnessResult> {
  const clock = new SystemClock();
  const idFactory = new UuidV7IdFactory();

  // Temporary workspace
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-harness-swe-example-'));
  const predictionsDir = path.join(workspaceRoot, 'predictions');
  fs.mkdirSync(predictionsDir, { recursive: true });

  const judgeScript = path.join(__dirname, 'mock-judge.js');
  const judgeCommand = `"${process.execPath}" "${judgeScript}" --workspace "${workspaceRoot}"`;
  const outputPatch = path.join(predictionsDir, 'task-001.patch');

  console.log('\n🔬 SWE-bench Harness Example\n');
  console.log(`📁 Workspace     : ${workspaceRoot}`);
  console.log(`⚖️  Judge command : ${judgeCommand}`);
  console.log(`📦 Output patch  : ${outputPatch}\n`);

  // Registry and executor
  const toolRegistry = new DefaultToolRegistry();
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new WriteFileTool());

  const policyEngine = new DefaultPolicyEngine();
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, policyEngine, idFactory, clock });

  // Scripted provider: simulates the agent writing a solution on first try
  const router = new UtilityModelRouter();
  const scriptedProvider = new ScriptedModelProvider({
    providerId: 'scripted',
    modelId: 'scripted-model',
    steps: [
      {
        content: 'I will create the required solution.ts file with an exported function.',
        toolCalls: [
          {
            id: idFactory.create<'ToolCall'>(),
            name: 'write_file',
            input: {
              path: path.join(workspaceRoot, 'solution.ts'),
              content: '/**\n * Solves the task.\n */\nexport function solve(input: string): string {\n  return input.trim();\n}\n',
            },
          },
        ],
      },
      {
        content: 'solution.ts created with an exported function. Ready for judge evaluation.',
        toolCalls: [],
      },
    ],
  });
  router.registerProvider(scriptedProvider);

  const evidenceStore = new DefaultEvidenceStore();
  const verificationEngine = new DefaultVerificationEngine({ evidenceStore, idFactory, clock });
  const runtime = createRuntime({ router, policyEngine, toolExecutor, verificationEngine, evidenceStore, idFactory, clock });

  const goal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'Create solution.ts with at least one exported function to satisfy the judge.',
    status: GoalStatus.ACTIVE,
    tasks: [],
    constraints: { maxIterations: 10, maxCostDollars: 0.10, maxDurationMs: 120_000 },
    metadata: { workspaceRoot },
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };

  try {
    // Judge-in-the-Loop closed repair loop
    const outcome = await JudgeInTheLoopOrchestrator.runInteractiveLoop({
      judgeCommand,
      cwd: workspaceRoot,
      maxRetries: 3,
      runIteration: async (_attempt: number, feedbackPrompt?: string) => {
        const iterationGoal: Goal = {
          ...goal,
          id: idFactory.create<'Goal'>(),
          description: feedbackPrompt
            ? `${goal.description}\n\nDiagnostic Feedback:\n${feedbackPrompt}`
            : goal.description,
          createdAt: clock.now(),
          updatedAt: clock.now(),
        };
        const iterResult = await runtime.execute(iterationGoal);
        return { success: iterResult.status === GoalStatus.COMPLETED };
      },
    });

    console.log('\n📊 Results:');
    console.log(`   Final Verdict : ${outcome.finalVerdict}`);
    console.log(`   Total Attempts: ${outcome.totalAttempts}`);
    console.log(`   Success       : ${outcome.success}`);

    return {
      success: outcome.success,
      finalVerdict: outcome.finalVerdict,
      totalAttempts: outcome.totalAttempts,
      workspaceRoot,
    };
  } finally {
    // Cleanup
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up: ${workspaceRoot}`);
  }
}

// Execute if run directly
const isDirectExecution = process.argv[1]?.replace(/\\/g, '/').endsWith('swe-bench-harness/index.ts');
if (isDirectExecution) {
  runSweBenchHarnessExample().catch((err: unknown) => {
    console.error('❌ Example failed:', err);
    process.exit(1);
  });
}
