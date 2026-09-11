#!/usr/bin/env node
/**
 * mock-judge.js — Simulates a SWE-bench-style judge for the swe-bench-harness example.
 *
 * Verdict logic:
 *   - If a file named "solution.ts" exists and contains "export function", exit 0 (AC).
 *   - Otherwise exit 1 (WA/CE) with diagnostic feedback.
 *
 * Usage:
 *   node mock-judge.js [--workspace /path/to/workspace]
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const args = process.argv.slice(2);
let workspace = '.';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace' && args[i + 1]) {
    workspace = args[i + 1];
    i++;
  }
}

const solutionPath = path.join(workspace, 'solution.ts');

if (fs.existsSync(solutionPath)) {
  const content = fs.readFileSync(solutionPath, 'utf8');
  if (content.includes('export function')) {
    console.log('VERDICT: AC');
    console.log('All test cases passed.');
    process.exit(0);
  } else {
    console.log('VERDICT: CE');
    console.log('Compilation Error: solution.ts must export at least one function.');
    process.exit(1);
  }
} else {
  console.log('VERDICT: WA');
  console.log('Wrong Answer: solution.ts not found in workspace.');
  console.log(`Expected file: ${solutionPath}`);
  process.exit(1);
}
