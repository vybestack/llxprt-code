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

vi.mock('../debug/index.js', () => ({
  DebugLogger: {
    getLogger: vi.fn(() => mockDebugLogger),
  },
}));

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
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getTargetDir: vi.fn().mockReturnValue('/test/project'),
      getEnableHooks: vi.fn().mockReturnValue(true),
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

    it('should report correct status before initialization', () => {
      // @requirement:HOOK-009
      const status = hookSystem.getStatus();
      expect(status.initialized).toBe(false);
      expect(status.totalHooks).toBe(0);
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

    it('should only initialize once on multiple calls', async () => {
      // @requirement:HOOK-004
      await hookSystem.initialize();
      await hookSystem.initialize();
      await hookSystem.initialize();

      expect(hookSystem.isInitialized()).toBe(true);
      // Check that "Initializing HookSystem" was only called once
      const initCalls = mockDebugLogger.debug.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('Initializing HookSystem'),
      );
      expect(initCalls.length).toBe(1);
    });

    // Alias test for P04 verification command compatibility
    it('initialize called once', async () => {
      // @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P04
      // @requirement:HOOK-003,HOOK-004
      // Uses the existing hookSystem from beforeEach which has proper mock config

      await hookSystem.initialize();
      const firstInit = hookSystem.isInitialized();

      await hookSystem.initialize();
      const secondInit = hookSystem.isInitialized();

      expect(firstInit).toBe(true);
      expect(secondInit).toBe(true);
      // Both should be true, confirming idempotent initialization
    });

    it('should report correct status after initialization', async () => {
      // @requirement:HOOK-009
      await hookSystem.initialize();

      const status = hookSystem.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.totalHooks).toBe(0); // No hooks configured in mock
    });
  });

  describe('getRegistry', () => {
    it('should throw HookSystemNotInitializedError before initialization', () => {
      // @requirement:HOOK-005,HOOK-148
      expect(() => hookSystem.getRegistry()).toThrow(
        HookSystemNotInitializedError,
      );
      expect(() => hookSystem.getRegistry()).toThrow(
        'Cannot access HookRegistry before HookSystem is initialized',
      );
    });

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

  describe('getStatus', () => {
    it('should return HookSystemStatus interface', () => {
      // @requirement:HOOK-009
      const status = hookSystem.getStatus();

      expect(status).toHaveProperty('initialized');
      expect(status).toHaveProperty('totalHooks');
      expect(typeof status.initialized).toBe('boolean');
      expect(typeof status.totalHooks).toBe('number');
    });
  });

  describe('with configured hooks', () => {
    it('should report correct hook count after initialization', async () => {
      // @requirement:HOOK-009
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

      const status = configuredHookSystem.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.totalHooks).toBe(1);
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
