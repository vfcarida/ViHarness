/**
 * scripts/check-readme-badge.ts
 *
 * CI guard: verifies the README.md "Tests" badge count matches the actual Vitest results.
 *
 * Usage:
 *   npx tsx scripts/check-readme-badge.ts
 *
 * Exits 0 if badge is accurate, 1 if it is stale (with a descriptive error and fix hint).
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ─── Step 1: Parse README badge ──────────────────────────────────────────────

const readmePath = resolve(ROOT, 'README.md');
const readmeContent = readFileSync(readmePath, 'utf8');

/**
 * Matches badge URL patterns such as:
 *   img.shields.io/badge/Tests-1%2C304%20Passing%20(193%20Files)
 *   img.shields.io/badge/Tests-1%2C304%20Passing%20%28193%20Files%29
 *   img.shields.io/badge/Tests-1304%20Passing%20(193%20Files)
 * Supports both literal parentheses and %28/%29 URL-encoded variants.
 */
const badgeRegex =
  /img\.shields\.io\/badge\/Tests-([0-9%2C,]+)%20Passing%20(?:%28|\()([0-9]+)%20Files(?:%29|\))/;

const badgeMatch = readmeContent.match(badgeRegex);
if (!badgeMatch) {
  console.error(
    '\u274C check-readme-badge: Could not locate the Tests badge in README.md.\n' +
      '   Expected: img.shields.io/badge/Tests-<N>%20Passing%20%28<F>%20Files%29',
  );
  process.exit(1);
}

// Decode URL-encoded commas (%2C) then strip remaining commas before parsing
const rawBadgeTests = badgeMatch[1].replace(/%2C/gi, '').replace(/,/g, '');
const badgeTests = parseInt(rawBadgeTests, 10);
const badgeFiles = parseInt(badgeMatch[2], 10);

if (isNaN(badgeTests) || isNaN(badgeFiles)) {
  console.error(
    `\u274C check-readme-badge: Could not parse badge numbers.\n` +
      `   Raw tests: "${badgeMatch[1]}", files: "${badgeMatch[2]}"`,
  );
  process.exit(1);
}

console.log(
  `\uD83D\uDCD6 README badge reports: ${badgeTests.toLocaleString()} tests / ${badgeFiles} files`,
);

// ─── Step 2: Run Vitest with JSON reporter ────────────────────────────────────

console.log('🧪 Running Vitest to get actual test counts...');

const tempOutputFile = resolve(ROOT, 'node_modules', '.vitest-badge-report.json');

try {
  execSync(`npx vitest run --reporter=json --outputFile="${tempOutputFile}"`, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 360_000,
  });
} catch {
  // Vitest may exit with non-zero on failed tests, but still writes the outputFile
}

if (!existsSync(tempOutputFile)) {
  console.error('❌ check-readme-badge: Vitest report file was not generated.');
  process.exit(1);
}

// ─── Step 3: Parse Vitest JSON output ────────────────────────────────────────

interface VitestJsonResult {
  numPassedTests?: number;
  numPassedTestSuites?: number;
  numPassedTestFiles?: number;
  numTotalTests?: number;
  numTotalTestSuites?: number;
  numTotalTestFiles?: number;
  testResults?: unknown[];
}

let vitestJson: VitestJsonResult;

try {
  const content = readFileSync(tempOutputFile, 'utf8');
  vitestJson = JSON.parse(content) as VitestJsonResult;
} catch {
  console.error('❌ check-readme-badge: Could not parse Vitest JSON output file.');
  process.exit(1);
} finally {
  try {
    unlinkSync(tempOutputFile);
  } catch {
    // ignore
  }
}

const actualTests = vitestJson.numPassedTests ?? vitestJson.numTotalTests ?? 0;
const actualFiles = Array.isArray(vitestJson.testResults)
  ? vitestJson.testResults.length
  : (vitestJson.numPassedTestFiles ?? vitestJson.numTotalTestFiles ?? 0);

console.log(
  `\u2705 Vitest reports:      ${actualTests.toLocaleString()} tests / ${actualFiles} files`,
);

// ─── Step 4: Compare and report ──────────────────────────────────────────────

if (actualTests !== badgeTests || actualFiles !== badgeFiles) {
  const encodedTests = actualTests.toLocaleString('en-US').replace(/,/g, '%2C');
  console.error(
    `\n\u274C README badge is STALE.\n` +
      `\n` +
      `   Badge says : ${badgeTests.toLocaleString()} tests / ${badgeFiles} files\n` +
      `   Actual     : ${actualTests.toLocaleString()} tests / ${actualFiles} files\n` +
      `\n` +
      `   Fix: Update the Tests badge URL in README.md to:\n` +
      `   Tests-${encodedTests}%20Passing%20%28${actualFiles}%20Files%29\n`,
  );
  process.exit(1);
}

console.log(
  `\n\u2705 README badge is accurate. (${actualTests.toLocaleString()} tests / ${actualFiles} files)\n`,
);
process.exit(0);
