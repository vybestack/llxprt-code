/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';

describe('isolated runtime messageBus ownership', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let config: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let manager: ProviderManager;
  let oauth: OAuthManager;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openCaller(
    runtimeId: string,
    sessionId: string,
    model: string,
    suppliedBus: MessageBus | undefined,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(join(tmpdir(), 'provider-bus-owner-'));
      retiring.push(() => rm(rawDirectory, { recursive: true, force: true }));
      const directory = await realpath(rawDirectory);
      const selectedConfig = new Config({
        sessionId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      config = selectedConfig;
      retiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      retiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      settings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(settings);
      settingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      settingsOwner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const bus = suppliedBus ?? policy.session.messageBus;
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId, sessionId]))
        release.acquire('files', () => releaseAdoptedFileScope(files, scope));
      manager = acquirePreferredProviderManager(
        config,
        settings,
        settingsOwner,
        files,
        runtimeId,
        credentials().authority,
        release,
      );
      oauth = acquirePreferredOAuth(
        undefined,
        bus,
        config,
        settings,
        manager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
        undefined,
      );
      await settingsOwner.startTelemetry(config);
      manager.setRuntimeContext(
        createProviderRuntimeContext({ runtimeId, runtimeKind: 'agent' }),
        settingsOwner,
        settings,
        config,
      );
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }

  it('constructs a private bus when the owner does not supply one', async () => {
    await openCaller(
      'isolated-private-bus',
      'message-bus-owner',
      'model',
      undefined,
    );
    expect(oauth.runtimeMessageBus).toBeInstanceOf(MessageBus);
    expect('providerManager' in config).toBe(false);
  });
  it('uses the exact MessageBus supplied by the owner', async () => {
    const providedBus = new MessageBus();
    await openCaller(
      'isolated-provided-bus',
      'message-bus-owner',
      'model',
      providedBus,
    );
    expect(oauth.runtimeMessageBus).toBe(providedBus);
  });
});
