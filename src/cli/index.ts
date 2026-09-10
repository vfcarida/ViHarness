#!/usr/bin/env node
/**
 * Vi-Harness — Command Line Interface (CLI).
 *
 * Synthesizes patterns from Claude Code, Aider, Prime Agent, Hermes, Pi, and Meta-Harness.
 */
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { triggerBackgroundUpdateCheck } from './update-check.js';
import { ProfileLoader } from '../infra/profile/profile-loader.js';
import { ProfileManager } from '../infra/profile/profile-manager.js';

const VERSION = '0.2.0';

export function printHelp(): void {
  console.log(`
Vi-Harness — Enterprise-Grade Coding Agent Harness (v${VERSION})

USAGE:
  vi-harness [command] [options]
  vi-harness -p "<task>" [options]
  vih [command] [options]

COMMANDS:
  chat, repl [options]                 Interactive terminal REPL session (with slash commands)
  solve [options]                      Run autonomous coding agent on target repository (-p "<prompt>")
  sessions <list|show|resume|branch>   Manage persisted SQLite sessions and tree branches
  mcp <start>                         Start Model Context Protocol (MCP) server
  acp <start>                         Start Agent Client Protocol (ACP) automation server
  bench                               Run canonical benchmark evaluation suite
  bench:context                       Run multi-horizon context efficiency benchmark
  bench:tbench                        Run Terminal-Bench (TBench 2.0 / Harbor) suite
  bench:projdevbench                  Run ProjDevBench project construction evaluation

OPTIONS:
  -p, --prompt, --message <task>       Directly solve a coding task in the current workspace
  --profile <name>                     Launch with distribution profile (web, headless, ci, eval, custom)
  --version, -v                        Print version information
  --help, -h                           Print this help message

PROFILES:
  web                    Web UI + API server with MCP & SQLite persistence
  headless               One-shot task runner for headless CI & automation
  ci                     Automated benchmark and report generation mode
  eval                   TBench + ProjDevBench evaluation runner
  custom                 User-defined profile from ~/.vi-harness/profiles/

EXAMPLES:
  vi-harness chat
  vi-harness solve -p "Implement binary search in search.py"
  vi-harness -p "Fix CMake build errors" --cwd ./my-project
  vi-harness sessions list --limit 10
  vi-harness bench:tbench --tasks test-env-task --mode eval
  vi-harness mcp start --transport http --port 3000
`);
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  // Fire background update check (non-blocking)
  triggerBackgroundUpdateCheck(VERSION);

  // If invoked with no arguments in an interactive terminal, launch interactive REPL
  if (args.length === 0) {
    if (process.stdin.isTTY) {
      const { runChatCli } = await import('./commands/chat.js');
      return runChatCli([]);
    }
    printHelp();
    return 0;
  }

  if (args.includes('--help') || args.includes('-h')) {
    // If help was requested with solve subcommand
    if (args[0] === 'solve') {
      const { runSolveCli } = await import('./commands/solve.js');
      return runSolveCli(args.slice(1));
    }
    if (args[0] === 'chat' || args[0] === 'repl') {
      const { runChatCli } = await import('./commands/chat.js');
      return runChatCli(args.slice(1));
    }
    if (args[0] === 'bench' || args[0] === 'benchmark') {
      const { runBenchmarkCli } = await import('./commands/benchmark.js');
      return runBenchmarkCli(args.slice(1));
    }
    printHelp();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`vi-harness v${VERSION}`);
    return 0;
  }

  // 1. Solve command routing (explicit or via -p / --prompt / --message shorthand)
  if (
    args[0] === 'solve' ||
    args[0] === '-p' ||
    args[0] === '--prompt' ||
    args[0] === '--message' ||
    (!args.includes('--profile') && (args.includes('-p') || args.includes('--prompt') || args.includes('--message')))
  ) {
    const solveArgs = args[0] === 'solve' ? args.slice(1) : args;
    const { runSolveCli } = await import('./commands/solve.js');
    return runSolveCli(solveArgs);
  }

  // 2. Profile flag handling (requires explicit --profile)
  const profileFlagIdx = args.findIndex((a) => a === '--profile');
  if (profileFlagIdx >= 0) {
    const profileName = args[profileFlagIdx + 1];
    if (!profileName) {
      console.error('Error: --profile requires a profile name (e.g. web, headless, ci, custom)');
      return 1;
    }

    try {
      const loader = new ProfileLoader();
      const manager = new ProfileManager();
      const config = await loader.loadProfile(profileName);
      const resolved = manager.resolveProfile(config);
      manager.applyEnvironment(resolved);

      console.log(`🚀 Activated profile: ${resolved.name} (${resolved.description})`);
      console.log(`📦 Active bundles: ${resolved.activeBundles.join(', ')}`);
      return 0;
    } catch (err: any) {
      console.error(`❌ Error loading profile '${profileName}':`, err.message);
      return 1;
    }
  }

  const [command, ...subArgs] = args;

  switch (command) {
    case 'chat':
    case 'repl': {
      const { runChatCli } = await import('./commands/chat.js');
      return runChatCli(subArgs);
    }
    case 'sessions': {
      const { runSessionsCli } = await import('./commands/sessions.js');
      await runSessionsCli(subArgs);
      return 0;
    }
    case 'mcp': {
      const { runMcpCli } = await import('./commands/mcp.js');
      await runMcpCli(subArgs);
      return 0;
    }
    case 'acp': {
      const { runAcpCli } = await import('./commands/acp.js');
      await runAcpCli(subArgs);
      return 0;
    }
    case 'bench':
    case 'benchmark': {
      const { runBenchmarkCli } = await import('./commands/benchmark.js');
      return runBenchmarkCli(subArgs);
    }
    case 'bench:context': {
      const { runContextCli } = await import('./context-benchmark-cli.js');
      return runContextCli(subArgs);
    }
    case 'bench:tbench': {
      const { runTBenchCli } = await import('./commands/tbench.js');
      await runTBenchCli(subArgs);
      return 0;
    }
    case 'bench:projdevbench': {
      const { runProjDevBenchCli } = await import('./projdevbench-eval.js');
      await runProjDevBenchCli(subArgs);
      return 0;
    }
    default: {
      console.error(
        `Unknown command: '${command}'. Run 'vi-harness --help' for available commands.`,
      );
      return 1;
    }
  }
}

// Robust direct execution / symlink detection
function checkIsMain(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) return false;

  const currentUrlPath = fileURLToPath(import.meta.url);

  try {
    const resolvedReal = path.resolve(fs.realpathSync(scriptPath));
    if (resolvedReal === path.resolve(currentUrlPath)) return true;
  } catch {
    // Ignore realpath error if file is in-memory
  }

  const normalized = scriptPath.replace(/\\/g, '/');
  return (
    normalized.endsWith('/cli/index.js') ||
    normalized.endsWith('/cli/index.ts') ||
    normalized.endsWith('/vi-harness') ||
    normalized.endsWith('/vih') ||
    path.resolve(scriptPath) === path.resolve(currentUrlPath)
  );
}

if (checkIsMain()) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
