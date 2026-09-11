# Example: OpenAI-Compatible Agent

This example demonstrates how to wire Vi-Harness to a real **OpenAI-compatible model provider** (`OpenAICompatibleProvider`), execute a solve task against a real workspace, and observe token usage and cost telemetry.

The same `OpenAICompatibleProvider` works with:
- OpenAI API directly (`https://api.openai.com/v1`)
- Azure OpenAI Service
- OpenRouter (`https://openrouter.ai/api/v1`)
- LiteLLM proxy
- Any OpenAI-compatible endpoint

## Prerequisites

- Node.js >= 20
- An API key for an OpenAI-compatible provider
- A workspace directory to run the agent against

## Setup

```bash
cd examples/openai-agent
export OPENAI_API_KEY="sk-..."           # OpenAI key
# or
export OPENROUTER_API_KEY="sk-or-..."   # OpenRouter key
```

## Run

```bash
# From the repository root
npx tsx examples/openai-agent/index.ts
```

Or with a different provider endpoint:

```bash
OPENAI_API_KEY=$OPENROUTER_API_KEY \
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
OPENAI_MODEL=anthropic/claude-3.5-sonnet \
npx tsx examples/openai-agent/index.ts
```

## What This Example Demonstrates

1. **`OpenAICompatibleProvider` configuration** — base URL, model selection, API key injection.
2. **Retry and resilience** — configurable `maxRetries` and `requestTimeoutMs`.
3. **Cost tracking** — per-turn prompt/completion token counts and cumulative USD cost.
4. **Graceful error handling** — distinguishes auth errors, rate limits, and context window overflow.
5. **Goal constraints** — `maxIterations`, `maxCostDollars`, and `maxDurationMs` limits.
