// Pattern: Everything is a Plugin via capability seams (ref: DeepSeek Harness, Cordis)
/**
 * PluginContext implementation.
 *
 * Provides service registration, pub/sub event routing, waterfall interception,
 * dependency waiting, and reversible effect unwinding (LIFO).
 */
import type { Plugin, Disposer, PluginRecord } from './plugin.js';
import { PluginState } from './plugin.js';
import type { ServiceMap } from './service-map.js';
import type { EventMap, EventHandler } from './event-map.js';
import type {
  WaterfallMap,
  WaterfallArgs,
  WaterfallReturn,
  WaterfallHandler,
} from './waterfall.js';
import { WaterfallEngine } from './waterfall.js';
import { HarnessError } from '../errors/base-error.js';
import { ErrorCode, ErrorCategory } from '../errors/error-codes.js';

export class MissingServiceError extends HarnessError {
  constructor(serviceKey: string, requestingPlugin?: string) {
    super({
      code: ErrorCode.CONFIG_MISSING,
      category: ErrorCategory.CONFIGURATION,
      message: requestingPlugin
        ? `Plugin [${requestingPlugin}] requires missing service [${serviceKey}]. Ensure the provider plugin is loaded first.`
        : `Service [${serviceKey}] is not registered in PluginContext.`,
    });
  }
}

export interface PluginContext {
  // Service registration
  provide<K extends keyof ServiceMap>(key: K, service: ServiceMap[K]): Disposer;

  // Event system
  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): Disposer;
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void;
  waterfall<K extends keyof WaterfallMap>(
    event: K,
    ...args: WaterfallArgs<K>
  ): Promise<WaterfallReturn<K>>;
  intercept<K extends keyof WaterfallMap>(event: K, handler: WaterfallHandler<K>): Disposer;

  // Reversible effect registration
  effect(setup: () => Disposer | undefined | Promise<Disposer | undefined>): Disposer;

  // Service access
  get<K extends keyof ServiceMap>(key: K): ServiceMap[K];
  optional<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined;

  // Dependency waiting
  whenAvailable<K extends keyof ServiceMap>(
    key: K,
    cb: (service: ServiceMap[K]) => void | Promise<void>,
  ): Disposer;

  // Plugin Lifecycle Management
  loadPlugin(plugin: Plugin): Promise<void>;
  unloadPlugin(pluginName: string): Promise<void>;
  hotReload(oldPluginName: string, newPlugin: Plugin): Promise<void>;
  dispose(): Promise<void>;
}

export class DefaultPluginContext implements PluginContext {
  private readonly services = new Map<string, unknown>();
  private readonly serviceWaiters = new Map<string, Array<(service: unknown) => void>>();
  private readonly eventHandlers = new Map<string, Set<EventHandler<any>>>();
  private readonly waterfallEngine = new WaterfallEngine();
  private readonly plugins = new Map<string, PluginRecord>();
  private readonly pluginLoadOrder: string[] = [];
  private readonly activePluginStack: string[] = [];
  private readonly globalDisposers: Disposer[] = [];
  private isDisposed = false;

  /**
   * Register a service on a well-known or custom key.
   * Returns a Disposer that removes the service upon teardown.
   */
  provide<K extends keyof ServiceMap>(key: K, service: ServiceMap[K]): Disposer {
    const keyStr = String(key);
    this.services.set(keyStr, service);

    // Notify any pending waiters for this service key
    const waiters = this.serviceWaiters.get(keyStr);
    if (waiters && waiters.length > 0) {
      const waitersCopy = [...waiters];
      this.serviceWaiters.delete(keyStr);
      for (const waiter of waitersCopy) {
        try {
          waiter(service);
        } catch {
          // Swallow waiter error to avoid interrupting registration
        }
      }
    }

    this.emit('service/provided', { serviceKey: keyStr, timestamp: new Date() });

    const disposer: Disposer = () => {
      if (this.services.get(keyStr) === service) {
        this.services.delete(keyStr);
        this.emit('service/removed', { serviceKey: keyStr, timestamp: new Date() });
      }
    };

    this.trackDisposer(disposer);
    return disposer;
  }

  /**
   * Get an active service or throw MissingServiceError.
   */
  get<K extends keyof ServiceMap>(key: K): ServiceMap[K] {
    const keyStr = String(key);
    const service = this.services.get(keyStr) as ServiceMap[K] | undefined;
    if (service === undefined) {
      const currentPlugin = this.activePluginStack[this.activePluginStack.length - 1];
      throw new MissingServiceError(keyStr, currentPlugin);
    }
    return service;
  }

  /**
   * Get an active service or undefined.
   */
  optional<K extends keyof ServiceMap>(key: K): ServiceMap[K] | undefined {
    return this.services.get(String(key)) as ServiceMap[K] | undefined;
  }

  /**
   * Wait until a service is provided, then execute callback.
   * If already available, executes immediately.
   */
  whenAvailable<K extends keyof ServiceMap>(
    key: K,
    cb: (service: ServiceMap[K]) => void | Promise<void>,
  ): Disposer {
    const keyStr = String(key);
    const existing = this.services.get(keyStr) as ServiceMap[K] | undefined;
    if (existing !== undefined) {
      cb(existing);
      return () => {};
    }

    let active = true;
    const waiter = (svc: unknown) => {
      if (active) {
        cb(svc as ServiceMap[K]);
      }
    };

    const list = this.serviceWaiters.get(keyStr) ?? [];
    list.push(waiter);
    this.serviceWaiters.set(keyStr, list);

    const disposer: Disposer = () => {
      active = false;
      const currentList = this.serviceWaiters.get(keyStr);
      if (currentList) {
        const idx = currentList.indexOf(waiter);
        if (idx !== -1) currentList.splice(idx, 1);
      }
    };

    this.trackDisposer(disposer);
    return disposer;
  }

