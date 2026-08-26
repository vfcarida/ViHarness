/**
 * Audit Integrity Signer Unit Tests.
 *
 * Verifies cryptographic HMAC SHA-256 generation, tamper detection, and verification.
 */
import { describe, it, expect } from 'vitest';
import { AuditIntegritySigner, SecretScrubber } from '../../../src/infra/index.js';

describe('AuditIntegritySigner & SecretScrubber Unit Tests', () => {
  it('signs payloads and verifies authenticity, detecting any payload tampering', () => {
    const signer = new AuditIntegritySigner({
      secretKey: 'top-secret-signing-key',
      keyId: 'aud-key-1',
    });

    const journalEntry = {
      executionId: 'exec_123',
      phase: 'EXECUTE',
      toolCalled: 'write_file',
      path: 'src/main.ts',
      timestamp: '2026-08-14T10:00:00.000Z',
    };

    const signed = signer.sign(journalEntry);
    expect(signed.signature).toBeDefined();
    expect(signed.algorithm).toBe('HMAC-SHA256');

    // 1. Valid Signature Check
    expect(signer.verify(signed)).toBe(true);

    // 2. Tampered Payload Check
    const tamperedPayload = {
      ...signed,
      payload: {
        ...journalEntry,
        path: 'src/malicious.ts', // Injected alteration
      },
    };
    expect(signer.verify(tamperedPayload)).toBe(false);
  });

  it('detects high-entropy secret tokens using Shannon entropy analysis', () => {
    // High-entropy 40-char random token
    const highEntropyKey = 'dF9kL2xQ8zW1vN5bY4cT7mK0jH3gA6sE9rX2vC1bN4=';
    const textWithSecret = `API token is: ${highEntropyKey} for service.`;

    const scrubbed = SecretScrubber.scrub(textWithSecret);
    expect(scrubbed).toContain('[REDACTED_HIGH_ENTROPY_SECRET]');
    expect(scrubbed).not.toContain(highEntropyKey);
  });
});
