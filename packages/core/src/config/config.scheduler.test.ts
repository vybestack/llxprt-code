/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Config } from './config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ToolSchedulerFactoryOptions } from '../core/toolSchedulerContract.js';

const AgentClient = vi.fn().mockImplementation(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  hasChatInitialized: vi.fn().mockReturnValue(false),
  getHistory: vi.fn().mockResolvedValue([]),
  getHistoryService: vi.fn().mockReturnValue(null),
  storeHistoryForLaterUse: vi.fn(),
  storeHistoryServiceForReuse: vi.fn(),
  dispose: vi.fn(),
}));

class CoreToolScheduler {
  creationOptions: ToolSchedulerFactoryOptions;
  constructor(options: ToolSchedulerFactoryOptions) {
    this.creationOptions = options;
  }
  schedule = vi.fn().mockResolvedValue(undefined);
  cancelAll = vi.fn();
  dispose = vi.fn();
  setCallbacks = vi.fn();
  handleConfirmationResponse = vi.fn().mockResolvedValue(undefined);
}

describe('Config - CoreToolScheduler registry', () => {
  let config: Config;
  let sessionMessageBus: MessageBus;
  const testOwner = { sessionId: 'test-session-123' };

  beforeEach(async () => {
    // Create a minimal Config instance for testing
    const mockSettingsService = {
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
    } as unknown as SettingsService;

    const configParams = {
      sessionId: 'config-level-session',
      targetDir: process.cwd(),
      debugMode: false,
      cwd: process.cwd(),
      model: 'gemini-pro',
      settingsService: mockSettingsService,
      eventEmitter: undefined,
      // @plan PLAN-20260610-ISSUE1592.P01
      // @requirement REQ-INV-001
      agentClientFactory: (cfg, runtimeState) =>
        new AgentClient(cfg, runtimeState),
      // @plan PLAN-20260610-ISSUE1592.P01
      // @requirement REQ-INV-002
      toolSchedulerFactory: (options) => new CoreToolScheduler(options),
    };

    config = new Config(configParams);
    sessionMessageBus = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    await config.initialize({ messageBus: sessionMessageBus });
  });

  const getScheduler = (
    owner: object,
    callbacks: {
      outputUpdateHandler: ReturnType<typeof vi.fn>;
      onAllToolCallsComplete: ReturnType<typeof vi.fn>;
      getPreferredEditor: ReturnType<typeof vi.fn>;
      onEditorClose: ReturnType<typeof vi.fn>;
    },
    options?: { interactiveMode?: boolean },
  ) =>
    config.getOrCreateScheduler(owner, 'session', callbacks, options, {
      messageBus: sessionMessageBus,
    });

  describe('getOrCreateScheduler', () => {
    it('rejects creation without an explicit session/runtime MessageBus', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      await expect(
        config.getOrCreateScheduler(testOwner, 'session', callbacks),
      ).rejects.toThrow(
        'Config.getOrCreateScheduler requires an explicit session/runtime MessageBus dependency.',
      );
    });

    it('should create a new scheduler instance for an owner if none exists', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler1 = await getScheduler(testOwner, callbacks);

      expect(scheduler1).toBeInstanceOf(CoreToolScheduler);
      expect(scheduler1).toBeDefined();
    });

    it('should return the same scheduler instance for the same owner and purpose', async () => {
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

      const scheduler1 = await getScheduler(testOwner, callbacks1);
      const scheduler2 = await getScheduler(testOwner, callbacks2);

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
        getScheduler(testOwner, callbacks),
        getScheduler(testOwner, callbacks),
      ]);

      expect(scheduler1).toBe(scheduler2);
    });

    it('should create different scheduler instances for different owners with the same label', async () => {
      const otherOwner = { sessionId: 'test-session-123' };

      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler1 = await getScheduler(testOwner, callbacks);
      const scheduler2 = await getScheduler(otherOwner, callbacks);

      expect(scheduler1).not.toBe(scheduler2);
    });

    it('should apply the latest acquirer callbacks on reuse', async () => {
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

      const scheduler = await getScheduler(testOwner, callbacks1);
      await getScheduler(testOwner, callbacks2);

      const calls = (
        scheduler as unknown as {
          setCallbacks: { mock: { calls: Array<[Record<string, unknown>]> } };
        }
      ).setCallbacks.mock.calls;
      const latest = calls[calls.length - 1][0];

      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(latest.getPreferredEditor).toBe(callbacks2.getPreferredEditor);
      expect(latest.onEditorClose).toBe(callbacks2.onEditorClose);
      expect(latest.outputUpdateHandler).toBe(callbacks2.outputUpdateHandler);
      expect(latest.config).toBe(config);
      expect(latest.messageBus).toBe(sessionMessageBus);
    });

    it('should forward interactiveMode into scheduler creation options', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await getScheduler(testOwner, callbacks, {
        interactiveMode: false,
      });

      expect(
        (scheduler as unknown as CoreToolScheduler).creationOptions
          .toolContextInteractiveMode,
      ).toBe(false);
    });
  });

  describe('disposeScheduler', () => {
    it('should dispose and remove the scheduler for an owner and purpose', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await getScheduler(testOwner, callbacks);

      // Dispose
      config.disposeScheduler(testOwner, 'session');

      // Try to get a new scheduler - it should be a new instance, not the same one
      const newScheduler = await getScheduler(testOwner, callbacks);
      expect(newScheduler).toBeDefined();
      expect(newScheduler).not.toBe(scheduler);
    });

    it('should not throw if disposing a scheduler that was never acquired', () => {
      const nonExistentOwner = { sessionId: 'non-existent-session' };

      expect(() => {
        config.disposeScheduler(nonExistentOwner, 'session');
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

      const scheduler = await getScheduler(testOwner, callbacks);

      // Add a second reference
      await getScheduler(testOwner, callbacks);

      // Dispose once should keep scheduler alive due to refCount
      config.disposeScheduler(testOwner, 'session');
      const stillExisting = await getScheduler(testOwner, callbacks);
      expect(stillExisting).toBe(scheduler);

      // Clean up remaining references
      config.disposeScheduler(testOwner, 'session');
      config.disposeScheduler(testOwner, 'session');
    });

    it('should properly dispose the scheduler instance', async () => {
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const scheduler = await getScheduler(testOwner, callbacks);

      // Spy on the dispose method
      const disposeSpy = vi.spyOn(
        scheduler as { dispose: () => void },
        'dispose',
      );

      config.disposeScheduler(testOwner, 'session');

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

      const scheduler = await getScheduler(testOwner, callbacks);

      vi.spyOn(
        scheduler as { dispose: () => void },
        'dispose',
      ).mockImplementation(() => {
        throw new Error('dispose failed');
      });

      expect(() => {
        config.disposeScheduler(testOwner, 'session');
      }).not.toThrow();

      const newScheduler = await getScheduler(testOwner, callbacks);
      expect(newScheduler).not.toBe(scheduler);
    });
  });

  describe('Integration: Single scheduler per owner', () => {
    it('should ensure only one CoreToolScheduler instance exists per owner across multiple components', async () => {
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

      const schedulerFromComponent1 = await getScheduler(
        testOwner,
        component1Callbacks,
      );
      const schedulerFromComponent2 = await getScheduler(
        testOwner,
        component2Callbacks,
      );

      // Both components get the same scheduler instance
      expect(schedulerFromComponent1).toBe(schedulerFromComponent2);
    });

    it('should handle multiple owners with separate schedulers', async () => {
      const owners = [
        { sessionId: 'owner-1' },
        { sessionId: 'owner-2' },
        { sessionId: 'owner-3' },
      ];
      const callbacks = {
        outputUpdateHandler: vi.fn(),
        onAllToolCallsComplete: vi.fn(),
        onToolCallsUpdate: vi.fn(),
        getPreferredEditor: () => undefined,
        onEditorClose: vi.fn(),
      };

      const schedulers = await Promise.all(
        owners.map((owner) => getScheduler(owner, callbacks)),
      );

      // All schedulers should be different
      expect(schedulers[0]).not.toBe(schedulers[1]);
      expect(schedulers[1]).not.toBe(schedulers[2]);
      expect(schedulers[0]).not.toBe(schedulers[2]);
    });
  });
});
