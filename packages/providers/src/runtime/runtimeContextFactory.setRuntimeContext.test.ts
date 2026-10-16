/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { type ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { configureProviderTokenizer } from '../composition/index.js';
import { ProviderManager } from '../ProviderManager.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import {
  acquireAdoptedProviderManager,
  activateAdoptedProviders,
} from '../../../agents/src/api/adopted-provider-assembly.js';
import { acquirePreferredOAuth } from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import { runCleanupSteps } from '../../../agents/src/core/subagent-cleanup.js';

class RuntimeAdmissionObserver extends ProviderManager {
  readonly admittedContexts: ProviderRuntimeContext[] = [];

  override setRuntimeContext(
    ...args: Parameters<ProviderManager['setRuntimeContext']>
  ): void {
    super.setRuntimeContext(...args);
    this.admittedContexts.push(args[0]);
  }
}

describe('runtime context activation wires setRuntimeContext @requirement:REQ-SP4-004', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let config: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;

  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });

  async function openConfig(sessionId: string, model: string): Promise<void> {
    const rawDirectory = await mkdtemp(join(tmpdir(), 'runtime-admission-'));
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
    settings = new SettingsService();
    const selectedSettings = new SessionSettingsOwner(settings);
    settingsOwner = selectedSettings;
    retiring.push(() => selectedSettings.dispose());
    settingsOwner.bindTelemetry(config);
    settingsOwner.initializeProviderSelection(config.getProvider(), model);
  }

  async function activateManager(
    manager: ProviderManager,
    runtimeId: string,
  ): Promise<void> {
    const policy = new RuntimePolicyOwner(config);
    retiring.push(() => policy.dispose());
    const release = new AcquisitionRelease();
    retiring.push(() => release.close());
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      manager,
      runtimeId,
      undefined,
      credentials().authority,
      release,
      undefined,
    );
    await activateAdoptedProviders(
      config,
      settings,
      settingsOwner,
      manager,
      oauth,
      runtimeId,
      false,
      configureProviderTokenizer(manager),
    );
  }

  it('keeps the selected Config outside scoped runtime data across activations', async () => {
    await openConfig('scoped-config-owner', 'scoped-model');
    const manager = new RuntimeAdmissionObserver(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      undefined,
      undefined,
      credentials().authority,
      settingsOwner,
    );
    retiring.push(() => manager.dispose());
    await activateManager(manager, 'first-activation');
    await activateManager(manager, 'second-activation');
    expect(
      manager.admittedContexts.map((runtime) => ({
        runtimeId: runtime.runtimeId,
        hasConfig: 'config' in runtime,
      })),
    ).toStrictEqual([
      { runtimeId: 'first-activation', hasConfig: false },
      { runtimeId: 'second-activation', hasConfig: false },
    ]);
    expect(() => manager.prepareStatelessProviderInvocation()).not.toThrow();
  });

  it('installs the scoped runtime onto the provider manager via setRuntimeContext', async () => {
    await openConfig('setRuntimeContext-scoped', 'scoped-model');
    const release = new AcquisitionRelease();
    retiring.push(() => release.close());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, 'setRuntimeContext-scoped'),
    );
    const capturedManager = acquireAdoptedProviderManager(
      undefined,
      config,
      settings,
      settingsOwner,
      files,
      'setRuntimeContext-scoped',
      credentials().authority,
      release,
    );
    if (!(capturedManager instanceof ProviderManager))
      throw new Error('Expected concrete acquired manager');
    await activateManager(capturedManager, 'setRuntimeContext-scoped');
    expect(capturedManager).toBeDefined();
    expect(capturedManager.prepareStatelessProviderInvocation).toBeDefined();
    expect(() =>
      capturedManager.prepareStatelessProviderInvocation(),
    ).not.toThrow();
  });

  it('installs the scoped runtime onto an ADOPTED provider manager via setRuntimeContext', async () => {
    await openConfig('setRuntimeContext-adopted', 'adopted-model');
    const adoptedManager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
      undefined,
      credentials().authority,
      settingsOwner,
    );
    retiring.push(() => adoptedManager.dispose());
    const policy = new RuntimePolicyOwner(config);
    retiring.push(() => policy.dispose());
    const release = new AcquisitionRelease();
    retiring.push(() => release.close());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, 'setRuntimeContext-adopted'),
    );
    const selected = acquireAdoptedProviderManager(
      adoptedManager,
      config,
      settings,
      settingsOwner,
      files,
      'setRuntimeContext-adopted',
      credentials().authority,
      release,
    );
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      adoptedManager,
      'setRuntimeContext-adopted',
      undefined,
      credentials().authority,
      release,
      undefined,
    );
    await activateAdoptedProviders(
      config,
      settings,
      settingsOwner,
      selected,
      oauth,
      'setRuntimeContext-adopted',
      false,
      configureProviderTokenizer(adoptedManager),
    );
    expect(selected).toBe(adoptedManager);
    expect(() =>
      adoptedManager.prepareStatelessProviderInvocation(),
    ).not.toThrow();
  });
});
