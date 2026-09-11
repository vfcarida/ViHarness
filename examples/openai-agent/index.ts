/**
 * Example: OpenAI-Compatible Agent
 *
 * Demonstrates wiring Vi-Harness to a real OpenAI-compatible provider.
 * Requires OPENAI_API_KEY (or equivalent) environment variable.
 *
 * Run:
 *   npx tsx examples/openai-agent/index.ts
 *
 * Override endpoint/model:
 *   OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
 *   OPENAI_MODEL=anthropic/claude-3.5-sonnet \
 *   npx tsx examples/openai-agent/index.ts
 */
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  createRuntime,
  DefaultToolRegistry,
  DefaultToolExecutor,
  ReadFileTool,
  WriteFileTool,
  DefaultPolicyEngine,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  OpenAICompatibleProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  SystemClock,
  GoalStatus,
  type Goal,
} from '../../src/index.js';

export interface RunOpenAiAgentOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  customFetch?: typeof fetch;
}

export async function runOpenAiAgent(options?: RunOpenAiAgentOptions): Promise<void> {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY ?? '';
  const baseUrl = options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = options?.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is required. Set it via OPENAI_API_KEY=sk-... or pass apiKey in options.',
    );
  }

  const clock = new SystemClock();
  const idFactory = new UuidV7IdFactory();

  // Use a temporary sandbox workspace so the example does not modify anything real.
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-harness-openai-example-'));

  // Write a simple target file for the agent to work with.
  fs.writeFileSync(
    path.join(workspaceRoot, 'target.ts'),
    '// TODO: implement a function that returns the sum of an array of numbers\n',
  );

  console.log(`\n📁 Workspace: ${workspaceRoot}`);
  console.log(`🤖 Model: ${model} via ${baseUrl}\n`);

  // 1. Workspace tools
  const toolRegistry = new DefaultToolRegistry();
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new WriteFileTool());

  const policyEngine = new DefaultPolicyEngine();
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, policyEngine, idFactory, clock });

  // 2. Model provider
  const router = new UtilityModelRouter();
  const provider = new OpenAICompatibleProvider({
    providerId: 'openai-compatible',
    apiKey,
    baseUrl,
    models: [model],
    requestTimeoutMs: 60_000,
    maxRetries: 2,
    customFetch: options?.customFetch,
  });
  router.registerProvider(provider);

  // 3. Verification & evidence
  const evidenceStore = new DefaultEvidenceStore();
  const verificationEngine = new DefaultVerificationEngine({ evidenceStore, idFactory, clock });

  // 4. Runtime
  const runtime = createRuntime({ router, policyEngine, toolExecutor, verificationEngine, evidenceStore, idFactory, clock });

  // 5. Goal
  const goal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'In target.ts, implement a function `sumArray(numbers: number[]): number` that returns the sum of the input array. Add a JSDoc comment.',
    status: GoalStatus.ACTIVE,
    tasks: [],
    constraints: { maxIterations: 10, maxCostDollars: 0.10, maxDurationMs: 120_000 },
    metadata: { workspaceRoot },
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };

  console.log(`🎯 Goal: ${goal.description}\n`);

  try {
    const result = await runtime.execute(goal);

    console.log('\n📊 Execution Results:');
    console.log(`   Status      : ${result.status}`);
    console.log(`   Final Phase : ${result.finalPhase}`);
    console.log(`   Iterations  : ${result.iterations.length}`);
    console.log(`   Total Tokens: ${result.totalTokens.toLocaleString()}`);
    console.log(`   Total Cost  : $${result.totalCostDollars.toFixed(6)} USD`);

    // Show the resulting file content
    const finalContent = fs.readFileSync(path.join(workspaceRoot, 'target.ts'), 'utf8');
    console.log('\n📄 Final target.ts:\n');
    console.log(finalContent);
  } finally {
    // Clean up sandbox workspace
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up workspace: ${workspaceRoot}`);
  }
}

// Execute if run directly
const isDirectExecution = process.argv[1]?.replace(/\\/g, '/').endsWith('openai-agent/index.ts');
if (isDirectExecution) {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY environment variable is required.');
    console.error('   Set it and re-run: OPENAI_API_KEY=sk-... npx tsx examples/openai-agent/index.ts');
    process.exit(1);
  }
  runOpenAiAgent().catch((err: unknown) => {
    console.error('❌ Agent execution failed:', err);
    process.exit(1);
  });
}
