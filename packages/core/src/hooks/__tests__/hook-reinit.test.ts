/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HookType } from '../types.js';
import {
  fixtureHookDefinitions,
  fixtureHookRuntime,
} from './hook-runtime-fixture.js';
/**
 * @fileoverview TDD tests for hook re-initialization on extension change
 * @requirement R2 R4
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { HookSystem } from '../hookSystem.js';
import type { Config } from '../../config/config.js';
import type { LlxprtExtension } from '../../config/config.js';
import { HookEventName } from '../types.js';

function createHookConfig(extensions: LlxprtExtension[] = []): Config {
  return {
    getEnableHooks: () => true,
    getHooks: () => ({}),
    getSessionId: () => 'test-session',
    getWorkingDir: () => '/test',
    getTargetDir: () => '/test',
    getExtensions: () => extensions,
    getDisabledHooks: () => [],
    getModel: () => 'test-model',
    isTrustedFolder: () => true,
    getProjectHooks: () => null,
    getSanitizationConfig: () => ({
      enableEnvironmentVariableRedaction: false,
      allowedEnvironmentVariables: [],
      blockedEnvironmentVariables: [],
    }),
    getSessionRecordingService: () => null,
  } as unknown as Config;
}

describe('Hook Re-Initialization (126c32ac)', () => {
  let mockConfig: Config;
  let mockExtensions: LlxprtExtension[];

  beforeEach(() => {
    mockExtensions = [];
    mockConfig = createHookConfig(mockExtensions);
  });

  it('should reload hooks when extension with hooks is added', async () => {
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );

    // First init — no extensions
    await hookSystem.initialize();
    const beforeCount = hookSystem.getAllHooks().length;
    expect(beforeCount).toBe(0);

    // Add extension with hooks
    mockExtensions.push({
      name: 'test-ext',
      isActive: true,
      version: '1.0.0',
      path: '/ext',
      contextFiles: [],
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            matcher: 'read_file',
            hooks: [{ type: HookType.Command, command: './check.sh' }],
          },
        ],
      },
    });

    // Re-initialize — should pick up new extension hooks
    await hookSystem.initialize();
    const afterCount = hookSystem.getAllHooks().length;

    expect(afterCount).toBeGreaterThan(beforeCount);
    expect(afterCount).toBe(1); // One hook from extension
  });

  it('should reload hooks when extension with hooks is removed', async () => {
    mockExtensions.push({
      name: 'test-ext',
      isActive: true,
      version: '1.0.0',
      path: '/ext',
      contextFiles: [],
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            hooks: [{ type: HookType.Command, command: './check.sh' }],
          },
        ],
      },
    });

    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );
    await hookSystem.initialize();
    const beforeCount = hookSystem.getAllHooks().length;
    expect(beforeCount).toBe(1);

    // Remove extension
    mockExtensions.length = 0;

    // Re-initialize — should clear extension hooks
    await hookSystem.initialize();
    const afterCount = hookSystem.getAllHooks().length;

    expect(afterCount).toBeLessThan(beforeCount);
    expect(afterCount).toBe(0);
  });
});

describe('Hook Re-Initialization Disposal (126c32ac)', () => {
  it('deduplicates concurrent initialization and supersedes it with one later generation', async () => {
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );
    const registry = hookSystem.getRegistry();
    const originalInitialize = registry.initialize.bind(registry);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const initialize = vi
      .spyOn(registry, 'initialize')
      .mockImplementationOnce(async (signal) => {
        await gate;
        await originalInitialize(signal);
      })
      .mockImplementation(originalInitialize);

    const first = hookSystem.initialize();
    const duplicate = hookSystem.initialize();
    const superseding = hookSystem.initialize();
    release?.();
    await Promise.all([first, duplicate, superseding]);

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(hookSystem.isInitialized()).toBe(true);
  });

  it('disposes an initialized handler when a queued generation supersedes it', async () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const mockMessageBus = {
      subscribe: vi.fn(() => {
        const unsubscribe = vi.fn();
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      }),
      publish: vi.fn(),
    };
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
      mockMessageBus,
    );
    const registry = hookSystem.getRegistry();
    const originalInitialize = registry.initialize.bind(registry);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(registry, 'initialize')
      .mockImplementationOnce(async (signal) => {
        await gate;
        await originalInitialize(signal);
      })
      .mockImplementation(originalInitialize);

    const first = hookSystem.initialize();
    const superseding = hookSystem.initialize();
    release?.();
    await Promise.all([first, superseding]);

    expect(mockMessageBus.subscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribes[0]).not.toHaveBeenCalled();
    await hookSystem.dispose();
    expect(unsubscribes[0]).toHaveBeenCalledOnce();
  });

  it('invalidates in-flight initialization and remains terminal after disposal', async () => {
    const subscribe = vi.fn(() => vi.fn());
    const mockMessageBus = { subscribe, publish: vi.fn() };
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
      mockMessageBus,
    );
    const registry = hookSystem.getRegistry();
    const originalInitialize = registry.initialize.bind(registry);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(registry, 'initialize').mockImplementationOnce(async (signal) => {
      await gate;
      await originalInitialize(signal);
    });

    const initialization = hookSystem.initialize();
    await waitFor(() => expect(registry.initialize).toHaveBeenCalledOnce());
    await hookSystem.dispose();
    release?.();

    await expect(initialization).rejects.toThrow(/disposed/i);
    expect(subscribe).not.toHaveBeenCalled();
    expect(hookSystem.isInitialized()).toBe(false);
    await expect(hookSystem.initialize()).rejects.toThrow(/disposed/i);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('should dispose old event handler before creating new one', async () => {
    const unsubscribeMock = vi.fn();
    const subscribeMock = vi.fn(() => unsubscribeMock);
    const mockMessageBus = {
      subscribe: subscribeMock,
      publish: vi.fn(),
    };

    const mockConfig = createHookConfig();

    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
      mockMessageBus,
    );

    // First init — subscribes to MessageBus
    await hookSystem.initialize();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).not.toHaveBeenCalled();

    // Re-init — should dispose old handler first
    await hookSystem.initialize();

    expect(unsubscribeMock).not.toHaveBeenCalled();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    await hookSystem.dispose();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('should not leak subscriptions after multiple re-inits', async () => {
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    const subscribeMock = vi.fn(() => {
      const unsub = vi.fn();
      unsubscribes.push(unsub);
      return unsub;
    });
    const mockMessageBus = {
      subscribe: subscribeMock,
      publish: vi.fn(),
    };

    const mockConfig = createHookConfig();

    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
      mockMessageBus,
    );

    // Initialize 3 times
    await hookSystem.initialize();
    await hookSystem.initialize();
    await hookSystem.initialize();

    // Should have 3 subscriptions, 2 should be unsubscribed
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribes[0]).not.toHaveBeenCalled();
    await hookSystem.dispose();
    expect(unsubscribes[0]).toHaveBeenCalledTimes(1);
  });

  it('returns an already-aborted initialization as a rejected promise', async () => {
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );
    const controller = new AbortController();
    controller.abort();

    let initialization: Promise<void> | undefined;
    expect(() => {
      initialization = hookSystem.initialize(controller.signal);
    }).not.toThrow();
    await expect(initialization).rejects.toThrow(/abort/i);
  });

  it('aborts registry initialization when disposed', async () => {
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );
    const registry = hookSystem.getRegistry();
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(registry, 'initialize').mockImplementation(async (signal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => {
        signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      signal?.throwIfAborted();
    });

    const initialization = hookSystem.initialize();
    await waitFor(() => expect(observedSignal).toBeDefined());
    await hookSystem.dispose();

    expect(observedSignal?.aborted).toBe(true);
    await expect(initialization).rejects.toThrow(/disposed/i);
  });

  it('allows initialization to recover after registry initialization fails', async () => {
    const mockConfig = createHookConfig();
    const hookSystem = new HookSystem(
      fixtureHookDefinitions(mockConfig),
      fixtureHookRuntime(mockConfig),
    );
    const failure = new Error('registry initialization failed');
    const initialize = vi
      .spyOn(hookSystem.getRegistry(), 'initialize')
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);

    await expect(hookSystem.initialize()).rejects.toBe(failure);
    await expect(hookSystem.initialize()).resolves.toBeUndefined();

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(hookSystem.isInitialized()).toBe(true);
  });
});
