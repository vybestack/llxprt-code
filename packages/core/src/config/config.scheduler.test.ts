/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Config } from './config.js';

// Use dynamic import to avoid circular dependencies with Config
let CoreToolScheduler: unknown;

beforeAll(async () => {
  const schedulerModule = await import('../core/coreToolScheduler.js');
  CoreToolScheduler = schedulerModule.CoreToolScheduler;
});

describe('Config - CoreToolScheduler Singleton', () => {
  let config: Config;
  const testSessionId = 'test-session-123';

  beforeEach(async () => {
    // Create a minimal Config instance for testing
    const mockSettingsService = {
      get: vi.fn(),
      set: vi.fn(),
      getAllGlobalSettings: vi.fn(() => ({})),
      getProviderSettings: vi.fn(() => ({})),
      setProviderSetting: vi.fn(),
      clear: vi.fn(),
    };

    const configParams = {
      sessionId: testSessionId,
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gemini-pro',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      settingsService: mockSettingsService as any,
      eventEmitter: undefined,
    };

    config = new Config(configParams);
    await config.initialize();

    // Clear any existing scheduler instances from previous tests
    const { clearAllSchedulers } = await import('./schedulerSingleton.js');
    clearAllSchedulers();
  });

  // Note: afterEach cleanup is skipped because require() doesn't work in ESM mode.
  // beforeEach already clears schedulers before each test.

  describe('getOrCreateScheduler', () => {
    it('should create a new scheduler instance for a given sessionId if none exists', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler1 = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );

      expect(scheduler1).toBeInstanceOf(CoreToolScheduler as unknown);
      expect(scheduler1).toBeDefined();
    });

    it('should return the same scheduler instance for the same sessionId', async () => {
      const callbacks1 = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const callbacks2 = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler1 = await config.getOrCreateScheduler(
        testSessionId,
        callbacks1,
      );
      const scheduler2 = await config.getOrCreateScheduler(
        testSessionId,
        callbacks2,
      );

      expect(scheduler1).toBe(scheduler2);
    });

    it('should not retain callbacks in scheduler entry', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      await config.getOrCreateScheduler(testSessionId, callbacks);

      const entry = (
        config as unknown as { _schedulerEntries: Map<string, unknown> }
      )._schedulerEntries.get(testSessionId);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('callbacks');
    });

    it('should create different scheduler instances for different sessionIds', async () => {
      const otherSessionId = 'other-session-456';

      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler1 = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );
      const scheduler2 = await config.getOrCreateScheduler(
        otherSessionId,
        callbacks,
      );

      expect(scheduler1).not.toBe(scheduler2);
    });
  });

  describe('disposeScheduler', () => {
    it('should dispose and remove the scheduler for a given sessionId', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );

      // Dispose
      config.disposeScheduler(testSessionId);

      // Try to get a new scheduler - it should be a new instance, not the same one
      const newScheduler = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );
      expect(newScheduler).toBeDefined();
      expect(newScheduler).not.toBe(scheduler);
    });

    it('should not throw if disposing a non-existent scheduler', () => {
      const nonExistentSessionId = 'non-existent-session';

      expect(() => {
        config.disposeScheduler(nonExistentSessionId);
      }).not.toThrow();
    });

    it('should keep scheduler alive until all references disposed', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );

      // Add a second reference
      await config.getOrCreateScheduler(testSessionId, callbacks);

      // Dispose once should keep scheduler alive due to refCount
      config.disposeScheduler(testSessionId);
      const stillExisting = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );
      expect(stillExisting).toBe(scheduler);

      // Clean up remaining references
      config.disposeScheduler(testSessionId);
      config.disposeScheduler(testSessionId);
    });

    it('should properly dispose the scheduler instance', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );

      // Spy on the dispose method
      const disposeSpy = vi.spyOn(
        scheduler as { dispose: () => void },
        'dispose',
      );

      config.disposeScheduler(testSessionId);

      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('Integration: Single scheduler per session', () => {
    it('should ensure only one CoreToolScheduler instance exists per sessionId across multiple components', async () => {
      const component1Callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const component2Callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const schedulerFromComponent1 = await config.getOrCreateScheduler(
        testSessionId,
        component1Callbacks,
      );
      const schedulerFromComponent2 = await config.getOrCreateScheduler(
        testSessionId,
        component2Callbacks,
      );

      // Both components get the same scheduler instance
      expect(schedulerFromComponent1).toBe(schedulerFromComponent2);
    });

    it('should handle multiple sessions with separate schedulers', async () => {
      const sessions = ['session-1', 'session-2', 'session-3'];
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const schedulers: any[] = [];

      for (const sessionId of sessions) {
        schedulers.push(
          await config.getOrCreateScheduler(sessionId, callbacks),
        );
      }

      // All schedulers should be different
      expect(schedulers[0]).not.toBe(schedulers[1]);
      expect(schedulers[1]).not.toBe(schedulers[2]);
      expect(schedulers[0]).not.toBe(schedulers[2]);
    });
  });
});
