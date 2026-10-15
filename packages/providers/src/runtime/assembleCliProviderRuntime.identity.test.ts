import { SessionProviderReads } from '../../../agents/src/api/session-provider-reads.js';
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
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  installBorrowedConfigSettings,
  installOwnedConfig,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createIsolatedRuntimeContext } from './index.js';
import { assembleCliProviderRuntime } from './assembleCliProviderRuntime.js';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAgentPreflight } from '../../../agents/src/api/profile-preflight.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';

function createConfig(sessionId: string): Config {
  return acquireConfig({
    targetDir: process.cwd(),
    cwd: process.cwd(),
    sessionId,
    debugMode: false,
    model: sessionId + '-model',
  });
}

describe('CLI foreground provider ownership', () => {
  const credentials = useOwnedCredentials();
  it('keeps Config on the foreground owner instead of the admitted runtime', async () => {
    const settings = new SettingsService();
    const configSettings = settings;
    const config = createConfig('config-owner');
    const settingsOwner = acquireSettings(config, configSettings);
    const bundle = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,
      settingsOwner,
      settingsService: settings,
      config,
      runtimeId: 'config-owner',
    });
    try {
      expect(bundle.runtime).not.toHaveProperty('config');
      expect(bundle.registration.config).toBe(config);
      const prepare = bundle.providerManager.prepareStatelessProviderInvocation;
      if (prepare === undefined)
        throw new Error('Missing preparation operation');
      expect(() => prepare.call(bundle.providerManager)).not.toThrow();
    } finally {
      await bundle.policyOwner?.dispose();
      bundle.registration.dispose();
      await settingsOwner.dispose();
      await config.dispose();
    }
  });

  it('binds the same runtime bus, provider manager, OAuth manager, and file lifecycle to the Config', async () => {
    const settings = new SettingsService();
    const configSettings = settings;
    const config = createConfig('bundle-owner');
    acquireSettings(config, configSettings);
    const bundle = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settings,
      config,
      runtimeId: 'bundle-owner',
    });

    expect('providerManager' in config).toBe(false);
    expect(bundle.oauthManager?.runtimeMessageBus).toBe(
      bundle.runtimeMessageBus,
    );
    expect(bundle.providerManager.listProviders()).toContain('openai');
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('providerManager' in config).toBe(false);
    expect('providerFileLifecycle' in bundle.runtime).toBe(false);
    expect(bundle.registration.providerFileLifecycle).toBeInstanceOf(
      ProviderFileLifecycle,
    );
    bundle.registration.dispose();
  });

  it('preserves supplied OAuth bus and pending caller confirmation during final assembly', async () => {
    const settings = new SettingsService();
    const early = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

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
    const configSettings = settings;
    const config = createConfig('final-auth-owner');
    acquireSettings(config, configSettings);
    const final = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

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

  it('keeps concurrent equal-label roots independent across interleaved Config adoption and one cleanup', async () => {
    const settingsA = new SettingsService();
    const settingsB = new SettingsService();
    const earlyA = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settingsA,
      config: undefined,
      runtimeId: 'same-cli-label',
    });
    const earlyB = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settingsB,
      config: undefined,
      runtimeId: 'same-cli-label',
    });
    const configASettings = settingsA;
    const configA = createConfig('foreground-a');
    acquireSettings(configA, configASettings);
    const configBSettings = settingsB;
    const configB = createConfig('foreground-b');
    acquireSettings(configB, configBSettings);
    settingsA.set('activeProvider', 'openai');
    settingsB.set('activeProvider', 'kimi');
    const runtimeB = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settingsB,
      config: configB,
      runtimeId: 'same-cli-label',
      registration: earlyB.registration,
    });
    const runtimeA = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

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

  it('rejects another Config from borrowing a pre-Config handle', async () => {
    const settings = new SettingsService();
    const early = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settings,
      config: undefined,
      runtimeId: 'one-handle',
    });
    const ownerSettings = settings;
    const owner = createConfig('handle-owner');
    acquireSettings(owner, ownerSettings);
    const siblingSettings = settings;
    const sibling = createConfig('handle-sibling');
    acquireSettings(sibling, siblingSettings);
    const bound = await assembleCliProviderRuntime({
      credentialAuthority: credentials().authority,

      settingsService: settings,
      config: owner,
      runtimeId: 'one-handle',
      registration: early.registration,
    });
    await expect(
      assembleCliProviderRuntime({
        credentialAuthority: credentials().authority,

        settingsService: settings,
        config: sibling,
        runtimeId: 'one-handle',
        registration: early.registration,
      }),
    ).rejects.toThrow('belongs to another Config');
    expect(bound.registration.config).toBe(owner);
    expect('providerManager' in sibling).toBe(false);
    bound.registration.dispose();
  });

  it('closes failed Config attachment and accepts a new independent preflight without crossing file ownership', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'preflight-attachment-recovery-'),
    );
    const settings = new SettingsService();
    const early = await prepareAgentPreflight(
      { runtimeId: 'retry-label' },
      credentials().authority,
      settings,
    );
    const configSettings = settings;
    const config = createConfig('retry-config');
    const settingsOwner = acquireSettings(config, configSettings);
    const siblingStore = settings;
    const sibling = createConfig('retry-sibling');
    const siblingSettings = acquireSettings(sibling, siblingStore);
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const file = join(directory, 'retained-file');
    await writeFile(file, 'retained contents');
    const retained = await early.retainProviderFile({
      cacheKey: file,
      fileId: 'retained-file',
      bytes: 17,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'retained-key',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: () => rm(file),
    });
    await retained.lease.release();
    const prepare = (owner: typeof early, selectedConfig: typeof config) =>
      owner.preparePostConfiguration(
        selectedConfig,
        filesystem,
        memory,
        trust,
        undefined,
        settingsOwner,
      );
    settings.set('activeProvider', 'provider-does-not-exist');
    try {
      expect(early.captureProviderFiles()).toMatchObject({
        retainedFiles: 1,
        retainedBytes: 17,
        activeLeases: 0,
      });
      await expect(prepare(early, config)).rejects.toThrow(
        'provider-does-not-exist',
      );
      expect(() => early.captureInput()).toThrow('disposed');
      expect(() => early.readProviderDefaultModel('openai')).toThrow(
        'disposed',
      );
      expect('providerManager' in config).toBe(false);
      expect(early.captureProviderFiles()).toMatchObject({
        retainedFiles: 0,
        retainedBytes: 0,
        activeLeases: 0,
      });
      expect(await readdir(directory)).not.toContain('retained-file');
      await expect(prepare(early, sibling)).rejects.toThrow('disposed');
      expect('providerManager' in sibling).toBe(false);
      settings.set('activeProvider', 'openai');
      const recovered = await prepareAgentPreflight(
        { runtimeId: 'retry-label' },
        credentials().authority,
        settings,
      );
      const nextFilesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      const nextMemory = assembleWorkspaceMemory(config, nextFilesystem, trust);
      try {
        await recovered.preparePostConfiguration(
          config,
          nextFilesystem,
          nextMemory,
          trust,
          undefined,
          settingsOwner,
        );
        expect(recovered.captureInput().runtimeId).toBe('retry-label');
        expect('runtime' in recovered).toBe(false);
        expect(recovered.captureProviderFiles().retainedFiles).toBe(0);
        expect(
          (await recovered.preflight({ provider: 'openai', authMode: 'none' }))
            .activeProvider,
        ).toBe('openai');
        expect(early.captureProviderFiles().retainedFiles).toBe(0);
        await expect(
          recovered.preparePostConfiguration(
            sibling,
            nextFilesystem,
            nextMemory,
            trust,
            undefined,
            settingsOwner,
          ),
        ).rejects.toThrow('already prepared');
      } finally {
        await recovered.dispose();
        await nextMemory.dispose();
        await nextFilesystem.dispose();
      }
    } finally {
      await early.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await settingsOwner.dispose();
      await siblingSettings.dispose();
      await config.dispose();
      await sibling.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not replace an independent isolated Agent with the same label', async () => {
    const agent = (() => {
      const settingsService = new SettingsService();
      const capturedConfig16 = createConfig('shared-label');
      const settingsOwner = acquireSettings(capturedConfig16, settingsService);
      return createIsolatedRuntimeContext(
        {
          credentialAuthority: credentials().authority,

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
    const configSettings = settings;
    const config = createConfig('foreground-with-agent');
    acquireSettings(config, configSettings);
    try {
      const assembled = await assembleCliProviderRuntime({
        credentialAuthority: credentials().authority,

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
