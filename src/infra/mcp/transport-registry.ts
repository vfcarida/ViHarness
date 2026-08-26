/**
 * Transport Registry for MCP.
 *
 * Manages transport factories, enabling dynamic instantiation of built-in (stdio, http)
 * and third-party / custom transports.
 */
import type { Transport, TransportConfig } from './transports/types.js';
import { StdioTransport } from './transports/stdio-transport.js';
import { HttpTransport } from './transports/http-transport.js';

export type TransportFactory = (config?: Record<string, unknown>) => Transport;

export class TransportRegistry {
  private readonly factories = new Map<string, TransportFactory>();

  constructor() {
    // Register default built-in transports
    this.register('stdio', (opts) => new StdioTransport(opts as any));
    this.register('http', (opts) => new HttpTransport(opts as any));
    this.register('sse', (opts) => new HttpTransport(opts as any));
  }

  register(name: string, factory: TransportFactory): void {
    this.factories.set(name.toLowerCase(), factory);
  }

  create(name: string, config?: Record<string, unknown>): Transport {
    const factory = this.factories.get(name.toLowerCase());
    if (!factory) {
      throw new Error(
        `Transport [${name}] is not registered in TransportRegistry. Available: ${this.list().join(', ')}`,
      );
    }
    return factory(config);
  }

  createFromConfig(config: TransportConfig): Transport {
    return this.create(config.type, config.options);
  }

  has(name: string): boolean {
    return this.factories.has(name.toLowerCase());
  }

  list(): string[] {
    return Array.from(this.factories.keys());
  }
}
