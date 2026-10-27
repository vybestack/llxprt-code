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
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';

import {
  populateProviderManager,
  NodeFileSystem,
} from '@vybestack/llxprt-code-providers/composition.js';

import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { AgentRuntimeProviderAdapter } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';

import { setActiveModel } from '../providerMutations.js';
import { assembleModelSelection } from '../model-selection.js';

import { switchActiveProvider } from '../provider-switch/provider-switch.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const RUNTIME_ID = 'issue3576-codex-context-limit';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));
describe('Codex effective context limit runtime integration', () => {
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
    suppliedBus: MessageBus | undefined = undefined,
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
        createProviderRuntimeContext({
          runtimeId,
          runtimeKind: 'agent',
          metadata: { source: 'phase-07-provider-test' },
        }),
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

  it('updates the live effective limit across Astra, Sol, and Spark model selection', async () => {
    await openCaller(RUNTIME_ID, 'issue3576-session', 'gpt-5.6-sol');
    populateProviderManager(
      manager,
      oauth,
      oauth.getTokenStore(),
      settings,
      new NodeFileSystem(),
      config,
      undefined,
      undefined,
      false,
      true,
      undefined,
    );
    const runtime = createProviderRuntimeContext({
      runtimeId: RUNTIME_ID,
      metadata: { stage: 'cli-bootstrap' },
    });
    await switchActiveProvider(
      'codex',
      { clientReplacement: 'deferred' },
      config,
      settings,
      manager,
      null,
      'agent',
      async () => {},
      settingsOwner,
    );

    const state: AgentRuntimeState = {
      runtimeId: RUNTIME_ID,
      sessionId: 'issue3576-session',
      updatedAt: Date.now(),
      get provider(): string {
        const provider = settingsOwner.readSelectedProvider();
        if (provider === undefined)
          throw new Error('Missing selected provider');
        return provider;
      },
      get model(): string {
        const model = settingsOwner.readSelectedModel();
        if (model === undefined) throw new Error('Missing selected model');
        return model;
      },
    };
    const provider: AgentRuntimeProviderAdapter = {
      getActiveProvider: () => {
        const activeProvider = manager.getActiveProvider();
        if (activeProvider === undefined) {
          throw new Error('provider manager has no active provider');
        }
        return activeProvider;
      },
      setActiveProvider: () => undefined,
      getProviderKeys: () => {
        throw new Error('This test reads no provider keys');
      },
    };
    const context = createAgentRuntimeContext({
      state,
      settings: settingsOwner.readRuntimePolicy(),
      readRuntimeSettings: () => settingsOwner.readRuntimePolicy(),
      prepareProviderInvocation: (providerName, parameters, signal) =>
        settingsOwner.prepareProviderInvocation(
          RUNTIME_ID,
          providerName,
          parameters,
          signal,
          undefined,
          requestFetch,
        ),
      provider,
      telemetry: {
        logApiRequest: () => undefined,
        logApiResponse: () => undefined,
        logApiError: () => undefined,
      },
      tools: {
        listToolNames: () => [],
        getToolMetadata: () => undefined,
      },
      providerRuntime: runtime,
    });

    await setActiveModel(
      'gpt-6-astra',
      assembleModelSelection(settingsOwner),
      settings,
      manager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(872000);

    await setActiveModel(
      'gpt-5.6-sol',
      assembleModelSelection(settingsOwner),
      settings,
      manager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(262144);

    await setActiveModel(
      'gpt-5.3-codex-spark',
      assembleModelSelection(settingsOwner),
      settings,
      manager.getActiveProvider(),
    );
    expect(context.ephemerals.contextLimit()).toBe(131072);
  });
});
