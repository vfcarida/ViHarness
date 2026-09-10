import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OjFeedbackIngester } from '../../../src/infra/eval/oj-feedback-ingester.js';

describe('OjFeedbackIngester', () => {
  it('parses structured JSON object directly', () => {
    const feedback = OjFeedbackIngester.parseFeedback({
      verdict: 'TLE',
      timeUsedMs: 2500,
      memoryUsedKb: 65536,
      failedTestCase: 'test_case_03.in',
    });

    expect(feedback.verdict).toBe('TLE');
    expect(feedback.timeUsedMs).toBe(2500);
    expect(feedback.memoryUsedKb).toBe(65536);
    expect(feedback.failedTestCase).toBe('test_case_03.in');
    expect(feedback.source).toBe('object');
  });

  it('parses inline JSON string with various verdict aliases', () => {
    const jsonStr = JSON.stringify({
      status: 'COMPILE_ERROR',
      compile_error: 'fatal error: bits/stdc++.h: No such file or directory',
      score: 0,
    });

    const feedback = OjFeedbackIngester.parseFeedback(jsonStr);
    expect(feedback.verdict).toBe('CE');
    expect(feedback.score).toBe(0);
    expect(feedback.compilerErrorOutput).toContain('bits/stdc++.h');
    expect(feedback.source).toBe('inline-json');
  });

  it('parses from external JSON file on disk and resolves cwd', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-oj-test-'));
    const feedbackFilePath = path.join(tempDir, 'result.json');
    fs.writeFileSync(
      feedbackFilePath,
      JSON.stringify({
        verdict: 'MLE',
        memory_kb: 524288,
        summary: 'Process was terminated: out of memory allocating dynamic vector buffer',
      }),
    );

    try {
      // Test absolute path
      const parsedAbs = OjFeedbackIngester.parseFeedback(feedbackFilePath);
      expect(parsedAbs.verdict).toBe('MLE');
      expect(parsedAbs.memoryUsedKb).toBe(524288);
      expect(parsedAbs.source).toBe(feedbackFilePath);

      // Test relative path with cwd
      const parsedRel = OjFeedbackIngester.parseFeedback('result.json', tempDir);
      expect(parsedRel.verdict).toBe('MLE');
      expect(parsedRel.feedbackSummary).toContain('out of memory');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes ACMOJ and standard verdicts (AC, WA, RE)', () => {
    expect(OjFeedbackIngester.parseFeedback({ verdict: 'Accepted' }).verdict).toBe('AC');
    expect(OjFeedbackIngester.parseFeedback({ verdict: 'Wrong Answer' }).verdict).toBe('WA');
    expect(OjFeedbackIngester.parseFeedback({ verdict: 'RUNTIME_ERROR' }).verdict).toBe('RE');
    expect(OjFeedbackIngester.parseFeedback({ verdict: 'TIME_LIMIT_EXCEEDED' }).verdict).toBe('TLE');
    expect(OjFeedbackIngester.parseFeedback({ verdict: 'MEMORY_LIMIT_EXCEEDED' }).verdict).toBe('MLE');
  });

  it('formats comprehensive feedback prompt for compilation error (CE)', () => {
    const prompt = OjFeedbackIngester.formatFeedbackPrompt({
      verdict: 'CE',
      compilerErrorOutput: 'error: no matching function for call to std::vector<int>::push_back',
      source: 'inline-json',
    });

    expect(prompt).toContain('[ONLINE JUDGE / BENCHMARK FEEDBACK INGESTION]');
    expect(prompt).toContain('verdict: [CE]');
    expect(prompt).toContain('COMPILATION ERROR');
    expect(prompt).toContain('no matching function for call');
    expect(prompt).toContain('CMakeLists.txt');
  });

  it('formats comprehensive feedback prompt for TLE and MLE', () => {
    const tlePrompt = OjFeedbackIngester.formatFeedbackPrompt({
      verdict: 'TLE',
      timeUsedMs: 5000,
    });
    expect(tlePrompt).toContain('TIME LIMIT EXCEEDED');
    expect(tlePrompt).toContain('Time Elapsed: 5000ms');
    expect(tlePrompt).toContain('algorithmic complexity');

    const mlePrompt = OjFeedbackIngester.formatFeedbackPrompt({
      verdict: 'MLE',
      memoryUsedKb: 262144, // 256 MB
    });
    expect(mlePrompt).toContain('MEMORY LIMIT EXCEEDED');
    expect(mlePrompt).toContain('256.00 MB');
    expect(mlePrompt).toContain('dynamic allocations');
  });

  it('formats comprehensive feedback prompt for WA and RE', () => {
    const waPrompt = OjFeedbackIngester.formatFeedbackPrompt({
      verdict: 'WA',
      expectedOutput: '42',
      actualOutput: '0',
      failedTestCase: 'test_large_prime.in',
    });
    expect(waPrompt).toContain('WRONG ANSWER');
    expect(waPrompt).toContain('Expected: 42');
    expect(waPrompt).toContain('Actual:   0');
    expect(waPrompt).toContain('Failed Test Case: test_large_prime.in');

    const rePrompt = OjFeedbackIngester.formatFeedbackPrompt({
      verdict: 'RE',
      runtimeErrorOutput: 'Segmentation fault (core dumped)',
    });
    expect(rePrompt).toContain('RUNTIME ERROR');
    expect(rePrompt).toContain('Segmentation fault');
  });
});
