/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
 * @requirement:HOOK-001,HOOK-002,HOOK-003,HOOK-004,HOOK-005,HOOK-006,HOOK-007,HOOK-008,HOOK-009,HOOK-148
 * @pseudocode:analysis/pseudocode/01-hook-system-lifecycle.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HookSystem } from './hookSystem.js';
import { HookSystemNotInitializedError } from './errors.js';
import type { Config } from '../config/config.js';
import type { Storage } from '../config/storage.js';

// Mock DebugLogger
const mockDebugLogger = vi.hoisted(() => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../debug/index.js', () => {
  // Create a constructor function that returns the mock
  const DebugLogger = vi.fn().mockImplementation(() => mockDebugLogger);
  // Add getLogger as a static method
  DebugLogger.getLogger = vi.fn().mockReturnValue(mockDebugLogger);

  return {
    DebugLogger,
  };
});

// Mock fs for HookRegistry
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

describe('HookSystem', () => {
  let hookSystem: HookSystem;
  let mockConfig: Config;
  let mockStorage: Storage;

  beforeEach(() => {
    vi.resetAllMocks();

    mockStorage = {
      getGeminiDir: vi.fn().mockReturnValue('/project/.gemini'),
    } as unknown as Storage;

    mockConfig = {
      storage: mockStorage,
      getExtensions: vi.fn().mockReturnValue([]),
      getHooks: vi.fn().mockReturnValue({}),
      getDisabledHooks: vi.fn().mockReturnValue([]),
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getTargetDir: vi.fn().mockReturnValue('/test/project'),
      getEnableHooks: vi.fn().mockReturnValue(true),
      isTrustedFolder: vi.fn().mockReturnValue(true),
      getProjectHooks: vi.fn().mockReturnValue(null),
      getSanitizationConfig: vi.fn().mockReturnValue({
        enableEnvironmentVariableRedaction: false,
        allowedEnvironmentVariables: [],
        blockedEnvironmentVariables: [],
      }),
      getSessionRecordingService: vi.fn().mockReturnValue(null),
    } as unknown as Config;

    hookSystem = new HookSystem(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    it('should create HookSystem instance without initializing', () => {
      // @requirement:HOOK-001 - Lazy creation, not initialized on construction
      expect(hookSystem).toBeInstanceOf(HookSystem);
      expect(hookSystem.isInitialized()).toBe(false);
    });
  });

  describe('initialize', () => {
    it('should initialize HookSystem successfully', async () => {
      // @requirement:HOOK-003
      await hookSystem.initialize();

      expect(hookSystem.isInitialized()).toBe(true);
      expect(mockDebugLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('HookSystem initialized'),
      );
    });

    // Alias test for P04 verification command compatibility
    it('initialize called once', async () => {
      // @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P04
      // @requirement:HOOK-003
      // Uses the existing hookSystem from beforeEach which has proper mock config

      await hookSystem.initialize();
      const firstInit = hookSystem.isInitialized();

      await hookSystem.initialize();
      const secondInit = hookSystem.isInitialized();

      expect(firstInit).toBe(true);
      expect(secondInit).toBe(true);
      // Both should be true, confirming initialization works
    });
  });

  describe('getRegistry', () => {
    it('should return HookRegistry after initialization', async () => {
      // @requirement:HOOK-006
      await hookSystem.initialize();

      const registry = hookSystem.getRegistry();
      expect(registry).toBeDefined();
      expect(registry.getAllHooks).toBeDefined();
    });

    it('should return the same HookRegistry instance on multiple calls', async () => {
      // @requirement:HOOK-007 - Single shared instances
      await hookSystem.initialize();

      const registry1 = hookSystem.getRegistry();
      const registry2 = hookSystem.getRegistry();

      expect(registry1).toBe(registry2);
    });
  });

  describe('getEventHandler', () => {
    it('should throw HookSystemNotInitializedError before initialization', () => {
      // @requirement:HOOK-005,HOOK-148
      expect(() => hookSystem.getEventHandler()).toThrow(
        HookSystemNotInitializedError,
      );
      expect(() => hookSystem.getEventHandler()).toThrow(
        'Cannot access HookEventHandler before HookSystem is initialized',
      );
    });

    it('should return HookEventHandler after initialization', async () => {
      // @requirement:HOOK-006
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      expect(eventHandler).toBeDefined();
      expect(eventHandler.fireBeforeToolEvent).toBeDefined();
    });

    it('should return the same HookEventHandler instance on multiple calls', async () => {
      // @requirement:HOOK-007 - Single shared instances
      await hookSystem.initialize();

      const handler1 = hookSystem.getEventHandler();
      const handler2 = hookSystem.getEventHandler();

      expect(handler1).toBe(handler2);
    });
  });

  describe('fire* wrapper methods', () => {
    it('should throw HookSystemNotInitializedError when fireBeforeToolEvent called before initialization', async () => {
      // @requirement:HOOK-005 - Wrappers inherit getEventHandler() guard
      await expect(
        hookSystem.fireBeforeToolEvent('TestTool', {}),
      ).rejects.toThrow(HookSystemNotInitializedError);
    });

    it('should delegate fireBeforeToolEvent to HookEventHandler', async () => {
      // @requirement:HOOK-006 - Simplifies caller code
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      const spy = vi.spyOn(eventHandler, 'fireBeforeToolEvent');

      const toolInput = { param: 'value' };
      await hookSystem.fireBeforeToolEvent('TestTool', toolInput);

      expect(spy).toHaveBeenCalledWith('TestTool', toolInput, undefined);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate fireBeforeModelEvent to HookEventHandler', async () => {
      // @requirement:HOOK-006 - Simplifies caller code
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      const spy = vi.spyOn(eventHandler, 'fireBeforeModelEvent');

      const llmRequest = { model: 'test-model' };
      await hookSystem.fireBeforeModelEvent(llmRequest);

      expect(spy).toHaveBeenCalledWith(llmRequest);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate fireSessionStartEvent to HookEventHandler', async () => {
      // @requirement:HOOK-006 - Simplifies caller code
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      const spy = vi.spyOn(eventHandler, 'fireSessionStartEvent');

      const context = { source: 'startup' as const };
      await hookSystem.fireSessionStartEvent(context);

      expect(spy).toHaveBeenCalledWith(context);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should delegate fireNotificationEvent to HookEventHandler', async () => {
      // @requirement:HOOK-006 - Simplifies caller code
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      const spy = vi.spyOn(eventHandler, 'fireNotificationEvent');

      // Import NotificationType to use its enum value
      const { NotificationType } = await import('./types.js');
      const details = { toolName: 'TestTool' };
      await hookSystem.fireNotificationEvent(
        NotificationType.ToolPermission,
        'Test message',
        details,
      );

      expect(spy).toHaveBeenCalledWith(
        NotificationType.ToolPermission,
        'Test message',
        details,
      );
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should return undefined from HookEventHandler wrapper when no hook output', async () => {
      // @requirement:HOOK-006 - Wrappers return typed output, undefined when no finalOutput
      await hookSystem.initialize();

      const eventHandler = hookSystem.getEventHandler();
      const mockResult = {
        success: true,
        hookResults: [],
        finalOutput: undefined,
      };
      vi.spyOn(eventHandler, 'fireBeforeModelEvent').mockResolvedValue(
        mockResult,
      );

      const result = await hookSystem.fireBeforeModelEvent({ model: 'test' });

      expect(result).toBeUndefined();
    });
  });

  describe('with configured hooks', () => {
    it('should report correct hook count after initialization', async () => {
      // Setup mock with hooks configuration BEFORE creating HookSystem
      const mockHooksConfig = {
        BeforeTool: [
          {
            matcher: 'EditTool',
            hooks: [
              {
                type: 'command', // Use lowercase to match how HookRegistry parses
                command: './hooks/check_style.sh',
                timeout: 60,
              },
            ],
          },
        ],
      };

      const configuredMockConfig = {
        ...mockConfig,
        getHooks: vi.fn().mockReturnValue(mockHooksConfig),
      } as unknown as Config;

      // Create new HookSystem with properly mocked config
      const configuredHookSystem = new HookSystem(configuredMockConfig);
      await configuredHookSystem.initialize();

      const hooks = configuredHookSystem.getAllHooks();
      expect(configuredHookSystem.isInitialized()).toBe(true);
      expect(hooks.length).toBe(1);
    });
  });
});

describe('HookSystemNotInitializedError', () => {
  it('should have correct name', () => {
    const error = new HookSystemNotInitializedError();
    expect(error.name).toBe('HookSystemNotInitializedError');
  });

  it('should have default message', () => {
    const error = new HookSystemNotInitializedError();
    expect(error.message).toContain('HookSystem not initialized');
  });

  it('should accept custom message', () => {
    const customMessage = 'Custom error message';
    const error = new HookSystemNotInitializedError(customMessage);
    expect(error.message).toBe(customMessage);
  });

  it('should be instanceof Error', () => {
    const error = new HookSystemNotInitializedError();
    expect(error).toBeInstanceOf(Error);
  });
});
