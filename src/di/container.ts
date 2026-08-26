/**
 * Lightweight dependency injection container.
 *
 * A simple typed service locator with factory registration.
 * Avoids decorator-based DI frameworks (InversifyJS, tsyringe) for:
 *   - Transparency: no hidden metadata or reflection magic
 *   - Debuggability: factory functions are plain, inspectable code
 *   - Portability: no dependency on TypeScript decorators or reflect-metadata
 *
 * Supports:
 *   - Transient registrations (new instance per resolve)
 *   - Singleton registrations (lazily created, cached)
 *   - Container reset (clears singleton cache, useful in tests)
 */

export type Token = symbol | string;
export type Factory<T> = (container: Container) => T;

export class Container {
  private readonly factories = new Map<Token, Factory<unknown>>();
  private readonly singletons = new Map<Token, unknown>();
  private readonly singletonTokens = new Set<Token>();

  /**
   * Register a transient factory — each resolve() creates a new instance.
   */
  register<T>(token: Token, factory: Factory<T>): this {
    this.factories.set(token, factory as Factory<unknown>);
    this.singletonTokens.delete(token);
    this.singletons.delete(token);
    return this;
  }

  /**
   * Register a singleton factory — first resolve() creates and caches the instance.
   */
  registerSingleton<T>(token: Token, factory: Factory<T>): this {
    this.factories.set(token, factory as Factory<unknown>);
    this.singletonTokens.add(token);
    this.singletons.delete(token); // Clear stale cache
    return this;
  }

  /**
   * Register an already-constructed instance as a singleton.
   */
  registerInstance<T>(token: Token, instance: T): this {
    this.factories.set(token, () => instance);
    this.singletonTokens.add(token);
    this.singletons.set(token, instance);
    return this;
  }

  /**
   * Resolve a service by its token.
   * @throws Error if no factory is registered for the token.
   */
  resolve<T>(token: Token): T {
    // Return cached singleton if available
    if (this.singletonTokens.has(token) && this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }

    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`No registration found for token: ${token.toString()}`);
    }

    const instance = factory(this) as T;

    // Cache if singleton
    if (this.singletonTokens.has(token)) {
      this.singletons.set(token, instance);
    }

    return instance;
  }

  /**
   * Check whether a token has a registered factory.
   */
  has(token: Token): boolean {
    return this.factories.has(token);
  }

  /**
   * Clear the singleton cache. Factories remain registered.
   * Useful for test isolation between test cases.
   */
  resetSingletons(): void {
    this.singletons.clear();
  }

  /**
   * Clear all registrations and cached singletons.
   */
  clear(): void {
    this.factories.clear();
    this.singletons.clear();
    this.singletonTokens.clear();
  }
}
