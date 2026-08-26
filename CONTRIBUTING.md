# Contributing to Vi-Harness

Thank you for your interest in contributing to **Vi-Harness**! 

Vi-Harness is an open-source coding agent harness built by studying, synthesizing, and improving upon proven patterns from leading reference systems (Claude Code, Aider, Prime Agent, Hermes, Pi, Meta-Harness, and DeepSeek Harness). We welcome community contributions of all kinds — from bug fixes and documentation improvements to new tools, transports, and model providers.

---

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Running Tests & Verification](#running-tests--verification)
3. [Code Style & Quality](#code-style--quality)
4. [Commit Message Format](#commit-message-format)
5. [Pull Request Process](#pull-request-process)
6. [Architecture Overview](#architecture-overview)
7. [Extending Vi-Harness](#extending-vi-harness)
   - [Adding a New Tool](#adding-a-new-tool)
   - [Adding a New MCP Transport](#adding-a-new-mcp-transport)
   - [Adding a New Model Provider](#adding-a-new-model-provider)
8. [Reporting Security Issues](#reporting-security-issues)

---

## Development Environment Setup

### Prerequisites
- **Node.js**: `>= 20.0.0` (v22 LTS recommended)
- **npm**: `>= 10.0.0`
- **Git**: `>= 2.30.0`

### Initial Setup

```bash
# 1. Clone the repository
git clone https://github.com/vfcarida/Vi-Harness.git
cd Vi-Harness

# 2. Install dependencies (using exact lockfile)
npm ci

# 3. Verify baseline build and test passes
npm run typecheck
npm run lint
npm test
```

---

## Running Tests & Verification

Vi-Harness maintains strict test coverage across unit, integration, and live suites.

```bash
# Run all unit and integration tests
npm test

# Run unit tests only (fast, no network, no secrets)
npm run test:unit

# Run integration tests (mocked providers, real Git / SQLite)
npm run test:integration

# Run live provider tests (requires API keys; opt-in only)
npm run test:live

# Run test coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Testing Invariants
- **Unit tests require no external network or API secrets.** Mock all external I/O.
- **Integration tests clean up after themselves.** Temporary workspaces and SQLite databases must use sandbox directories and be cleanly deleted after test runs.
- **All security changes must include regression tests** under `tests/unit/security/`.

---

## Code Style & Quality

We enforce strict TypeScript typing, ESLint rules, and Prettier formatting.

```bash
# Check TypeScript compilation without emitting files
npm run typecheck

# Check code formatting with Prettier
npm run format:check

# Auto-format codebase
npm run format

# Run ESLint across src/ and tests/
npm run lint
```

### Guidelines
- **Strict TypeScript**: Avoid `any` where possible. Use explicit interface contracts.
- **Reference Attribution**: When implementing or porting a pattern from a reference architecture (Claude Code, Aider, Hermes, Pi, Prime Agent, Meta-Harness, DeepSeek Harness), add a one-line module-level comment at the top of the file:
  ```typescript
  // Pattern: 5-stage compaction pipeline (ref: Claude Code)
  ```
- **Error Handling**: Throw typed domain errors inheriting from `BaseError` in `src/core/errors/`.

---

## Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

### Allowed Types
- `feat`: A new feature or capability
- `fix`: A bug fix
- `docs`: Documentation updates or additions
- `refactor`: Code restructuring without changing external behavior
- `test`: Adding or updating test suites
- `perf`: Performance optimizations
- `security`: Security patches, policy rules, or perimeter hardening
- `chore`: Build scripts, dependencies, or toolchain maintenance

### Examples
```bash
feat(compiler): implement cache-aware token pruning for prefix optimization
fix(security): sanitize path traversal in workspace file resolver
docs(readme): add deepseek harness architectural reference attribution
test(session): add session tree branching recovery test
```

---

## Pull Request Process

1. **Create a Feature Branch**:
   ```bash
   git checkout -b feat/my-new-feature
   ```
2. **Implement & Test**: Ensure all tests pass (`npm test`) and typechecks succeed (`npm run typecheck`).
3. **Commit Cleanly**: Use Conventional Commits format.
4. **Push & Open PR**:
   - Provide a clear summary of what changed and why.
   - Reference any relevant issues or reference patterns.
   - Confirm CI passes all automated checks.
5. **Code Review**: PRs touching `src/core/` or `src/infra/security/` require explicit maintainer review.

---

## Architecture Overview

Vi-Harness enforces a strict **inward dependency contract**:

```
┌─────────────────────────────────────────────────────────┐
│                       CLI Layer                         │
├─────────────────────────────────────────────────────────┤
│                     Runtime Layer                       │
│    (iteration loop, state machine, architect mode)      │
├─────────────────────────────────────────────────────────┤
│                  Infrastructure Layer                   │
│   (MCP, SQLite storage, security sandbox, compilers)    │
├─────────────────────────────────────────────────────────┤
│                      Core Layer                         │
│       (domain entities, interfaces, zero dependencies)  │
└─────────────────────────────────────────────────────────┘
```

- **`src/core/`**: Zero external dependencies. Contains pure domain logic, entities, and interface contracts.
- **`src/infra/`**: Infrastructure implementations (SQLite storage, MCP transports, security perimeter, model clients).
- **`src/runtime/`**: Agent execution loop, state machine orchestrator, tool validators, and architect execution.
- **`src/cli/`**: Command-line entrypoints, benchmark runners, and TUI dashboards.

---

## Extending Vi-Harness

### Adding a New Tool

1. Define the tool inputs/outputs and register using `ToolDefinition`:
   ```typescript
   import type { ToolDefinition, ToolExecutionContext, ToolResult } from './core/interfaces/tool.js';

   export const myCustomTool: ToolDefinition = {
     name: 'my_custom_tool',
     description: 'Performs a custom operation on the workspace',
     parameters: {
       type: 'object',
       properties: {
         target: { type: 'string', description: 'Target path or identifier' },
       },
       required: ['target'],
     },
     async execute(args: { target: string }, context: ToolExecutionContext): Promise<ToolResult> {
       // Implementation with safety checks
       return { success: true, output: `Processed ${args.target}` };
     },
   };
   ```
2. Register the tool in `DefaultToolRegistry` (`src/infra/tools/default-tool-registry.ts`).
3. Add security validation rules in `src/infra/security/` if the tool interacts with the filesystem or executes processes.

### Adding a New MCP Transport

1. Implement the `McpTransport` interface from `src/core/interfaces/mcp-transport.ts`:
   ```typescript
   import type { McpTransport, McpMessage } from '../../core/interfaces/mcp-transport.js';

   export class CustomMcpTransport implements McpTransport {
     readonly type = 'custom';

     async connect(): Promise<void> { /* ... */ }
     async send(message: McpMessage): Promise<void> { /* ... */ }
     async close(): Promise<void> { /* ... */ }
   }
   ```
2. Register the transport in `TransportRegistry` (`src/infra/mcp/transport-registry.ts`).
3. Add unit and integration tests under `tests/unit/mcp/` and `tests/integration/mcp-transports-e2e.test.ts`.

### Adding a New Model Provider

1. Implement the `ModelProvider` interface from `src/core/interfaces/model-provider.ts`:
   ```typescript
   import type { ModelProvider, ModelRequest, ModelResponse } from '../../core/interfaces/model-provider.js';

   export class CustomProvider implements ModelProvider {
     readonly providerId = 'custom-provider';

     async generate(request: ModelRequest): Promise<ModelResponse> {
       // Transform request, call API, parse response into ModelResponse format
     }

     async stream(request: ModelRequest, onChunk: (chunk: string) => void): Promise<ModelResponse> {
       // Streaming implementation
     }
   }
   ```
2. Register the provider in `ModelRouter` (`src/infra/router/`) and dependency injection container (`src/di/`).
3. Add tests verifying request serialization, token usage tracking, and fault tolerance.

---

## Reporting Security Issues

Please do not report security vulnerabilities via public GitHub issues.

Review our [Security Policy](SECURITY.md) for responsible disclosure guidelines.