  /**
   * Register a pub/sub event handler.
   */
  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): Disposer {
    const eventStr = String(event);
    const set = this.eventHandlers.get(eventStr) ?? new Set();
    set.add(handler);
    this.eventHandlers.set(eventStr, set);

    const disposer: Disposer = () => {
      const currentSet = this.eventHandlers.get(eventStr);
      if (currentSet) {
        currentSet.delete(handler);
      }
    };

    this.trackDisposer(disposer);
    return disposer;
  }

  /**
   * Emit a pub/sub event to all registered listeners.
   */
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.eventHandlers.get(String(event));
    if (!set || set.size === 0) return;

    for (const handler of Array.from(set)) {
      try {
        const res = handler(data);
        if (res instanceof Promise) {
          res.catch(() => {});
        }
      } catch {
        // Continue notifying remaining listeners
      }
    }
  }

  /**
   * Register a waterfall interceptor.
   */
  intercept<K extends keyof WaterfallMap>(event: K, handler: WaterfallHandler<K>): Disposer {
    const remove = this.waterfallEngine.register(event, handler);
    const disposer: Disposer = () => remove();
    this.trackDisposer(disposer);
    return disposer;
  }

  /**
   * Run a waterfall event pipeline through all registered interceptors.
   */
  async waterfall<K extends keyof WaterfallMap>(
    event: K,
    ...args: WaterfallArgs<K>
  ): Promise<WaterfallReturn<K>> {
    return this.waterfallEngine.execute(event, ...args);
  }

  /**
   * Register a reversible effect.
   */
  effect(setup: () => Disposer | undefined | Promise<Disposer | undefined>): Disposer {
    let effectDisposer: Disposer | undefined;

    const res = setup();
    if (typeof res === 'function') {
      effectDisposer = res;
    } else if (res instanceof Promise) {
      res.then((r) => {
        if (typeof r === 'function') effectDisposer = r;
      });
    }

    const disposer: Disposer = async () => {
      if (effectDisposer) {
        await Promise.resolve(effectDisposer());
      }
    };

    this.trackDisposer(disposer);
    return disposer;
  }

  /**
   * Load and activate a plugin into the context.
   */
  async loadPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      const existing = this.plugins.get(plugin.name)!;
      if (existing.state === PluginState.ACTIVE) {
        return; // Already loaded
      }
    }

    // Verify injected required dependencies
    if (plugin.inject && plugin.inject.length > 0) {
      for (const requiredKey of plugin.inject) {
        if (!this.services.has(requiredKey)) {
          throw new MissingServiceError(requiredKey, plugin.name);
        }
      }
    }

    const record: PluginRecord = {
      plugin,
      state: PluginState.LOADING,
      disposers: [],
      loadedAt: new Date(),
    };

    this.plugins.set(plugin.name, record);
    this.pluginLoadOrder.push(plugin.name);

    this.activePluginStack.push(plugin.name);
    try {
      await Promise.resolve(plugin.apply(this));
      record.state = PluginState.ACTIVE;
      this.emit('plugin/loaded', { pluginName: plugin.name, timestamp: new Date() });
    } catch (err: any) {
      record.state = PluginState.FAILED;
      record.error = err;
      // Unwind partial disposers
      await this.unwindDisposers(record.disposers);
      throw err;
    } finally {
      this.activePluginStack.pop();
    }
  }

  /**
   * Unload a plugin and reverse its registrations in strict LIFO order.
   */
  async unloadPlugin(pluginName: string): Promise<void> {
    const record = this.plugins.get(pluginName);
    if (!record || record.state === PluginState.UNLOADED) {
      return;
    }

    record.state = PluginState.DISPOSING;
    await this.unwindDisposers(record.disposers);
    record.state = PluginState.UNLOADED;

    this.plugins.delete(pluginName);
    const orderIdx = this.pluginLoadOrder.indexOf(pluginName);
    if (orderIdx !== -1) {
      this.pluginLoadOrder.splice(orderIdx, 1);
    }

    this.emit('plugin/unloaded', { pluginName, timestamp: new Date() });
  }

  /**
   * Hot-reload: Replace a provider seamlessly with zero memory leaks.
   */
  async hotReload(oldPluginName: string, newPlugin: Plugin): Promise<void> {
    await this.unloadPlugin(oldPluginName);
    await this.loadPlugin(newPlugin);
  }

  /**
   * Dispose entire context and all plugins in strict reverse load order.
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // Unload all active plugins in reverse order of loading
    const reverseOrder = [...this.pluginLoadOrder].reverse();
    for (const name of reverseOrder) {
      await this.unloadPlugin(name);
    }

    // Unwind global disposers
    await this.unwindDisposers(this.globalDisposers);

    this.services.clear();
    this.serviceWaiters.clear();
    this.eventHandlers.clear();
    this.waterfallEngine.clear();
    this.plugins.clear();
    this.pluginLoadOrder.length = 0;
  }

  private trackDisposer(disposer: Disposer): void {
    const currentPlugin = this.activePluginStack[this.activePluginStack.length - 1];
    if (currentPlugin) {
      const record = this.plugins.get(currentPlugin);
      if (record) {
        record.disposers.push(disposer);
        return;
      }
    }
    this.globalDisposers.push(disposer);
  }

  private async unwindDisposers(disposers: Disposer[]): Promise<void> {
    // Reverse order for LIFO unwinding
    const copy = [...disposers].reverse();
    disposers.length = 0;

    for (const disposer of copy) {
      try {
        await Promise.resolve(disposer());
      } catch {
        // Continue unwinding remaining disposers
      }
    }
  }
}
