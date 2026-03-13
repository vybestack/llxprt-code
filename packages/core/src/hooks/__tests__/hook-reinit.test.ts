/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview TDD tests for hook re-initialization on extension change
 * @requirement R2 R4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookSystem } from '../hookSystem.js';
import type { Config } from '../../config/config.js';
import type { GeminiCLIExtension } from '../../config/config.js';
import { HookEventName } from '../types.js';

describe('Hook Re-Initialization (126c32ac)', () => {
  let mockConfig: Config;
  let mockExtensions: GeminiCLIExtension[];

  beforeEach(() => {
    mockExtensions = [];
    mockConfig = {
      getEnableHooks: () => true,
      getHooks: () => ({}),
      getSessionId: () => 'test-session',
      getWorkingDir: () => '/test',
      getTargetDir: () => '/test',
      getExtensions: () => mockExtensions,
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
  });

  it('should reload hooks when extension with hooks is added', async () => {
    const hookSystem = new HookSystem(mockConfig);

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
      id: 'ext-123',
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            matcher: 'read_file',
            hooks: [{ type: 'command', command: './check.sh' }],
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
      id: 'ext-123',
      hooks: {
        [HookEventName.BeforeTool]: [
          {
            hooks: [{ type: 'command', command: './check.sh' }],
          },
        ],
      },
    });

    const hookSystem = new HookSystem(mockConfig);
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
  it('should dispose old event handler before creating new one', async () => {
    const unsubscribeMock = vi.fn();
    const subscribeMock = vi.fn(() => unsubscribeMock);
    const mockMessageBus = {
      subscribe: subscribeMock,
      publish: vi.fn(),
    };

    const mockConfig = {
      getEnableHooks: () => true,
      getHooks: () => ({}),
      getSessionId: () => 'test-session',
      getWorkingDir: () => '/test',
      getTargetDir: () => '/test',
      getExtensions: () => [],
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

    const hookSystem = new HookSystem(mockConfig, mockMessageBus);

    // First init — subscribes to MessageBus
    await hookSystem.initialize();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeMock).not.toHaveBeenCalled();

    // Re-init — should dispose old handler first
    await hookSystem.initialize();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1); // Old handler disposed
    expect(subscribeMock).toHaveBeenCalledTimes(2); // New handler subscribed
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

    const mockConfig = {
      getEnableHooks: () => true,
      getHooks: () => ({}),
      getSessionId: () => 'test-session',
      getWorkingDir: () => '/test',
      getTargetDir: () => '/test',
      getExtensions: () => [],
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

    const hookSystem = new HookSystem(mockConfig, mockMessageBus);

    // Initialize 3 times
    await hookSystem.initialize();
    await hookSystem.initialize();
    await hookSystem.initialize();

    // Should have 3 subscriptions, 2 should be unsubscribed
    expect(subscribeMock).toHaveBeenCalledTimes(3);

    expect(unsubscribes[0]).toHaveBeenCalledTimes(1); // First disposed before second init
    expect(unsubscribes[1]).toHaveBeenCalledTimes(1); // Second disposed before third init
    expect(unsubscribes[2]).not.toHaveBeenCalled(); // Third still active
  });
});
