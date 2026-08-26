import { describe, it, expect, vi } from 'vitest';
import {
  DefaultPluginContext,
  type Plugin,
  PluginState,
  type Disposer,
} from '../../../src/core/plugin/index.js';

describe('Plugin Lifecycle & Reversible Effects — P017', () => {
  it('1. Loads, applies, and activates a plugin successfully', async () => {
    const ctx = new DefaultPluginContext();
    let applied = false;

    const testPlugin: Plugin = {
      name: 'test-plugin',
      version: '1.0.0',
      apply: (c) => {
        applied = true;
        c.provide('logger', { log: () => {} } as any);
      },
    };

    await ctx.loadPlugin(testPlugin);
    expect(applied).toBe(true);
    expect(ctx.optional('logger')).toBeDefined();
  });

  it('2. Unwinds registrations in strict reverse order (LIFO) on unload', async () => {
    const ctx = new DefaultPluginContext();
    const tearDownLog: string[] = [];

    const testPlugin: Plugin = {
      name: 'lifo-plugin',
      apply: (c) => {
        c.effect(() => () => {
          tearDownLog.push('effect-1');
        });
        c.effect(() => () => {
          tearDownLog.push('effect-2');
        });
        c.effect(() => () => {
          tearDownLog.push('effect-3');
        });
      },
    };

    await ctx.loadPlugin(testPlugin);
    expect(tearDownLog).toEqual([]);

    await ctx.unloadPlugin('lifo-plugin');
    expect(tearDownLog).toEqual(['effect-3', 'effect-2', 'effect-1']);
  });

  it('3. Reversible effects: tracks and executes async cleanup functions', async () => {
    const ctx = new DefaultPluginContext();
    let cleanedUp = false;

    const effectPlugin: Plugin = {
      name: 'async-effect-plugin',
      apply: (c) => {
        c.effect(async () => {
          return async () => {
            cleanedUp = true;
          };
        });
      },
    };

    await ctx.loadPlugin(effectPlugin);
    expect(cleanedUp).toBe(false);

    await ctx.unloadPlugin('async-effect-plugin');
    expect(cleanedUp).toBe(true);
  });

  it('4. Hot reload: replaces provider seamlessly where consumers see new implementation', async () => {
    const ctx = new DefaultPluginContext();

    const providerV1: Plugin = {
      name: 'shell-provider',
      apply: (c) => {
        c.provide('shell', {
          execute: async () => ({ stdout: 'v1 output', stderr: '', exitCode: 0 }),
        });
      },
    };

    const providerV2: Plugin = {
      name: 'shell-provider',
      apply: (c) => {
        c.provide('shell', {
          execute: async () => ({ stdout: 'v2 upgraded output', stderr: '', exitCode: 0 }),
        });
      },
    };

    await ctx.loadPlugin(providerV1);
    const shell1 = ctx.get('shell');
    const res1 = await shell1.execute('ls');
    expect(res1.stdout).toBe('v1 output');

    // Hot-reload
    await ctx.hotReload('shell-provider', providerV2);
    const shell2 = ctx.get('shell');
    const res2 = await shell2.execute('ls');
    expect(res2.stdout).toBe('v2 upgraded output');
  });

  it('5. Context disposal unloads all plugins in reverse loading order', async () => {
    const ctx = new DefaultPluginContext();
    const order: string[] = [];

    const pluginA: Plugin = {
      name: 'plugin-a',
      apply: (c) => {
        c.effect(() => () => {
          order.push('dispose-a');
        });
      },
    };

    const pluginB: Plugin = {
      name: 'plugin-b',
      apply: (c) => {
        c.effect(() => () => {
          order.push('dispose-b');
        });
      },
    };

    const pluginC: Plugin = {
      name: 'plugin-c',
      apply: (c) => {
        c.effect(() => () => {
          order.push('dispose-c');
        });
      },
    };

    await ctx.loadPlugin(pluginA);
    await ctx.loadPlugin(pluginB);
    await ctx.loadPlugin(pluginC);

    await ctx.dispose();
    expect(order).toEqual(['dispose-c', 'dispose-b', 'dispose-a']);
  });

  it('6. Failure during apply rolls back partially registered effects', async () => {
    const ctx = new DefaultPluginContext();
    let partialDisposed = false;

    const failingPlugin: Plugin = {
      name: 'failing-plugin',
      apply: (c) => {
        c.effect(() => () => {
          partialDisposed = true;
        });
        throw new Error('Explosion during setup');
      },
    };

    await expect(ctx.loadPlugin(failingPlugin)).rejects.toThrow('Explosion during setup');
    expect(partialDisposed).toBe(true);
  });

  it('7. Emits lifecycle pub/sub events on plugin load and unload', async () => {
    const ctx = new DefaultPluginContext();
    const events: string[] = [];

    ctx.on('plugin/loaded', (e) => events.push(`loaded:${e.pluginName}`));
    ctx.on('plugin/unloaded', (e) => events.push(`unloaded:${e.pluginName}`));

    const plugin: Plugin = {
      name: 'event-lifecycle-plugin',
      apply: () => {},
    };

    await ctx.loadPlugin(plugin);
    expect(events).toContain('loaded:event-lifecycle-plugin');

    await ctx.unloadPlugin('event-lifecycle-plugin');
    expect(events).toContain('unloaded:event-lifecycle-plugin');
  });

  it('8. Idempotent load: ignores loading an already active plugin', async () => {
    const ctx = new DefaultPluginContext();
    let applyCount = 0;

    const plugin: Plugin = {
      name: 'idempotent-plugin',
      apply: () => {
        applyCount++;
      },
    };

    await ctx.loadPlugin(plugin);
    await ctx.loadPlugin(plugin);
    expect(applyCount).toBe(1);
  });

  it('9. Error during effect disposal still unwinds remaining disposers', async () => {
    const ctx = new DefaultPluginContext();
    const cleanups: string[] = [];

    const plugin: Plugin = {
      name: 'resilient-unwind-plugin',
      apply: (c) => {
        c.effect(() => () => {
          cleanups.push('cleanup-1');
        });
        c.effect(() => () => {
          throw new Error('Disposer failed!');
        });
        c.effect(() => () => {
          cleanups.push('cleanup-3');
        });
      },
    };

    await ctx.loadPlugin(plugin);
    await ctx.unloadPlugin('resilient-unwind-plugin');
    expect(cleanups).toEqual(['cleanup-3', 'cleanup-1']);
  });

  it('10. Plugin can be re-loaded cleanly after being unloaded', async () => {
    const ctx = new DefaultPluginContext();
    let loadCount = 0;

    const plugin: Plugin = {
      name: 'reloadable-plugin',
      apply: (c) => {
        loadCount++;
        c.provide('logger', { log: () => loadCount } as any);
      },
    };

    await ctx.loadPlugin(plugin);
    expect(loadCount).toBe(1);
    expect(ctx.optional('logger')).toBeDefined();

    await ctx.unloadPlugin('reloadable-plugin');
    expect(ctx.optional('logger')).toBeUndefined();

    await ctx.loadPlugin(plugin);
    expect(loadCount).toBe(2);
    expect(ctx.optional('logger')).toBeDefined();
  });
});
