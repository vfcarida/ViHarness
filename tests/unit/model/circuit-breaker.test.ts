import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../../src/infra/model/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('allows executions in CLOSED state', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3 });
    expect(breaker.currentState).toBe('CLOSED');
    expect(breaker.isAvailable).toBe(true);

    const result = await breaker.execute(async () => 'success-payload');
    expect(result).toBe('success-payload');
  });

  it('transitions from CLOSED to OPEN upon reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 1000 });

    // 1st failure
    await expect(
      breaker.execute(async () => {
        throw new Error('API down 1');
      }),
    ).rejects.toThrow('API down 1');
    expect(breaker.currentState).toBe('CLOSED');

    // 2nd failure -> opens circuit
    await expect(
      breaker.execute(async () => {
        throw new Error('API down 2');
      }),
    ).rejects.toThrow('API down 2');
    expect(breaker.currentState).toBe('OPEN');
    expect(breaker.isAvailable).toBe(false);

    // 3rd call immediately fast-fails without executing inner function
    let innerCalled = false;
    await expect(
      breaker.execute(async () => {
        innerCalled = true;
        return 'never';
      }),
    ).rejects.toThrow(/Circuit breaker is OPEN/);
    expect(innerCalled).toBe(false);
  });

  it('recovers from HALF_OPEN back to CLOSED on successful canaries', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      recoveryTimeoutMs: 50, // 50ms for testing
      successThreshold: 2,
    });

    // Trigger failure
    await expect(
      breaker.execute(async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow();
    expect(breaker.currentState).toBe('OPEN');

    // Wait for recovery timeout
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(breaker.currentState).toBe('HALF_OPEN');

    // 1st canary success
    await breaker.execute(async () => 'canary 1');
    expect(breaker.currentState).toBe('HALF_OPEN');

    // 2nd canary success -> closes circuit
    await breaker.execute(async () => 'canary 2');
    expect(breaker.currentState).toBe('CLOSED');
    expect(breaker.isAvailable).toBe(true);
  });
});
