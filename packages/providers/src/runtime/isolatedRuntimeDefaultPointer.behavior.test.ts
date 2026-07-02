/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Config,
  MessageBus,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { ProviderManager } from '../ProviderManager.js';
import { getProviderManager } from '../composition/index.js';
import type { OAuthManager } from '../auth/index.js';
import { runtimeRegistry } from './runtimeRegistry.js';
import {
  activateIsolatedRuntimeContext,
  configureCliStatelessHardening,
  createIsolatedRuntimeContext,
  getCliOAuthManager,
  getDefaultCliRuntimeId,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  resetCliRuntimeRegistryForTesting,
  resetRuntimeScopeForTesting,
  runWithRuntimeScope,
  setCliRuntimeContext,
  setDefaultCliRuntimeId,
  validateRuntimeId,
} from './runtimeSettings.js';

/**
 * @plan PLAN-20260630-ISSUE2300
 * Behavioral tests proving isolated runtimes never overwrite or clear the
 * CLI default runtime pointer.
 *
 * The test exercises the real createIsolatedRuntimeContext → activate →
 * cleanup path and asserts:
 *   1. After activating an isolated runtime, the CLI default pointer is
 *      unchanged (still the CLI bootstrap runtime id).
 *   2. getCliOAuthManager outside the isolated ALS scope still resolves the
 *      CLI OAuth manager.
 *   3. After cleaning up the isolated runtime, the CLI default pointer and
 *      CLI OAuth manager are still intact.
 */
describe('isolated runtime never mutates the CLI default pointer (issue #2300)', () => {
  let cliSettingsService: SettingsService;
  let cliConfig: Config;
  let cliProviderManager: RuntimeProviderManager;
  let cliOAuthManager: OAuthManager;
  let cliMessageBus: MessageBus;
  const cliRuntimeId = 'cli-bootstrap-default';
  const activeHandles: Array<{ cleanup: () => Promise<void> | void }> = [];

  function createTrackedIsolatedRuntimeContext(
    options: Parameters<typeof createIsolatedRuntimeContext>[0],
  ): ReturnType<typeof createIsolatedRuntimeContext> {
    const handle = createIsolatedRuntimeContext(options);
    activeHandles.push(handle);
    return handle;
  }

  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();

    cliSettingsService = new SettingsService();
    cliConfig = createRuntimeConfigStub(cliSettingsService, {
      setProviderManager: vi.fn(),
      getPolicyEngine: vi.fn().mockReturnValue({}),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue({ model: 'test-model' }),
    });
    cliProviderManager = new ProviderManager({
      settingsService: cliSettingsService,
      config: cliConfig,
    });
    cliOAuthManager = {
      configureProactiveRenewalsForProfile: vi.fn(),
    } as unknown as OAuthManager;
    cliMessageBus = {} as unknown as MessageBus;

    // Establish the CLI bootstrap runtime — this SHOULD be the default.
    setCliRuntimeContext(cliSettingsService, cliConfig, {
      runtimeId: cliRuntimeId,
    });
    registerCliProviderInfrastructure(cliProviderManager, cliOAuthManager, {
      messageBus: cliMessageBus,
      runtimeId: cliRuntimeId,
    });
  });

  afterEach(async () => {
    await Promise.all(
      activeHandles.map((handle) =>
        Promise.resolve(handle.cleanup()).catch(() => undefined),
      ),
    );
    activeHandles.length = 0;
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
    resetRuntimeScopeForTesting();
  });

  it('activating an isolated runtime does not overwrite the CLI default pointer', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-no-default-overwrite',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await activateIsolatedRuntimeContext(handle, {
          runtimeId: handle.runtimeId,
        });
      },
    );

    // After the isolated scope exits, the CLI default pointer must remain the
    // CLI bootstrap id, NOT the isolated runtime id.
    expect(getDefaultCliRuntimeId()).toBe(cliRuntimeId);
    expect(getDefaultCliRuntimeId()).not.toBe(handle.runtimeId);

    expect(getCliOAuthManager()).toBe(cliOAuthManager);
  });

  it('activating an isolated runtime through the wrapper does not overwrite the provider singleton', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-no-singleton-overwrite',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await activateIsolatedRuntimeContext(handle, {
          runtimeId: handle.runtimeId,
        });
      },
    );

    expect(getProviderManager()).toBe(cliProviderManager);
  });

  it('direct handle activation does not clear CLI provider or OAuth infrastructure', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-direct-activation-safe',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await handle.activate({ runtimeId: handle.runtimeId });
      },
    );

    const cliEntry = runtimeRegistry.get(cliRuntimeId);
    expect(cliEntry?.providerManager).toBe(cliProviderManager);
    expect(cliEntry?.oauthManager).toBe(cliOAuthManager);
    expect(getProviderManager()).toBe(cliProviderManager);
    expect(getCliOAuthManager()).toBe(cliOAuthManager);
  });

  it('getCliOAuthManager outside the isolated ALS scope resolves the CLI manager', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-oauth-resolution',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await activateIsolatedRuntimeContext(handle, {
          runtimeId: handle.runtimeId,
        });
      },
    );

    // Outside the isolated ALS scope, the default pointer drives resolution
    // and must return the CLI OAuth manager.
    const oauth = getCliOAuthManager();
    expect(oauth).toBe(cliOAuthManager);
  });

  it('cleaning up an isolated runtime does not clear the CLI default pointer or CLI OAuth manager', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-cleanup-safe',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await activateIsolatedRuntimeContext(handle, {
          runtimeId: handle.runtimeId,
        });
      },
    );
    await handle.cleanup();

    // After cleanup, the CLI default pointer is still intact.
    expect(getDefaultCliRuntimeId()).toBe(cliRuntimeId);

    // getCliOAuthManager outside any isolated ALS scope still returns the CLI
    // OAuth manager.
    const oauth = getCliOAuthManager();
    expect(oauth).toBe(cliOAuthManager);
  });

  it('an isolated runtime registered and activated inside runWithRuntimeScope does not become default', async () => {
    const handle = createTrackedIsolatedRuntimeContext({
      runtimeId: 'isolated-scoped-activation',
      workspaceDir: process.cwd(),
      model: 'isolated-model',
    });

    await runWithRuntimeScope(
      { runtimeId: handle.runtimeId, metadata: {} },
      async () => {
        await activateIsolatedRuntimeContext(handle, {
          runtimeId: handle.runtimeId,
        });

        // Inside the isolated ALS scope, getCliOAuthManager resolves the
        // isolated manager.
        const scopedOauth = getCliOAuthManager();
        expect(scopedOauth).toBe(handle.oauthManager);
      },
    );

    // Outside the scope, the default pointer is still the CLI runtime.
    expect(getDefaultCliRuntimeId()).toBe(cliRuntimeId);
    const oauth = getCliOAuthManager();
    expect(oauth).toBe(cliOAuthManager);
  });

  it('rejects an empty isolated runtimeId before constructing context resources', () => {
    expect(() =>
      createIsolatedRuntimeContext({
        runtimeId: '',
        workspaceDir: process.cwd(),
        model: 'isolated-model',
      }),
    ).toThrow(/Invalid runtimeId/);
  });
});

