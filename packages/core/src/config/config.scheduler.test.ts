/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { Config } from './config.js';
import type { ISettingsService } from '../settings/types.js';
import { clearAllSchedulers } from './schedulerSingleton.js';

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
    const mockSettingsService: ISettingsService = {
      get: vi.fn(),
      set: vi.fn(),
      getAllGlobalSettings: vi.fn(() => ({})),
      getProviderSettings: vi.fn(() => ({})),
      setProviderSetting: vi.fn(),
      clear: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ providers: {} }),
      updateSettings: vi.fn().mockResolvedValue(undefined),
      switchProvider: vi.fn().mockResolvedValue(undefined),
      exportForProfile: vi.fn().mockResolvedValue({
        defaultProvider: 'openai',
        providers: {},
        tools: { allowed: [], disabled: [] },
      }),
      importFromProfile: vi.fn().mockResolvedValue(undefined),
      setCurrentProfileName: vi.fn(),
      getCurrentProfileName: vi.fn().mockReturnValue(null),
      getDiagnosticsData: vi.fn().mockResolvedValue({
        provider: 'openai',
        model: 'unknown',
        profile: null,
        providerSettings: {},
        ephemeralSettings: {},
        modelParams: {},
        allSettings: { providers: {} },
      }),
      emit: vi.fn(),
      onSettingsChanged: vi.fn().mockReturnValue(() => {}),
    };

    const configParams = {
      sessionId: testSessionId,
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gemini-pro',
      settingsService: mockSettingsService,
      eventEmitter: undefined,
    };

    config = new Config(configParams);
    await config.initialize();

    clearAllSchedulers();
  });

  afterEach(() => {
    config.disposeScheduler(testSessionId);
    clearAllSchedulers();
  });

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

    it('should not create duplicate schedulers for concurrent requests', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const [scheduler1, scheduler2] = await Promise.all([
        config.getOrCreateScheduler(testSessionId, callbacks),
        config.getOrCreateScheduler(testSessionId, callbacks),
      ]);

      expect(scheduler1).toBe(scheduler2);
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

    it('should dispose scheduler entry even if dispose throws', async () => {
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

      vi.spyOn(
        scheduler as { dispose: () => void },
        'dispose',
      ).mockImplementation(() => {
        throw new Error('dispose failed');
      });

      expect(() => {
        config.disposeScheduler(testSessionId);
      }).not.toThrow();

      const newScheduler = await config.getOrCreateScheduler(
        testSessionId,
        callbacks,
      );
      expect(newScheduler).not.toBe(scheduler);
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

      const schedulers = await Promise.all(
        sessions.map((sessionId) =>
          config.getOrCreateScheduler(sessionId, callbacks),
        ),
      );

      // All schedulers should be different
      expect(schedulers[0]).not.toBe(schedulers[1]);
      expect(schedulers[1]).not.toBe(schedulers[2]);
      expect(schedulers[0]).not.toBe(schedulers[2]);
    });
  });
});
