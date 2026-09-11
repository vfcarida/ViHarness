/**
 * Unit tests for the README badge parsing logic used by scripts/check-readme-badge.ts.
 *
 * We test the core regex and numeric-parsing rules in isolation so the CI gate
 * has its own correctness signal, independent of running the full Vitest suite.
 */
import { describe, it, expect } from 'vitest';

// ─── Re-implement the badge parser inline (same logic as the script) ──────────

const BADGE_REGEX =
  /img\.shields\.io\/badge\/Tests-([0-9%2C,]+)%20Passing%20(?:%28|\()([0-9]+)%20Files(?:%29|\))/;

function parseBadge(readmeContent: string): { tests: number; files: number } | null {
  const match = readmeContent.match(BADGE_REGEX);
  if (!match) return null;

  const rawTests = match[1].replace(/%2C/gi, '').replace(/,/g, '');
  const tests = parseInt(rawTests, 10);
  const files = parseInt(match[2], 10);

  if (isNaN(tests) || isNaN(files)) return null;
  return { tests, files };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('check-readme-badge parser', () => {
  describe('parseBadge', () => {
    it('parses a URL-encoded comma badge correctly (e.g. 1%2C304 -> 1304)', () => {
      const readme = [
        '[![Tests](https://img.shields.io/badge/Tests-1%2C304%20Passing%20%28193%20Files%29',
        '-brightgreen.svg)](https://example.com)',
      ].join('');

      const result = parseBadge(readme);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(1304);
      expect(result!.files).toBe(193);
    });

    it('parses a badge without a comma separator (e.g. small suite)', () => {
      const readme =
        '[![Tests](https://img.shields.io/badge/Tests-56%20Passing%20%2828%20Files%29-brightgreen.svg)]()';

      const result = parseBadge(readme);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(56);
      expect(result!.files).toBe(28);
    });

    it('returns null when no Tests badge is present', () => {
      const readme =
        '[![CI](https://github.com/org/repo/actions/workflows/ci.yml/badge.svg)]()';

      expect(parseBadge(readme)).toBeNull();
    });

    it('returns null when the badge has a malformed numeric segment', () => {
      // Deliberately malformed: letters in the test count position
      const readme =
        'img.shields.io/badge/Tests-NaN%20Passing%20%28193%20Files%29';

      expect(parseBadge(readme)).toBeNull();
    });

    it('parses a zero-test suite (edge case)', () => {
      const readme =
        'img.shields.io/badge/Tests-0%20Passing%20%280%20Files%29';

      const result = parseBadge(readme);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(0);
      expect(result!.files).toBe(0);
    });

    it('strips plain commas as well as %2C (both encoding variants)', () => {
      // Some badge generators encode commas as literal commas, not %2C
      const readme =
        'img.shields.io/badge/Tests-1,304%20Passing%20%28193%20Files%29';

      const result = parseBadge(readme);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(1304);
      expect(result!.files).toBe(193);
    });

    it('matches the exact badge URL format used in Vi-Harness README (literal parens)', () => {
      // Snapshot of the actual README badge after Track 1 update — shields.io uses literal parens
      const viHarnessReadmeBadge =
        '[![Tests](https://img.shields.io/badge/Tests-1%2C304%20Passing%20(193%20Files)-brightgreen.svg?style=for-the-badge&logo=vitest)](https://github.com/vfcarida/Vi-Harness/actions)';

      const result = parseBadge(viHarnessReadmeBadge);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(1304);
      expect(result!.files).toBe(193);
    });

    it('matches encoded-paren badge URL variant (%28/%29)', () => {
      // Alternative variant with %28/%29 URL-encoded parentheses
      const encodedParenBadge =
        'img.shields.io/badge/Tests-1%2C304%20Passing%20%28193%20Files%29';

      const result = parseBadge(encodedParenBadge);
      expect(result).not.toBeNull();
      expect(result!.tests).toBe(1304);
      expect(result!.files).toBe(193);
    });
  });
});
