#!/usr/bin/env node
/**
 * Official Vi-Harness Benchmark Runner CLI.
 *
 * Usage:
 *   npm run benchmark -- [options]
 *   npx tsx src/cli/benchmark-cli.ts [options]
 */
import { runBenchmarkCli } from './commands/benchmark.js';

export { runBenchmarkCli as runCli };

if (
  process.argv[1] &&
  (process.argv[1].endsWith('benchmark-cli.ts') || process.argv[1].endsWith('benchmark-cli.js'))
) {
  runBenchmarkCli().then((code) => {
    if (code !== 0) process.exit(code);
  }).catch((err) => {
    console.error('Benchmark execution failed:', err);
    process.exit(1);
  });
}
