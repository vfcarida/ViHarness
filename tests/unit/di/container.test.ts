/**
 * Tests for the DI Container.
 *
 * Proves:
 *   - Container can register and resolve transient services
 *   - Container can register and resolve singletons
 *   - Container can register instances directly
 *   - Singletons return the same instance on multiple resolves
 *   - Transients return different instances on multiple resolves
 *   - Resolving unregistered tokens throws
 *   - has() correctly reports registration status
 *   - resetSingletons() clears cache but preserves factories
 *   - clear() removes everything
 *   - Container supports cross-service wiring
 */
import { describe, it, expect } from 'vitest';
import { Container } from '../../../src/di/container.js';

describe('Container', () => {
  it('should register and resolve a transient service', () => {
    const container = new Container();
    const token = Symbol('test');

    container.register(token, () => ({ value: Math.random() }));

    const a = container.resolve<{ value: number }>(token);
    const b = container.resolve<{ value: number }>(token);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b); // Different instances
  });

  it('should register and resolve a singleton service', () => {
    const container = new Container();
    const token = Symbol('singleton');

    container.registerSingleton(token, () => ({ id: Math.random() }));

    const a = container.resolve<{ id: number }>(token);
    const b = container.resolve<{ id: number }>(token);

    expect(a).toBe(b); // Same instance
  });

  it('should register an instance directly', () => {
    const container = new Container();
    const token = Symbol('instance');
    const instance = { name: 'direct' };

    container.registerInstance(token, instance);

    const resolved = container.resolve(token);
    expect(resolved).toBe(instance);
  });

  it('should throw on resolving unregistered token', () => {
    const container = new Container();
    const token = Symbol('unregistered');

    expect(() => container.resolve(token)).toThrow(/No registration found for token/);
  });

  it('has() should return true for registered tokens', () => {
    const container = new Container();
    const token = Symbol('registered');

    expect(container.has(token)).toBe(false);

    container.register(token, () => 'value');
    expect(container.has(token)).toBe(true);
  });

  it('resetSingletons() should clear cached instances but keep factories', () => {
    const container = new Container();
    const token = Symbol('singleton');
    let callCount = 0;

    container.registerSingleton(token, () => {
      callCount++;
      return { call: callCount };
    });

    const a = container.resolve<{ call: number }>(token);
    expect(a.call).toBe(1);

    container.resetSingletons();

    const b = container.resolve<{ call: number }>(token);
    expect(b.call).toBe(2);
    expect(a).not.toBe(b);
  });

  it('clear() should remove all registrations', () => {
    const container = new Container();
    const token = Symbol('clearable');

    container.register(token, () => 'hello');
    expect(container.has(token)).toBe(true);

    container.clear();
    expect(container.has(token)).toBe(false);
  });

  it('should support cross-service wiring', () => {
    const container = new Container();
    const configToken = Symbol('config');
    const serviceToken = Symbol('service');

    container.registerSingleton(configToken, () => ({ dbHost: 'localhost' }));
    container.registerSingleton(serviceToken, (c) => {
      const config = c.resolve<{ dbHost: string }>(configToken);
      return { connection: `connected to ${config.dbHost}` };
    });

    const service = container.resolve<{ connection: string }>(serviceToken);
    expect(service.connection).toBe('connected to localhost');
  });

  it('register() should support method chaining', () => {
    const container = new Container();
    const t1 = Symbol('t1');
    const t2 = Symbol('t2');

    const result = container.register(t1, () => 'a').registerSingleton(t2, () => 'b');

    expect(result).toBe(container);
    expect(container.has(t1)).toBe(true);
    expect(container.has(t2)).toBe(true);
  });
});
