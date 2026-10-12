/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  MessageBusType,
  type ToolConfirmationRequest,
} from '@vybestack/llxprt-code-policy/confirmation-bus/types.js';
import { createProviderConfigFixture } from './__tests__/provider-config-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createIsolatedRuntimeContext, listProviders } from './index.js';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';

function createOwner(
  settingsService: SettingsService,
  sessionId: string,
): ReturnType<typeof createProviderConfigFixture> {
  return createProviderConfigFixture({
    targetDir: process.cwd(),
    cwd: process.cwd(),
    sessionId,
    debugMode: false,
    model: `${sessionId}-model`,
    settingsService,
  });
}

describe('CLI foreground provider ownership', () => {
  it('binds the same runtime bus, provider manager, OAuth manager, and file lifecycle to the Config', () => {
    const settings = new SettingsService();
    const { config: config } = createOwner(settings, 'bundle-owner');
    const bundle = assembleCliProviderRuntime({
      settingsService: settings,
      config,
      runtimeId: 'bundle-owner',
    });

    expect('providerManager' in config).toBe(false);
    expect(bundle.oauthManager?.runtimeMessageBus).toBe(
      bundle.runtimeMessageBus,
    );
    expect(listProviders(bundle.providerManager)).toContain('openai');
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
    expect('providerManager' in config).toBe(false);
    expect(bundle.runtime.providerFileLifecycle).toBe(
      bundle.registration.providerFileLifecycle,
    );
    bundle.registration.dispose();
  });

  it('preserves supplied OAuth bus and pending caller confirmation during final assembly', async () => {
    const settings = new SettingsService();
    const early = assembleCliProviderRuntime({
      settingsService: settings,
      config: undefined,
      runtimeId: 'early-auth-owner',
    });
    const oauth = early.oauthManager;
    if (oauth === undefined) throw new Error('Missing early OAuth owner');
    const bus = early.runtimeMessageBus;
    let confirmation: ToolConfirmationRequest | undefined;
    const unsubscribe = bus.subscribe<ToolConfirmationRequest>(
      MessageBusType.TOOL_CONFIRMATION_REQUEST,
      (request) => {
        confirmation = request;
      },
    );
    const pending = bus.requestConfirmation({ name: 'privileged_unknown' }, {});
    const { config } = createOwner(settings, 'final-auth-owner');
    const final = assembleCliProviderRuntime({
      settingsService: settings,
      config,
      runtimeId: early.registration.runtimeId,
      registration: early.registration,
      oauthManager: oauth,
    });
    try {
      expect(final.oauthManager).toBe(oauth);
      expect(oauth.runtimeMessageBus).toBe(bus);
      if (confirmation === undefined)
        throw new Error('Missing caller confirmation');
      bus.publish({
        type: MessageBusType.TOOL_CONFIRMATION_RESPONSE,
        correlationId: confirmation.correlationId,
        confirmed: true,
      });
      expect(await pending).toBe(true);
    } finally {
      unsubscribe();
      await final.policyOwner?.dispose();
      final.registration.dispose();
    }
  });

  it('keeps concurrent equal-label roots independent across interleaved Config adoption and one cleanup', () => {
    const settingsA = new SettingsService();
    const settingsB = new SettingsService();
    const earlyA = assembleCliProviderRuntime({
      settingsService: settingsA,
      config: undefined,
      runtimeId: 'same-cli-label',
    });
    const earlyB = assembleCliProviderRuntime({
      settingsService: settingsB,
      config: undefined,
      runtimeId: 'same-cli-label',
    });
    const { config: configA } = createOwner(settingsA, 'foreground-a');
    const { config: configB } = createOwner(settingsB, 'foreground-b');
    settingsA.set('activeProvider', 'openai');
    settingsB.set('activeProvider', 'kimi');
    const runtimeB = assembleCliProviderRuntime({
      settingsService: settingsB,
      config: configB,
      runtimeId: 'same-cli-label',
      registration: earlyB.registration,
    });
    const runtimeA = assembleCliProviderRuntime({
      settingsService: settingsA,
      config: configA,
      runtimeId: 'same-cli-label',
      registration: earlyA.registration,
    });

    expect(runtimeA.registration).toBe(earlyA.registration);
    expect(runtimeB.registration).toBe(earlyB.registration);
    expect(runtimeA.registration.config).toBe(configA);
    expect(runtimeB.registration.config).toBe(configB);
    expect(runtimeA.providerManager.getActiveProvider()?.name).toBe('openai');
    expect(runtimeB.providerManager.getActiveProvider()?.name).toBe('kimi');
    expect(runtimeA.registration.providerFileLifecycle).not.toBe(
      runtimeB.registration.providerFileLifecycle,
    );
    runtimeA.registration.dispose();
    expect(runtimeB.registration.config).toBe(configB);
    expect(runtimeB.providerManager.getActiveProvider()?.name).toBe('kimi');
    runtimeB.registration.dispose();
  });

  it('rejects another Config from borrowing a pre-Config handle', () => {
    const settings = new SettingsService();
    const early = assembleCliProviderRuntime({
      settingsService: settings,
      config: undefined,
      runtimeId: 'one-handle',
    });
    const { config: owner } = createOwner(settings, 'handle-owner');
    const { config: sibling } = createOwner(settings, 'handle-sibling');
    const bound = assembleCliProviderRuntime({
      settingsService: settings,
      config: owner,
      runtimeId: 'one-handle',
      registration: early.registration,
    });
    expect(() =>
      assembleCliProviderRuntime({
        settingsService: settings,
        config: sibling,
        runtimeId: 'one-handle',
        registration: early.registration,
      }),
    ).toThrow('belongs to another Config');
    expect(bound.registration.config).toBe(owner);
    expect('providerManager' in sibling).toBe(false);
    bound.registration.dispose();
  });

  it('restores Config and handle ownership on failed post-Config assembly, then retries on the exact Config', async () => {
    const settings = new SettingsService();
    const early = assembleCliProviderRuntime({
      settingsService: settings,
      config: undefined,
      runtimeId: 'retry-label',
    });
    const { config: config } = createOwner(settings, 'retry-config');
    const { config: sibling } = createOwner(settings, 'retry-sibling');
    settings.set('activeProvider', 'provider-does-not-exist');
    const identity = {
      provider: 'openai',
      baseURL: 'http://127.0.0.1',
      credentialHash: 'retained-key',
    };
    const retained = await early.registration.providerFileLifecycle.retain({
      cacheKey: 'prior-file',
      fileId: 'retained-file',
      bytes: 17,
      identity,
      scopeId: 'retry-label',
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: async () => {},
    });
    await retained.lease.release();
    const originalHandleOwner = early.registration.config;

    expect(() =>
      assembleCliProviderRuntime({
        settingsService: settings,
        config,
        runtimeId: 'retry-label',
        registration: early.registration,
      }),
    ).toThrow(
      "Could not activate explicitly-configured provider 'provider-does-not-exist'",
    );
    expect(early.registration.config).toBe(originalHandleOwner);
    expect(early.registration.providerManager).toBe(early.providerManager);
    expect('providerManager' in config).toBe(false);
    expect(early.registration.providerFileLifecycle.snapshot()).toMatchObject({
      retainedFiles: 1,
      retainedBytes: 17,
      activeLeases: 0,
    });
    expect(() =>
      assembleCliProviderRuntime({
        settingsService: settings,
        config: sibling,
        runtimeId: 'retry-label',
        registration: early.registration,
      }),
    ).toThrow('belongs to another Config');

    settings.set('activeProvider', 'openai');
    const recovered = assembleCliProviderRuntime({
      settingsService: settings,
      config,
      runtimeId: 'retry-label',
      registration: early.registration,
    });
    expect(recovered.registration.config).toBe(config);
    expect(recovered.runtime.providerFileLifecycle).toBe(
      early.registration.providerFileLifecycle,
    );
    expect(recovered.providerManager.getActiveProvider()?.name).toBe('openai');
    const lifecycle = recovered.runtime.providerFileLifecycle;
    if (!(lifecycle instanceof ProviderFileLifecycle))
      throw new Error('Missing recovered file owner');
    const acquired = lifecycle.acquire({
      cacheKey: 'prior-file',
      identity,
      scope: 'session',
      scopeId: 'retry-label',
    });
    expect(acquired).toBeDefined();
    await acquired?.lease.release();
    await lifecycle.cleanupScope('session', 'retry-label');
    expect(
      early.registration.providerFileLifecycle.snapshot().retainedFiles,
    ).toBe(0);
    recovered.registration.dispose();
  });

  it('does not replace an independent isolated Agent with the same label', async () => {
    const agent = (() => {
      const {
        config: capturedConfig16,
        settingsService,
        settingsOwner,
      } = createOwner(new SettingsService(), 'shared-label');
      return createIsolatedRuntimeContext(
        {
          runtimeId: 'shared-label',
          runtimeKind: 'agent',
          config: capturedConfig16,
          settingsOwner,
        },
        settingsService,
      );
    })();
    await agent.activate();
    const settings = new SettingsService();
    const { config: config } = createOwner(settings, 'foreground-with-agent');
    try {
      const assembled = assembleCliProviderRuntime({
        settingsService: settings,
        config,
        runtimeId: 'shared-label',
      });
      expect('providerManager' in config).toBe(false);
      expect(assembled.registration.providerFileLifecycle).not.toBe(
        agent.providerFileLifecycle,
      );
      assembled.registration.dispose();
      expect('providerManager' in agent.config).toBe(false);
    } finally {
      await agent.cleanup();
      await agent.config.dispose();
      await config.dispose();
    }
  });
});
