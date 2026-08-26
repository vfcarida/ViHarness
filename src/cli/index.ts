#!/usr/bin/env node
/**
 * Vi-Harness — Command Line Interface (CLI).
 *
 * Synthesizes patterns from Claude Code, Aider, Prime Agent, Hermes, Pi, and Meta-Harness.
 */
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { triggerBackgroundUpdateCheck } from './update-check.js';
import { ProfileLoader } from '../infra/profile/profile-loader.js';
import { ProfileManager } from '../infra/profile/profile-manager.js';

const VERSION = '0.1.0';

export function printHelp(): void {
  console.log(`
Vi-Harness — Enterprise-Grade Coding Agent Harness (v${VERSION})

USAGE:
  vi-harness [command] [options]
  vih [command] [options]

COMMANDS:
  sessions <list|show|resume|branch>   Manage persisted SQLite sessions and tree branches
  mcp <start>                         Start Model Context Protocol (MCP) server
  acp <start>                         Start Agent Client Protocol (ACP) automation server
  bench                               Run canonical benchmark evaluation suite
  bench:context                       Run multi-horizon context efficiency benchmark
  bench:tbench                        Run Terminal-Bench (TBench 2.0 / Harbor) suite
  bench:projdevbench                  Run ProjDevBench project construction evaluation

OPTIONS:
  --profile, -p <name>   Launch with distribution profile (web, headless, ci, eval, custom)
  --version, -v          Print version information
  --help, -h             Print this help message

PROFILES:
  web                    Web UI + API server with MCP & SQLite persistence
  headless               One-shot task runner for headless CI & automation
  ci                     Automated benchmark and report generation mode
  eval                   TBench + ProjDevBench evaluation runner
  custom                 User-defined profile from ~/.vi-harness/profiles/

EXAMPLES:
  vi-harness --profile headless
  vi-harness sessions list --limit 10
  vi-harness bench:tbench --tasks test-env-task --mode eval
  vi-harness mcp start --transport http --port 3000
`);
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  // Fire background update check (non-blocking)
  triggerBackgroundUpdateCheck(VERSION);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(`vi-harness v${VERSION}`);
    return 0;
  }

  // Profile flag handling
  const profileFlagIdx = args.findIndex((a) => a === '--profile' || a === '-p');
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
      const { runCli: runBenchCli } = await import('./benchmark-cli.js');
      return runBenchCli(subArgs);
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

// Direct execution
const isMain =
  process.argv[1] &&
  (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    /([\\/]cli[\\/]index\.(js|ts)|[\\/]vi-harness|[\\/]vih)$/.test(process.argv[1]) ||
    process.argv[1].replace(/\\/g, '/').endsWith('cli/index.js') ||
    process.argv[1].replace(/\\/g, '/').endsWith('cli/index.ts'));

if (isMain) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