/**
 * @plan PLAN-20260630-ISSUE2300
 * Behavioral tests for runtime id validation at composition boundaries.
 */
describe('runtime id validation (issue #2300)', () => {
  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
    configureCliStatelessHardening(null);
    clearActiveProviderRuntimeContext();
  });

  describe('validateRuntimeId', () => {
    it('accepts a valid non-empty string', () => {
      expect(() => validateRuntimeId('valid-runtime-id')).not.toThrow();
    });

    it('rejects an empty string', () => {
      expect(() => validateRuntimeId('')).toThrow(/Invalid runtimeId/);
    });

    it('rejects a whitespace-only string', () => {
      expect(() => validateRuntimeId('   ')).toThrow(/Invalid runtimeId/);
      expect(() => validateRuntimeId('\t\n')).toThrow(/Invalid runtimeId/);
    });
  });

  describe('registerCliProviderInfrastructure rejects invalid runtimeId', () => {
    const manager = {
      setConfig: vi.fn(),
    } as unknown as RuntimeProviderManager;
    const oauth = {} as unknown as OAuthManager;
    const bus = {} as unknown as MessageBus;

    function registerWithRuntimeId(runtimeId: unknown): void {
      registerCliProviderInfrastructure(manager, oauth, {
        messageBus: bus,
        runtimeId: runtimeId as string,
      });
    }

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('rejects empty runtimeId without partial registration side effects', () => {
      expect(() => registerWithRuntimeId('')).toThrow(/Invalid runtimeId/);
      expect(manager.setConfig).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only runtimeId without partial registration side effects', () => {
      expect(() => registerWithRuntimeId('  ')).toThrow(/Invalid runtimeId/);
      expect(manager.setConfig).not.toHaveBeenCalled();
    });

    it('rejects non-string runtimeId values without partial registration side effects', () => {
      for (const runtimeId of [null, undefined, 123, false]) {
        expect(() => registerWithRuntimeId(runtimeId)).toThrow(
          /Invalid runtimeId/,
        );
      }
      expect(manager.setConfig).not.toHaveBeenCalled();
    });
  });

  describe('setCliRuntimeContext rejects invalid runtimeId', () => {
    const settings = new SettingsService();

    it('rejects empty runtimeId', () => {
      expect(() =>
        setCliRuntimeContext(settings, undefined, { runtimeId: '' }),
      ).toThrow(/Invalid runtimeId/);
    });

    it('rejects whitespace-only runtimeId', () => {
      expect(() =>
        setCliRuntimeContext(settings, undefined, { runtimeId: '\t ' }),
      ).toThrow(/Invalid runtimeId/);
    });
  });

  describe('setDefaultCliRuntimeId rejects invalid runtimeId', () => {
    it('rejects empty runtimeId', () => {
      expect(() => setDefaultCliRuntimeId('')).toThrow(/Invalid runtimeId/);
    });

    it('rejects whitespace-only runtimeId', () => {
      expect(() => setDefaultCliRuntimeId('  ')).toThrow(/Invalid runtimeId/);
    });

    it('accepts a valid runtimeId and sets the pointer', () => {
      setDefaultCliRuntimeId('valid-default');
      expect(getDefaultCliRuntimeId()).toBe('valid-default');
    });
  });

  describe('resetCliProviderInfrastructure rejects invalid runtimeId', () => {
    it('rejects reset with an explicit empty runtimeId without clearing active infrastructure', () => {
      const settings = new SettingsService();
      const config = createRuntimeConfigStub(settings, {
        setProviderManager: vi.fn(),
      });
      const manager = {
        setConfig: vi.fn(),
      } as unknown as RuntimeProviderManager;
      const oauth = {} as unknown as OAuthManager;
      const bus = {} as unknown as MessageBus;
      const runtimeId = 'active-reset-validation-runtime';

      setCliRuntimeContext(settings, config, { runtimeId });
      registerCliProviderInfrastructure(manager, oauth, {
        messageBus: bus,
        runtimeId,
      });

      expect(() => resetCliProviderInfrastructure('')).toThrow(
        /Invalid runtimeId/,
      );
      const entry = runtimeRegistry.get(runtimeId);
      expect(entry?.providerManager).toBe(manager);
      expect(entry?.oauthManager).toBe(oauth);
    });
  });
});
