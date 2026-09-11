/**
 * Example: Custom Tool — "Everything is a Plugin"
 *
 * Demonstrates the complete lifecycle of a custom Vi-Harness tool:
 *   defineTool -> register -> script the model to call it -> observe execution.
 *
 * No API key required — uses ScriptedModelProvider for deterministic, offline execution.
 *
 * Run:
 *   npx tsx examples/custom-tool/index.ts
 */
import {
  createRuntime,
  DefaultToolRegistry,
  DefaultToolExecutor,
  DefaultPolicyEngine,
  DefaultVerificationEngine,
  DefaultEvidenceStore,
  ScriptedModelProvider,
  UtilityModelRouter,
  UuidV7IdFactory,
  SystemClock,
  GoalStatus,
  defineTool,
  type Goal,
} from '../../src/index.js';

// ─── Step 1: Define a custom tool ────────────────────────────────────────────

const wordCountTool = defineTool({
  name: 'word_count',
  description: 'Counts the number of words in a given text string.',
  parameters: {
    text: {
      type: 'string',
      description: 'The text to count words in.',
      required: true,
    },
    include_punctuation: {
      type: 'boolean',
      description: 'If true, counts punctuation marks as separate tokens.',
      default: false,
    },
  },
  // Mark as concurrency-safe: this tool does not mutate anything, so it can run
  // in parallel with other read-safe tools (e.g., read_file, search_code).
  isConcurrencySafe: () => true,
  timeoutMs: 5_000,
  execute: async (args: { text: string; include_punctuation?: boolean }) => {
    const tokens = args.include_punctuation
      ? args.text.split(/\s+/).filter(Boolean)
      : args.text.split(/\W+/).filter(Boolean);
    return {
      word_count: tokens.length,
      character_count: args.text.length,
      input_preview: args.text.slice(0, 50),
    };
  },
});

// ─── Step 2: Run the agent ────────────────────────────────────────────────────

export async function runCustomToolExample(): Promise<void> {
  const clock = new SystemClock();
  const idFactory = new UuidV7IdFactory();

  // Register the custom tool alongside any built-in tools
  const toolRegistry = new DefaultToolRegistry();
  toolRegistry.register(wordCountTool);

  const policyEngine = new DefaultPolicyEngine();
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, policyEngine, idFactory, clock });

  // ScriptedModelProvider replays pre-recorded turns — no API key needed
  const router = new UtilityModelRouter();
  const scriptedProvider = new ScriptedModelProvider({
    providerId: 'scripted',
    modelId: 'scripted-model',
    steps: [
      {
        // Turn 1: model calls the custom word_count tool
        toolCalls: [
          {
            id: idFactory.create<'ToolCall'>(),
            name: 'word_count',
            input: {
              text: 'Vi-Harness makes it trivial to extend the agent with custom typed tools.',
              include_punctuation: false,
            },
          },
        ],
        content: 'I will count the words in the provided text using the word_count tool.',
      },
      {
        // Turn 2: model concludes after seeing tool result
        content: 'The text contains 13 words and 71 characters. Task complete.',
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
    description: 'Use the word_count tool to count words in a sample text.',
    status: GoalStatus.ACTIVE,
    tasks: [],
    constraints: { maxIterations: 5, maxCostDollars: 0.01, maxDurationMs: 30_000 },
    metadata: {},
    createdAt: clock.now(),
    updatedAt: clock.now(),
  };

  console.log('\n🔧 Custom Tool Example — "Everything is a Plugin"\n');
  console.log(`📌 Tool registered: ${wordCountTool.name}`);
  console.log(`   Parameters: text (string), include_punctuation (boolean)\n`);
  console.log(`🎯 Goal: ${goal.description}\n`);

  const result = await runtime.execute(goal);

  console.log('📊 Execution Results:');
  console.log(`   Status     : ${result.status}`);
  console.log(`   Iterations : ${result.iterations.length}`);

  for (const iteration of result.iterations) {
    for (const toolExec of iteration.toolExecutions ?? []) {
      if (toolExec.toolName === 'word_count') {
        console.log(`\n✅ word_count tool executed:`);
        console.log(`   Result: ${JSON.stringify(toolExec.result, null, 2)}`);
      }
    }
  }
}

// Execute if run directly
const isDirectExecution = process.argv[1]?.replace(/\\/g, '/').endsWith('custom-tool/index.ts');
if (isDirectExecution) {
  runCustomToolExample().catch((err: unknown) => {
    console.error('❌ Example failed:', err);
    process.exit(1);
  });
}
