import { SessionSettingsOwner } from '../session/session-settings-owner.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from './configTypes.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeSettingsService } from '../runtime/settingsRuntimeAdapter.js';

import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  createBaseParams,
  createSettingsServiceMock,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './__tests__/configTestHarness.js';

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
} as HoistedConfigMocks;
// Exposed for assertions in the Proxy Configuration tests below.
const mockCoreEvents = hoistedConfigMocks.coreEvents;
const mockSetGlobalProxy = hoistedConfigMocks.setGlobalProxy;

const __actual = { ...(await import('fs')) };
void vi.mock('fs', () => buildFsMockBody(__actual));

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual2 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () =>
  buildToolsMockBody(__actual2),
);

// Mock individual tools if their constructors are complex or have side effects

const __actual3 = { ...(await import('../core/contentGenerator.js')) };
void vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual3),
);

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

const __actual4 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
void vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual4),
);

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual5 = { ...(await import('../utils/events.js')) };
void vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual5, hoistedConfigMocks),
);

void vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

describe('Server Config (config.ts)', () => {
  // One shared spy-backed service: baseParams and the integration describe
  // below must observe the same instance (issue #2616 removed the module
  // singleton that previously guaranteed this identity).
  const settingsServiceMock = createSettingsServiceMock();
  const baseParams = createBaseParams(
    settingsServiceMock as unknown as SettingsService,
  );

  beforeEach(() => {
    resetAgentClientMock();
  });
  describe('Telemetry Settings', () => {
    it('should return provided logPrompts setting', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true, logPrompts: false },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(false);
    });

    it('should return default logPrompts setting (true) if not provided', () => {
      const params: ConfigParameters = {
        ...baseParams,
        telemetry: { enabled: true },
      };
      const config = new Config(params);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should return default logPrompts setting (true) if telemetry object is not provided', () => {
      const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
      delete paramsWithoutTelemetry.telemetry;
      const config = new Config(paramsWithoutTelemetry);
      expect(config.getTelemetryLogPromptsEnabled()).toBe(true);
    });

    it('should default logApiBodies to false and logApiBodyMaxChars to 4000', () => {
      const config = new Config({
        ...baseParams,
        telemetry: { enabled: true },
      });
      expect(config.getTelemetryLogApiBodiesEnabled()).toBe(false);
      expect(config.getTelemetryLogApiBodyMaxChars()).toBe(4000);
    });

    it('should honor explicit logApiBodies and logApiBodyMaxChars', () => {
      const config = new Config({
        ...baseParams,
        telemetry: {
          enabled: true,
          logApiBodies: true,
          logApiBodyMaxChars: 1234,
        },
      });
      expect(config.getTelemetryLogApiBodiesEnabled()).toBe(true);
      expect(config.getTelemetryLogApiBodyMaxChars()).toBe(1234);
    });

    it('should default outfileMaxBytes to 100 MiB and outfileMaxFiles to 10', () => {
      const config = new Config({
        ...baseParams,
        telemetry: { enabled: true },
      });
      expect(config.getTelemetryOutfileMaxBytes()).toBe(104857600);
      expect(config.getTelemetryOutfileMaxFiles()).toBe(10);
    });

    it('should honor explicit outfileMaxBytes and outfileMaxFiles', () => {
      const config = new Config({
        ...baseParams,
        telemetry: {
          enabled: true,
          outfileMaxBytes: 65536,
          outfileMaxFiles: 3,
        },
      });
      expect(config.getTelemetryOutfileMaxBytes()).toBe(65536);
      expect(config.getTelemetryOutfileMaxFiles()).toBe(3);
    });

    it('resolveTelemetrySettings materializes defaults when callers pass explicit undefined (CLI builder contract)', () => {
      // The CLI buildTelemetryConfig emits every key, including undefined for
      // unset ones; the resolver must turn those into defaults, not carry the
      // undefined through to getTelemetrySettings().
      const config = new Config({
        ...baseParams,
        telemetry: {
          enabled: true,
          logApiBodies: undefined,
          logApiBodyMaxChars: undefined,
          outfileMaxBytes: undefined,
          outfileMaxFiles: undefined,
        },
      });
      const resolved = config.getTelemetrySettings();
      expect(resolved.logApiBodies).toBe(false);
      expect(resolved.logApiBodyMaxChars).toBe(4000);
      expect(resolved.outfileMaxBytes).toBe(104857600);
      expect(resolved.outfileMaxFiles).toBe(10);
    });

    it('resolveTelemetrySettings preserves explicit false and zero values (?? not ||)', () => {
      // Body redaction is opt-in: an explicit logApiBodies:false must survive
      // resolution, and a falsy-but-valid logApiBodyMaxChars:0 must not be
      // clobbered by the 4000 default. A || regression would flip both.
      const config = new Config({
        ...baseParams,
        telemetry: {
          enabled: true,
          logApiBodies: false,
          logApiBodyMaxChars: 0,
          outfileMaxBytes: 4096,
          outfileMaxFiles: 1,
        },
      });
      const resolved = config.getTelemetrySettings();
      expect(resolved.logApiBodies).toBe(false);
      expect(resolved.logApiBodyMaxChars).toBe(0);
      expect(resolved.outfileMaxBytes).toBe(4096);
      expect(resolved.outfileMaxFiles).toBe(1);
    });

    it('updateTelemetrySettings merges the new fields', async () => {
      const config = new Config({
        ...baseParams,
        telemetry: {
          enabled: true,
          logApiBodies: false,
          outfileMaxBytes: 104857600,
        },
      });
      const selected = new SessionSettingsOwner(new SettingsService());
      selected.bindTelemetry(config);
      await selected.updateTelemetrySettings({
        logApiBodies: true,
        logApiBodyMaxChars: 500,
        outfileMaxBytes: 1000,
        outfileMaxFiles: 2,
      });
      expect(selected.readTelemetrySettings().logApiBodies).toBe(true);
      expect(selected.readTelemetrySettings().logApiBodyMaxChars).toBe(500);
      expect(selected.readTelemetrySettings().outfileMaxBytes).toBe(1000);
      expect(selected.readTelemetrySettings().outfileMaxFiles).toBe(2);
      // Defaults still apply for untouched values.
      expect(selected.readTelemetrySettings().logPrompts).toBe(true);
      await selected.dispose();
    });
  });

  describe('Session settings ownership separate from Config construction', () => {
    let store: SettingsService;
    let owner: SessionSettingsOwner;
    beforeEach(() => {
      store = new SettingsService();
      owner = new SessionSettingsOwner(store);
    });
    afterEach(() => owner.dispose());

    it('reads distinct named settings from the exact adopted store', () => {
      store.set('model', 'stored-value-for-model');
      store.set('viewModel', 'stored-value-for-viewModel');
      expect(owner.readNamedParameter('model')).toBe('stored-value-for-model');
      expect(owner.readNamedParameter('viewModel')).toBe(
        'stored-value-for-viewModel',
      );
    });
    it('persists a parameter without creating unrelated store keys', () => {
      owner.writeUserParameter('temperature', 0.8);
      expect(store.get('temperature')).toBe(0.8);
      expect(Object.keys(store.getAllGlobalSettings())).toStrictEqual([
        'temperature',
      ]);
    });
    it('keeps runtime settings outside the immutable Config declaration', () => {
      const config = new Config(baseParams);
      owner.writeUserParameter('test', 'value');
      expect(Object.getOwnPropertyNames(config)).not.toContain(
        'ephemeralSettings',
      );
      expect(config.getInitialSettings()).not.toHaveProperty('test');
    });
    it('completes write then read synchronously', () => {
      owner.writeUserParameter('instant', 'written-before-read');
      expect(owner.readNamedParameter('instant')).toBe('written-before-read');
    });
    it('keeps multiple synchronous writes separate', () => {
      owner.writeUserParameter('provider', 'provider1');
      owner.writeUserParameter('model', 'model1');
      owner.writeUserParameter('temperature', 0.7);
      expect(owner.readNamedParameter('provider')).toBe('provider1');
      expect(owner.readNamedParameter('model')).toBe('model1');
      expect(owner.readNamedParameter('temperature')).toBe(0.7);
    });
    it('reads typed values without conflating absent keys', () => {
      store.set('stringValue', 'test string');
      store.set('numberValue', 42);
      store.set('booleanValue', true);
      store.set('objectValue', { nested: 'object' });
      store.set('arrayValue', [1, 2, 3]);
      expect(owner.readNamedParameter('stringValue')).toBe('test string');
      expect(owner.readNamedParameter('numberValue')).toBe(42);
      expect(owner.readNamedParameter('booleanValue')).toBe(true);
      expect(owner.readNamedParameter('objectValue')).toStrictEqual({
        nested: 'object',
      });
      expect(owner.readNamedParameter('arrayValue')).toStrictEqual([1, 2, 3]);
      expect(owner.readNamedParameter('undefinedValue')).toBeUndefined();
      expect(Object.keys(store.getAllGlobalSettings())).toHaveLength(5);
    });
    it('normalizes persisted numeric string context limits while reading', () => {
      store.set('context-limit', '190000');
      expect(owner.readRuntimePolicy().contextLimit).toBe(190000);
      expect(store.get('context-limit')).toBe(190000);
      expect(typeof store.get('context-limit')).toBe('number');
    });
    it('persists typed values through owner operations', () => {
      const values = {
        stringValue: 'test string',
        numberValue: 42,
        booleanValue: true,
        objectValue: { nested: 'object' },
        arrayValue: [1, 2, 3],
        nullValue: null,
      };
      for (const [key, value] of Object.entries(values)) {
        owner.writeUserParameter(key, value);
        expect(store.get(key)).toStrictEqual(value);
      }
      expect(Object.keys(store.getAllGlobalSettings())).toHaveLength(6);
    });
    it('normalizes numeric string context limits before persisting', () => {
      owner.writeUserParameter('context-limit', '190000');
      expect(store.get('context-limit')).toBe(190000);
    });
    it('observes clearing performed by the borrowed store owner', () => {
      owner.writeUserParameter('temperature', 0.8);
      store.clear();
      expect(owner.captureNamedParameters()).toStrictEqual({});
    });
    it('adopts only the original settings identity without taking its lifetime', async () => {
      expect(() => owner.assertSettingsIdentity(store)).not.toThrow();
      expect(() => owner.assertSettingsIdentity(new SettingsService())).toThrow(
        'original store',
      );
      await owner.dispose();
      store.set('temperature', 0.4);
      expect(store.get('temperature')).toBe(0.4);
    });
  });

  describe('UseRipgrep Configuration', () => {
    it('should default useRipgrep to false when not provided', () => {
      const config = new Config(baseParams);
      expect(config.getUseRipgrep()).toBe(false);
    });

    it('should set useRipgrep to true when provided as true', () => {
      const paramsWithRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: true,
      };
      const config = new Config(paramsWithRipgrep);
      expect(config.getUseRipgrep()).toBe(true);
    });

    it('should set useRipgrep to false when explicitly provided as false', () => {
      const paramsWithRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: false,
      };
      const config = new Config(paramsWithRipgrep);
      expect(config.getUseRipgrep()).toBe(false);
    });

    it('should default useRipgrep to false when undefined', () => {
      const paramsWithUndefinedRipgrep: ConfigParameters = {
        ...baseParams,
        useRipgrep: undefined,
      };
      const config = new Config(paramsWithUndefinedRipgrep);
      expect(config.getUseRipgrep()).toBe(false);
    });
  });

  describe('ImagePayloadBudget Configuration', () => {
    it('defaults to the conservative image payload budget', () => {
      const config = new Config(baseParams);
      expect(config.getImagePayloadBudgetBytes()).toBe(
        DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
      );
    });

    it('preserves an explicit zero to disable image budget enforcement', () => {
      const config = new Config({ ...baseParams, imagePayloadBudgetBytes: 0 });
      expect(config.getImagePayloadBudgetBytes()).toBe(0);
    });

    it('reads persisted media budgets from the shared settings path', () => {
      const settingsService = createRuntimeSettingsService();
      settingsService.set('image-payload-budget-bytes', 12_000_000);
      settingsService.set('media-store-quota-bytes', 3_000_000_000);
      settingsService.set('session-recording-queue-max-bytes', 8_000_000);
      settingsService.set('session-persistence-queue-max-bytes', 7_000_000);
      const config = new Config({
        ...baseParams,
        initialSettings: settingsService.getAllGlobalSettings(),
      });

      expect(config.getImagePayloadBudgetBytes()).toBe(12_000_000);
      expect(config.getMediaStoreQuotaByteLimit()).toBe(3_000_000_000);
      expect(config.getSessionRecordingQueueByteLimit()).toBe(8_000_000);
      expect(config.getSessionPersistenceQueueByteLimit()).toBe(7_000_000);
    });

    it('uses shared media defaults while preserving explicit zero settings', () => {
      const defaults = new Config(baseParams);
      const settingsService = createRuntimeSettingsService();
      settingsService.set('media-store-quota-bytes', 0);
      settingsService.set('session-recording-queue-max-bytes', 0);
      settingsService.set('session-persistence-queue-max-bytes', 0);
      const disabled = new Config({
        ...baseParams,
        initialSettings: settingsService.getAllGlobalSettings(),
      });

      expect({
        media: defaults.getMediaStoreQuotaByteLimit(),
        recording: defaults.getSessionRecordingQueueByteLimit(),
        persistence: defaults.getSessionPersistenceQueueByteLimit(),
      }).toStrictEqual({
        media: 4 * 1024 * 1024 * 1024,
        recording: 16 * 1024 * 1024,
        persistence: 16 * 1024 * 1024,
      });
      expect(disabled.getMediaStoreQuotaByteLimit()).toBe(0);
      expect(disabled.getSessionRecordingQueueByteLimit()).toBe(0);
      expect(disabled.getSessionPersistenceQueueByteLimit()).toBe(0);
    });

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      1.5,
      -1,
    ])(
      'falls back to the default for invalid value %s',
      (imagePayloadBudgetBytes) => {
        const config = new Config({ ...baseParams, imagePayloadBudgetBytes });
        expect(config.getImagePayloadBudgetBytes()).toBe(
          DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
        );
      },
    );
  });

  describe('ContinueOnFailedApiCall Configuration', () => {
    it('should default continueOnFailedApiCall to true when not provided', () => {
      const config = new Config(baseParams);
      expect(config.getContinueOnFailedApiCall()).toBe(true);
    });

    it('should set continueOnFailedApiCall to true when provided as true', () => {
      const paramsWithContinueOnFailedApiCall: ConfigParameters = {
        ...baseParams,
        continueOnFailedApiCall: true,
      };
      const config = new Config(paramsWithContinueOnFailedApiCall);
      expect(config.getContinueOnFailedApiCall()).toBe(true);
    });

    it('should set continueOnFailedApiCall to false when explicitly provided as false', () => {
      const paramsWithContinueOnFailedApiCall: ConfigParameters = {
        ...baseParams,
        continueOnFailedApiCall: false,
      };
      const config = new Config(paramsWithContinueOnFailedApiCall);
      expect(config.getContinueOnFailedApiCall()).toBe(false);
    });
  });

  describe('PTY terminal size configuration', () => {
    it('should accept only positive finite PTY dimensions', () => {
      const config = new Config(baseParams);

      config.setPtyTerminalSize(120.9, 40.1);
      expect(config.getPtyTerminalWidth()).toBe(120);
      expect(config.getPtyTerminalHeight()).toBe(40);

      config.setPtyTerminalSize(0, 25);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBe(25);

      config.setPtyTerminalSize(-10, Number.NaN);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBeUndefined();

      config.setPtyTerminalSize(Number.POSITIVE_INFINITY, -1);
      expect(config.getPtyTerminalWidth()).toBeUndefined();
      expect(config.getPtyTerminalHeight()).toBeUndefined();
    });
  });

  describe('Proxy Configuration Error Handling', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should call setGlobalProxy when proxy is configured', () => {
      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'http://proxy.example.com:8080',
      };
      new Config(paramsWithProxy);

      expect(mockSetGlobalProxy).toHaveBeenCalledWith(
        'http://proxy.example.com:8080',
      );
    });

    it('should not call setGlobalProxy when proxy is not configured', () => {
      new Config(baseParams);

      expect(mockSetGlobalProxy).not.toHaveBeenCalled();
    });

    it('should emit error feedback when setGlobalProxy throws an error', () => {
      const proxyError = new Error('Invalid proxy URL');
      mockSetGlobalProxy.mockImplementation(() => {
        throw proxyError;
      });

      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'invalid-proxy',
      };
      new Config(paramsWithProxy);

      expect(mockCoreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        'Invalid proxy configuration detected. Check debug drawer for more details (F12)',
        proxyError,
      );
    });

    it('should not emit error feedback when setGlobalProxy succeeds', () => {
      mockSetGlobalProxy.mockImplementation(() => {
        // Success - no error thrown
      });

      const paramsWithProxy: ConfigParameters = {
        ...baseParams,
        proxy: 'http://proxy.example.com:8080',
      };
      new Config(paramsWithProxy);

      expect(mockCoreEvents.emitFeedback).not.toHaveBeenCalled();
    });
  });
});
