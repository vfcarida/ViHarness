# Example: Custom Tool — "Everything is a Plugin"

This example demonstrates Vi-Harness's **"Everything is a Plugin"** architecture by defining a custom tool using the `defineTool` DSL, registering it in the tool registry, and running the agent to observe it executing.

## What This Example Demonstrates

1. **`defineTool` DSL** — Typed parameter declaration with JSON Schema auto-generation.
2. **Concurrency safety classification** — Marking a tool as `isConcurrencySafe: true` to allow parallel execution.
3. **Tool registration** — Adding a custom tool to `DefaultToolRegistry`.
4. **Tool execution observation** — Viewing the execution trace in the result output.
5. **ScriptedModelProvider** — Using a pre-recorded turn script for deterministic, API-key-free execution.

## Run

```bash
# From the repository root — no API key required
npx tsx examples/custom-tool/index.ts
```

## Extending This Example

To add your custom tool to a real agent:
1. Copy the `defineTool` block.
2. Replace the `ScriptedModelProvider` with your real provider.
3. Add security validation in `src/infra/security/` if the tool interacts with the filesystem or shell.
