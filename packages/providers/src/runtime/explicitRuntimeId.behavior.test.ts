/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  resetCliRuntimeRegistryForTesting,
  runtimeRegistry,
  getDefaultCliRuntimeId,
  setDefaultCliRuntimeId,
} from './runtimeRegistry.js';
import { configureCliStatelessHardening } from './statelessHardening.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
} from './runtimeLifecycle.js';
import { getCliOAuthManager } from './runtimeAccessors.js';
import {
  resetRuntimeScopeForTesting,
  runWithRuntimeScope,
} from './runtimeContextFactory.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import type {
  Config,
  RuntimeProviderManager,
  MessageBus,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { OAuthManager } from '../auth/index.js';

/**
 * Behavioral tests for explicit runtimeId at composition boundaries
 * (issue #2300).
 *
 * registerCliProviderInfrastructure must accept an explicit runtimeId and
 * register on it regardless of stale/other ambient state.
 * setCliRuntimeContext must set the default CLI runtime pointer.
 */
describe('explicit runtimeId at composition boundaries (issue #2300)', () => {
  let mockConfig: Config;
  let mockSettingsService: SettingsService;
  let mockRuntimeProviderManager: RuntimeProviderManager;
  let mockOAuthManager: OAuthManager;
  let mockMessageBus: MessageBus;

  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
    resetRuntimeScopeForTesting();

    mockConfig = {
      getModel: vi.fn().mockReturnValue('gpt-4'),
      getProvider: vi.fn().mockReturnValue('openai'),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi.fn(),
      setEphemeralSetting: vi.fn(),
      setProviderManager: vi.fn(),
      setProvider: vi.fn(),
      setModel: vi.fn(),
    } as unknown as Config;

    mockSettingsService = {
      get: vi.fn(),
      getProviderSettings: vi.fn().mockReturnValue({}),
      setProviderSetting: vi.fn(),
      set: vi.fn(),
    } as unknown as SettingsService;

    mockRuntimeProviderManager = {
      getActiveProvider: vi.fn(),
      getActiveProviderName: vi.fn(),
      listProviders: vi.fn().mockReturnValue([]),
      getProviderMetrics: vi.fn().mockReturnValue({}),
      getSessionTokenUsage: vi.fn().mockReturnValue({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      }),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      setConfig: vi.fn(),
      prepareStatelessProviderInvocation: vi.fn(),
    } as unknown as RuntimeProviderManager;

    mockOAuthManager = {
      configureProactiveRenewalsForProfile: vi.fn(),
    } as unknown as OAuthManager;

    mockMessageBus = {} as unknown as MessageBus;
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
    resetRuntimeScopeForTesting();
  });

  describe('registerCliProviderInfrastructure with explicit runtimeId', () => {
    it('registers infrastructure on the explicit runtimeId regardless of ambient ALS state', () => {
      const explicitRuntimeId = 'explicit-runtime-1';

      // Set up a DIFFERENT ambient ALS scope to prove it does not hijack
      runWithRuntimeScope({ runtimeId: 'ambient-stale', metadata: {} }, () => {
        registerCliProviderInfrastructure(
          mockRuntimeProviderManager,
          mockOAuthManager,
          {
            messageBus: mockMessageBus,
            runtimeId: explicitRuntimeId,
          },
        );
      });

      const entry = runtimeRegistry.get(explicitRuntimeId);
      expect(entry).toBeDefined();
      expect(entry?.providerManager).toBe(mockRuntimeProviderManager);
      expect(entry?.oauthManager).toBe(mockOAuthManager);

      // The ambient runtime should NOT have been written
      const ambientEntry = runtimeRegistry.get('ambient-stale');
      expect(ambientEntry).toBeUndefined();
    });

    it('uses options.metadata when provided', () => {
      const explicitRuntimeId = 'explicit-runtime-2';
      const metadata = { source: 'explicit', custom: true };

      registerCliProviderInfrastructure(
        mockRuntimeProviderManager,
        mockOAuthManager,
        {
          messageBus: mockMessageBus,
          runtimeId: explicitRuntimeId,
          metadata,
        },
      );

      const entry = runtimeRegistry.get(explicitRuntimeId);
      expect(entry?.metadata).toMatchObject(metadata);
    });

    it('getCliOAuthManager throws when no ALS scope and no default pointer are set', () => {
      expect(() => getCliOAuthManager()).toThrow(/No active runtime/);
    });

    it('getCliOAuthManager throws when default pointer is set but not registered', () => {
      setDefaultCliRuntimeId('cli-default-unregistered');
      expect(() => getCliOAuthManager()).toThrow(/No active runtime/);
    });

    it('getCliOAuthManager does not resolve via unregistered ambient ALS when no default pointer is set', () => {
      const explicitRuntimeId = 'explicit-runtime-3';

      runWithRuntimeScope({ runtimeId: 'als-different', metadata: {} }, () => {
        registerCliProviderInfrastructure(
          mockRuntimeProviderManager,
          mockOAuthManager,
          {
            messageBus: mockMessageBus,
            runtimeId: explicitRuntimeId,
          },
        );

        expect(() => getCliOAuthManager()).toThrow(/No active runtime/);
      });

      expect(runtimeRegistry.has(explicitRuntimeId)).toBe(true);
      expect(runtimeRegistry.has('als-different')).toBe(false);
    });
  });

  describe('setCliRuntimeContext sets default CLI runtime pointer', () => {
    it('sets the default CLI runtime id pointer', () => {
      const runtimeId = 'cli-default-1';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      expect(getDefaultCliRuntimeId()).toBe(runtimeId);
    });

    it('allows getCliOAuthManager to resolve the registered manager via default pointer', () => {
      const runtimeId = 'cli-default-2';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      registerCliProviderInfrastructure(
        mockRuntimeProviderManager,
        mockOAuthManager,
        {
          messageBus: mockMessageBus,
          runtimeId,
        },
      );

      runWithRuntimeScope(
        { runtimeId: 'unregistered-default-fallback', metadata: {} },
        () => {
          const oauth = getCliOAuthManager();
          expect(oauth).toBe(mockOAuthManager);
        },
      );
    });

    it('resolves getCliOAuthManager via default pointer with no ALS scope at all', () => {
      const runtimeId = 'cli-default-no-als';
      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });
      registerCliProviderInfrastructure(
        mockRuntimeProviderManager,
        mockOAuthManager,
        { messageBus: mockMessageBus, runtimeId },
      );

      resetRuntimeScopeForTesting();
      const oauth = getCliOAuthManager();
      expect(oauth).toBe(mockOAuthManager);
    });
  });

  describe('getCliOAuthManager resolves via default pointer after explicit registration', () => {
    it('getCliOAuthManager resolves the manager registered by explicit runtimeId even with no prior ambient state', () => {
      const runtimeId = 'prepare-runtime-1';

      registerCliProviderInfrastructure(
        mockRuntimeProviderManager,
        mockOAuthManager,
        {
          messageBus: mockMessageBus,
          runtimeId,
        },
      );

      setCliRuntimeContext(mockSettingsService, mockConfig, { runtimeId });

      runWithRuntimeScope(
        { runtimeId: 'unregistered-prepare-fallback', metadata: {} },
        () => {
          const oauth = getCliOAuthManager();
          expect(oauth).toBe(mockOAuthManager);
        },
      );
    });
  });

  describe('isolated runtime does not hijack default CLI runtime', () => {
    it('an isolated runtime registered before bootstrap does not become the default', () => {
      const isolatedId = 'isolated-before-bootstrap';
      const cliId = 'cli-bootstrap-id';

      // Register an isolated runtime via the real API without setting default.
      setCliRuntimeContext(mockSettingsService, mockConfig, {
        runtimeId: isolatedId,
        setAsDefault: false,
      });
      // Bootstrap the CLI runtime which SHOULD be the default
      setCliRuntimeContext(mockSettingsService, mockConfig, {
        runtimeId: cliId,
      });

      expect(getDefaultCliRuntimeId()).toBe(cliId);
      expect(getDefaultCliRuntimeId()).not.toBe(isolatedId);
    });
  });
});
