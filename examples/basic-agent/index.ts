/**
 * Vi-Harness Quickstart: Basic Autonomous Coding Agent
 *
 * Demonstrates:
 * 1. Initializing runtime dependencies with zero external SDKs
 * 2. Registering standard filesystem tools
 * 3. Defining a Goal and executing it through the 10-phase state machine
 * 4. Capturing empirical verification evidence and telemetry
 */
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import {
  createRuntime,
  DefaultToolRegistry,
  DefaultToolExecutor,
  ReadFileTool,
  WriteFileTool,
  DefaultPolicyEngine,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  MockModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  SystemClock,
  GoalStatus,
  type Goal,
} from '../../src/index.js';

export async function runBasicAgent(): Promise<void> {
  const clock = new SystemClock();
  const idFactory = new UuidV7IdFactory();

  // 1. Setup Tools
  const toolRegistry = new DefaultToolRegistry();
  toolRegistry.register(new ReadFileTool());
  toolRegistry.register(new WriteFileTool());

  const policyEngine = new DefaultPolicyEngine();
  const toolExecutor = new DefaultToolExecutor({
    registry: toolRegistry,
    policyEngine,
    idFactory,
    clock,
  });

  // 2. Setup Model Router with Provider
  const router = new UtilityModelRouter();
  const modelProvider = new MockModelProvider({
    providerId: 'mock-primary',
    modelId: 'mock-gpt-4o',
    cannedResponses: [
      {
        content: 'I will inspect the workspace and apply the required patch.',
        toolCalls: [
          {
            id: 'call-1',
            toolName: 'read_file',
            arguments: { path: 'package.json' },
          },
        ],
      },
    ],
  });
  router.registerProvider(modelProvider);

  // 3. Setup Verification & Evidence Stores
  const evidenceStore = new DefaultEvidenceStore();
  const verificationEngine = new DefaultVerificationEngine({
    evidenceStore,
    idFactory,
    clock,
  });

  // 4. Instantiate the Runtime
  const runtime = createRuntime({
    router,
    policyEngine,
    toolExecutor,
    verificationEngine,
    evidenceStore,
    idFactory,
    clock,
  });

  // 5. Define a Goal
  const goal: Goal = {
    id: idFactory.create<'Goal'>(),
    description: 'Verify package configuration and ensure compliance with coding standards.',
    status: GoalStatus.ACTIVE,
    tasks: [],
    constraints: {
      maxIterations: 5,
      maxCostDollars: 1.0,
      maxDurationMs: 30000,
    },
    metadata: { environment: 'local-test' },
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };

  console.log(`Starting Vi-Harness execution for Goal: [${goal.id}]`);
  console.log(`Description: "${goal.description}"\n`);

  // 6. Execute Goal
  const result = await runtime.execute(goal);

  console.log('Execution Finished:');
  console.log(`- Status: ${result.status}`);
  console.log(`- Final Phase: ${result.finalPhase}`);
  console.log(`- Iterations: ${result.iterations.length}`);
  console.log(`- Total Tokens: ${result.totalTokens}`);
  console.log(`- Total Cost: $${result.totalCostDollars.toFixed(4)}`);
}

// Execute if run directly
const isDirectExecution =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    /basic-agent[\\/]index\.(ts|js)$/.test(process.argv[1]) ||
    process.argv[1].replace(/\\/g, '/').endsWith('basic-agent/index.ts'));

if (isDirectExecution) {
  runBasicAgent().catch((err) => {
    console.error('Agent execution failed:', err);
    process.exit(1);
  });
}
