import { initializeCallerClient } from './helpers/initialize-caller-client.js';
import {
  gate,
  boundary,
  observe,
  successfulTurn,
  restoreEnvironment,
  settleEngineRelease,
  seedCallerSettings,
  acquireCallerFileScopes,
  callerWorkingDirectory,
  includeCallerCwd,
} from './helpers/profile-postcommit-lifetime-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  SettingsService,
  ProfileManager,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
} from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../preferred-provider-acquisition.js';

import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, spyOn, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';

import { AgentConfig } from '../config-types.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  OAuthManager,
  AnthropicOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  MemoryTokenStore,
  makeExpiredToken,
  makeToken,
} from './helpers/provider-auth-fixtures.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const fixtureDirectories: string[] = [];

describe('public profile postcommit OAuth lifetime (#2616)', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const builtCredentials = useOwnedCredentials();
  const otherCredentials = useOwnedCredentials();
  async function exercise(
    dispose: boolean | 'http' | 'renewal-replace' | 'renewal-dispose',
  ): Promise<void> {
    const renewal =
      dispose === 'renewal-replace' || dispose === 'renewal-dispose';
    const root = join(tmpdir(), 'llxprt-profile-postcommit-repros');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'fixture-'));
    fixtureDirectories.push(directory);
    let fakeTimers = false;
    const keys = [
      'LLXPRT_CONFIG_HOME',
      'LLXPRT_DATA_HOME',
      'LLXPRT_CACHE_HOME',
      'LLXPRT_LOG_HOME',
      'LLXPRT_FAKE_RESPONSES',
    ];
    const environment = new Map(keys.map((key) => [key, process.env[key]]));
    for (const key of keys.filter((key) => key !== 'LLXPRT_FAKE_RESPONSES'))
      process.env[key] = directory;
    const preparationEntered = gate();
    const preparationRelease = gate();
    const httpEntered = gate();
    const httpRelease = gate();
    const saveEntered = gate();
    const saveRelease = gate();
    const lockReleased = gate();
    let preparation = true;
    let refreshStarted = false;
    let refreshRequests = 0;
    let otherRefreshRequests = 0;
    let persisted = false;
    let committedAtRefresh = false;
    let refreshSignal: AbortSignal | null | undefined;
    let readModel = (): string => '';
    class PausedStore extends MemoryTokenStore {
      override async getToken(
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> {
        if (preparation) {
          preparationEntered.release();
          await preparationRelease.promise;
        }
        return super.getToken(provider, bucket);
      }
      override async saveToken(
        provider: string,
        token: OAuthToken,
        bucket?: string,
      ): Promise<void> {
        if (token.access_token === 'rotated-access') {
          saveEntered.release();
          await saveRelease.promise;
          await super.saveToken(provider, token, bucket);
          persisted = true;
          return;
        }
        await super.saveToken(provider, token, bucket);
      }
      override async releaseRefreshLock(): Promise<void> {
        lockReleased.release();
      }
    }
    const store = new PausedStore();
    const otherStore = new MemoryTokenStore();
    let otherRenewals: OAuthManager | undefined;
    const callerCloses: Array<() => Promise<void>> = [];
    const agents: Agent[] = [];
    const pending: Array<Promise<unknown>> = [];
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init): Promise<Response> => {
        if (
          String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
          !(init?.body instanceof URLSearchParams) ||
          init.body.get('grant_type') !== 'refresh_token'
        ) {
          throw new Error(`Unexpected network request: ${String(input)}`);
        }
        if (
          init.body.get('refresh_token')?.startsWith('refresh-owner-b') === true
        ) {
          otherRefreshRequests++;
          return Response.json({
            access_token: `owner-b-rotation-${otherRefreshRequests}`,
            refresh_token: 'refresh-owner-b-primary',
            expires_in: 600,
          });
        }
        refreshStarted = true;
        refreshRequests++;
        committedAtRefresh = readModel() === 'committed-oauth-model';
        refreshSignal = init.signal;
        httpEntered.release();
        if (dispose === 'http' && refreshSignal) {
          const signal = refreshSignal;
          await new Promise<void>((resolve, reject) => {
            const onAbort = (): void => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
            void httpRelease.promise.then(() => {
              signal.removeEventListener('abort', onAbort);
              resolve();
            });
          });
        } else {
          await httpRelease.promise;
        }
        return Response.json({
          access_token: 'rotated-access',
          refresh_token: 'rotated-refresh',
          expires_in: renewal ? 3600 : 120,
        });
      },
    );
    try {
      const label = `postcommit-${randomUUID()}`;

      const builtCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'multi-turn-text.jsonl', import.meta.url),
      );
      const builtCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const builtCallerOverrides: Readonly<Partial<AgentConfig>> = {
        sessionId: label,
        workingDir: directory,
        telemetry: { enabled: false },
        recording: { enabled: false },
      };
      const builtCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...builtCallerOverrides,
        workingDir: await callerWorkingDirectory(
          builtCallerOverrides.workingDir,
          builtCallerDirectory,
        ),
      };
      const builtCallerParameters = {
        ...toConfigParameters(builtCallerSelection),
        ...{},
      };
      builtCallerParameters.interactive = true;

      builtCallerParameters.includeDirectories = includeCallerCwd(
        builtCallerParameters.includeDirectories,
      );
      const builtCallerConfig = new Config(builtCallerParameters);
      const builtCallerFactories = {
        ...createAgentRuntimeFactoryBindings(),
        ...{},
      };
      const builtCallerSettings = new SettingsService();
      seedCallerSettings(builtCallerConfig, builtCallerSettings);
      const builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
      injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
      const builtCallerMcp = await buildTestMcpRuntime(
        builtCallerConfig,
        builtCallerPolicy.session.messageBus,
        builtCallerOverrides,
        undefined,
        builtCallerPolicy,
        undefined,
      );
      const builtCallerRuntimeId = 'caller-' + randomUUID();
      const builtCallerRelease = new AcquisitionRelease();
      const builtCallerSettingsOwner = new SessionSettingsOwner(
        builtCallerSettings,
      );
      builtCallerRelease.acquire('settings', () =>
        builtCallerSettingsOwner.dispose(),
      );
      builtCallerSettingsOwner.initializeProviderSelection(
        builtCallerConfig.getProvider(),
        builtCallerConfig.getModel(),
      );
      builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
      const builtCallerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      acquireCallerFileScopes(
        builtCallerRelease,
        builtCallerFiles,
        builtCallerRuntimeId,
        builtCallerConfig.getSessionId(),
      );
      const builtCallerManager = acquirePreferredProviderManager(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerFiles,
        builtCallerRuntimeId,
        builtCredentials().authority,
        builtCallerRelease,
      );
      const {
        tokenizerFactory: builtCallerTokenizer,
        contentGeneratorFactory: builtCallerContent,
      } = configureProviderRuntimeFactories(
        builtCallerConfig,
        builtCallerManager,
      );
      const builtCallerOAuth = acquirePreferredOAuth(
        undefined,
        builtCallerPolicy.session.messageBus,
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerRuntimeId,
        builtCallerMcp.profileDefinitions,
        builtCredentials().authority,
        builtCallerRelease,
        undefined,
      );
      const builtCallerMedia = new SessionMediaOwner(
        builtCallerConfig.projectTempDir,
        1024 * 1024 * 1024,
      );
      const builtCallerOwner = await SessionClientOwner.create(
        builtCallerConfig,
        assembleTaskSchemaPolicy(builtCallerSettings),
        builtCallerManager,
        builtCallerFactories.agentClientFactory,
        builtCallerMedia.store,
        builtCallerMcp.readInstructions,
        builtCallerMcp.workspacePaths,
        builtCallerSettingsOwner,
        builtCallerContent,
        builtCallerTokenizer,
      );
      builtCallerOwner.bindMcpRuntime(builtCallerMcp);
      builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
        builtCallerOAuth.composeRetryOperations(provider),
      );
      builtCallerOwner.bindHooks();
      const builtCallerClose = settleEngineRelease.bind(
        undefined,
        [
          () => builtCallerOwner.dispose(),
          () => builtCallerRelease.close(),
          () => builtCallerMedia.dispose(),
          () => builtCallerMcp.dispose(),
          () => builtCallerConfig.dispose(),
          () => rm(builtCallerDirectory, { recursive: true, force: true }),
        ],
        builtCallerPreviousReplay,
      );
      await initializeCallerClient(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
        builtCallerMcp,
        builtCallerOwner,
        {
          provider: builtCallerConfig.getProvider(),
          model: builtCallerConfig.getModel(),
        },
        builtCallerClose,
      );

      callerCloses.push(builtCallerClose);

      const otherCallerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
      process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
        new URL('fixtures/' + 'multi-turn-text.jsonl', import.meta.url),
      );
      const otherCallerDirectory = await realpath(
        await mkdtemp(join(tmpdir(), 'explicit-caller-')),
      );
      const otherCallerOverrides: Readonly<Partial<AgentConfig>> = {
        sessionId: label,
        workingDir: directory,
        telemetry: { enabled: false },
        recording: { enabled: false },
      };
      const otherCallerSelection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        ...otherCallerOverrides,
        workingDir: await callerWorkingDirectory(
          otherCallerOverrides.workingDir,
          otherCallerDirectory,
        ),
      };
      const otherCallerParameters = {
        ...toConfigParameters(otherCallerSelection),
        ...{},
      };
      otherCallerParameters.interactive = true;

      otherCallerParameters.includeDirectories = includeCallerCwd(
        otherCallerParameters.includeDirectories,
      );
      const otherCallerConfig = new Config(otherCallerParameters);
      const otherCallerFactories = {
        ...createAgentRuntimeFactoryBindings(),
        ...{},
      };
      const otherCallerSettings = new SettingsService();
      seedCallerSettings(otherCallerConfig, otherCallerSettings);
      const otherCallerPolicy = new RuntimePolicyOwner(otherCallerConfig);
      injectConfirmationForcingPolicy(otherCallerPolicy.session.confirmation);
      const otherCallerMcp = await buildTestMcpRuntime(
        otherCallerConfig,
        otherCallerPolicy.session.messageBus,
        otherCallerOverrides,
        undefined,
        otherCallerPolicy,
        undefined,
      );
      const otherCallerRuntimeId = 'caller-' + randomUUID();
      const otherCallerRelease = new AcquisitionRelease();
      const otherCallerSettingsOwner = new SessionSettingsOwner(
        otherCallerSettings,
      );
      otherCallerRelease.acquire('settings', () =>
        otherCallerSettingsOwner.dispose(),
      );
      otherCallerSettingsOwner.initializeProviderSelection(
        otherCallerConfig.getProvider(),
        otherCallerConfig.getModel(),
      );
      otherCallerSettingsOwner.bindTelemetry(otherCallerConfig);
      const otherCallerFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      acquireCallerFileScopes(
        otherCallerRelease,
        otherCallerFiles,
        otherCallerRuntimeId,
        otherCallerConfig.getSessionId(),
      );
      const otherCallerManager = acquirePreferredProviderManager(
        otherCallerConfig,
        otherCallerSettings,
        otherCallerSettingsOwner,
        otherCallerFiles,
        otherCallerRuntimeId,
        otherCredentials().authority,
        otherCallerRelease,
      );
      const {
        tokenizerFactory: otherCallerTokenizer,
        contentGeneratorFactory: otherCallerContent,
      } = configureProviderRuntimeFactories(
        otherCallerConfig,
        otherCallerManager,
      );
      const otherCallerOAuth = acquirePreferredOAuth(
        undefined,
        otherCallerPolicy.session.messageBus,
        otherCallerConfig,
        otherCallerSettings,
        otherCallerManager,
        otherCallerRuntimeId,
        otherCallerMcp.profileDefinitions,
        otherCredentials().authority,
        otherCallerRelease,
        undefined,
      );
      const otherCallerMedia = new SessionMediaOwner(
        otherCallerConfig.projectTempDir,
        1024 * 1024 * 1024,
      );
      const otherCallerOwner = await SessionClientOwner.create(
        otherCallerConfig,
        assembleTaskSchemaPolicy(otherCallerSettings),
        otherCallerManager,
        otherCallerFactories.agentClientFactory,
        otherCallerMedia.store,
        otherCallerMcp.readInstructions,
        otherCallerMcp.workspacePaths,
        otherCallerSettingsOwner,
        otherCallerContent,
        otherCallerTokenizer,
      );
      otherCallerOwner.bindMcpRuntime(otherCallerMcp);
      otherCallerOwner.bindProviderFiles(otherCallerFiles, (provider) =>
        otherCallerOAuth.composeRetryOperations(provider),
      );
      otherCallerOwner.bindHooks();
      const otherCallerClose = settleEngineRelease.bind(
        undefined,
        [
          () => otherCallerOwner.dispose(),
          () => otherCallerRelease.close(),
          () => otherCallerMedia.dispose(),
          () => otherCallerMcp.dispose(),
          () => otherCallerConfig.dispose(),
          () => rm(otherCallerDirectory, { recursive: true, force: true }),
        ],
        otherCallerPreviousReplay,
      );
      await initializeCallerClient(
        otherCallerConfig,
        otherCallerSettings,
        otherCallerSettingsOwner,
        otherCallerManager,
        otherCallerOAuth,
        otherCallerRuntimeId,
        otherCallerTokenizer,
        otherCallerMcp,
        otherCallerOwner,
        {
          provider: otherCallerConfig.getProvider(),
          model: otherCallerConfig.getModel(),
        },
        otherCallerClose,
      );

      callerCloses.push(otherCallerClose);
      const manager = builtCallerManager;

      const provider = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        directory,
      );
      provider.name = 'claudecode';
      provider.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
      manager.registerProvider(provider);
      const profile: Profile = {
        version: 1,
        provider: 'claudecode',
        model: 'committed-oauth-model',
        modelParams: {},
        ephemeralSettings: {},
        auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
      };
      const profiles = new ProfileManager();
      await profiles.saveProfile('postcommit', profile);
      if (renewal) {
        vi.useFakeTimers();
        fakeTimers = true;
      }
      await store.saveToken(
        'claudecode',
        renewal
          ? makeToken('old-primary', { expiresInSec: 600 })
          : makeExpiredToken('expired-primary'),
        'primary',
      );
      await store.saveToken(
        'claudecode',
        makeExpiredToken('expired-secondary'),
        'secondary',
      );
      const oauth = new OAuthManager(store, undefined, {
        config: builtCallerConfig,
        messageBus: builtCallerPolicy.session.messageBus,
      });
      oauth.registerProvider(
        new AnthropicOAuthProvider(globalThis.fetch, store),
      );
      await oauth.toggleOAuthEnabled('claudecode');
      const agent = await fromConfig({
        oauthManager: oauth,
        providerFileLifecycle: builtCallerFiles,
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
        messageBus: builtCallerPolicy.session.messageBus,
        sessionId: label,
      });
      agents.push(agent);
      const ownerB = await fromConfig({
        settingsOwner: otherCallerSettingsOwner,
        settingsService: otherCallerSettings,
        providerManager: otherCallerManager,
        config: otherCallerConfig,
        mcpRuntime: otherCallerMcp,
        messageBus: otherCallerPolicy.session.messageBus,
        sessionId: label,
      });

      agents.push(ownerB);
      if (renewal) {
        otherRenewals = new OAuthManager(otherStore, undefined, {
          config: otherCallerConfig,
          messageBus: otherCallerPolicy.session.messageBus,
        });
        otherRenewals.registerProvider(
          new AnthropicOAuthProvider(globalThis.fetch, otherStore),
        );
        await otherRenewals.toggleOAuthEnabled('claudecode');
        await otherStore.saveToken(
          'claudecode',
          makeToken('owner-b-primary', { expiresInSec: 600 }),
          'primary',
        );
        await otherRenewals.configureProactiveRenewalsForProfile({
          provider: 'claudecode',
          auth: { type: 'oauth', buckets: ['primary'] },
        });
      }
      readModel = () => agent.getModel();
      const application = observe(
        agent.profiles.applySnapshot(profile, { profileName: 'postcommit' }),
      );
      pending.push(application.result);
      await boundary(preparationEntered.promise, 'preparation token read');
      expect(refreshStarted).toBe(false);
      expect(application.settled()).toBe(false);
      preparation = false;
      preparationRelease.release();
      if (renewal) {
        expect(await application.result).toHaveProperty(
          'value.modelName',
          'committed-oauth-model',
        );
        expect(refreshStarted).toBe(false);
        await advanceTimersByTimeAsync(305000);
      }
      await boundary(httpEntered.promise, 'postcommit native OAuth refresh');
      expect(committedAtRefresh).toBe(true);
      const settledDuringHttp = application.settled();
      if (dispose === 'http') {
        const first = agent.dispose();
        const disposal = observe(first);
        pending.push(disposal.result);
        expect(refreshSignal?.aborted).toBe(true);
        expect(agent.dispose()).toBe(first);
        await successfulTurn(ownerB);
        expect(await application.result).toHaveProperty(
          'error.committed',
          true,
        );
        expect(await disposal.result).toStrictEqual({ value: undefined });
        expect(persisted).toBe(false);
        expect(builtCallerSettingsOwner.readSelectedModel()).toBe(
          'committed-oauth-model',
        );
        return;
      }
      httpRelease.release();
      await boundary(saveEntered.promise, 'rotated token persistence');
      expect(persisted).toBe(false);
      if (renewal) {
        const draining = observe<unknown>(
          dispose === 'renewal-dispose'
            ? agent.dispose()
            : agent.profiles.applySnapshot({
                ...profile,
                model: 'replacement-without-renewals',
                auth: undefined,
              }),
        );
        pending.push(draining.result);
        await successfulTurn(ownerB);
        expect(draining.settled()).toBe(false);
        saveRelease.release();
        expect(await draining.result).not.toHaveProperty('error');
        expect(persisted).toBe(true);
        expect(
          (await store.getToken('claudecode', 'primary'))?.refresh_token,
        ).toBe('rotated-refresh');
        const ownerBToken = (await otherStore.getToken('claudecode', 'primary'))
          ?.access_token;
        await advanceTimersByTimeAsync(4000000);
        expect(
          (await otherStore.getToken('claudecode', 'primary'))?.access_token,
        ).not.toBe(ownerBToken);
        expect(refreshRequests).toBe(1);
        await otherRenewals?.configureProactiveRenewalsForProfile({});
        vi.useRealTimers();
        fakeTimers = false;
        if (dispose === 'renewal-replace') await successfulTurn(agent);
        return;
      }
      if (dispose) {
        const first = agent.dispose();
        const firstObservation = observe(first);
        pending.push(firstObservation.result);
        const second = agent.dispose();
        const secondObservation = observe(second);
        pending.push(secondObservation.result);
        await successfulTurn(ownerB);
        expect({
          firstSettled: firstObservation.settled(),
          secondSettled: secondObservation.settled(),
          sharedPromise: first === second,
        }).toStrictEqual({
          firstSettled: false,
          secondSettled: false,
          sharedPromise: true,
        });
        saveRelease.release();
        await boundary(lockReleased.promise, 'refresh lock release');
        expect(await firstObservation.result).toStrictEqual({
          value: undefined,
        });
        expect(await secondObservation.result).toStrictEqual({
          value: undefined,
        });
        expect(await application.result).toHaveProperty(
          'error.committed',
          true,
        );
        expect(builtCallerSettingsOwner.readSelectedModel()).toBe(
          'committed-oauth-model',
        );
        await expect(
          oauth.getOAuthToken('claudecode', 'primary'),
        ).rejects.toThrow('OAuth manager is disposed');
        expect(
          (await store.getToken('claudecode', 'primary'))?.refresh_token,
        ).toBe('rotated-refresh');
        await builtCallerOwner
          .getAgentClient()
          .startChat(await builtCallerOwner.getAgentClient().getHistory());
        const successor = await fromConfig({
          settingsOwner: builtCallerSettingsOwner,
          settingsService: builtCallerSettings,
          agentClient: builtCallerOwner.getAgentClient(),
          providerManager: builtCallerManager,
          config: builtCallerConfig,
          mcpRuntime: builtCallerMcp,
          messageBus: builtCallerPolicy.session.messageBus,
          sessionId: `${label}-successor`,
        });
        try {
          agents.push(successor);
          await successfulTurn(successor);
        } finally {
          await successor.dispose();
        }
      } else {
        await successfulTurn(ownerB);
        expect({
          settledDuringHttp,
          settledDuringSave: application.settled(),
          applying: agent.profiles.isApplying(),
        }).toStrictEqual({
          settledDuringHttp: false,
          settledDuringSave: false,
          applying: true,
        });
        saveRelease.release();
        await boundary(lockReleased.promise, 'refresh lock release');
        expect(await application.result).toHaveProperty(
          'value.modelName',
          'committed-oauth-model',
        );
        expect(
          (await store.getToken('claudecode', 'primary'))?.refresh_token,
        ).toBe('rotated-refresh');
        await successfulTurn(agent);
      }
    } finally {
      preparation = false;
      preparationRelease.release();
      httpRelease.release();
      saveRelease.release();
      try {
        await Promise.all(pending);
        await Promise.all(agents.map((agent) => agent.dispose()));
        await otherRenewals?.configureProactiveRenewalsForProfile({});
      } finally {
        if (fakeTimers) {
          vi.clearAllTimers();
          vi.useRealTimers();
        }
        transport.mockRestore();
        await runCleanupSteps([...callerCloses].reverse());
        restoreEnvironment(environment);
      }
    }
  }

  afterAll(async () => {
    await Promise.all(
      fixtureDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });
  it('joins native refresh and token persistence before completing apply', async () => {
    await expect(exercise(false)).resolves.toBeUndefined();
  }, 30000);
  it('shares pending disposal until committed token persistence finishes', async () => {
    await expect(exercise(true)).resolves.toBeUndefined();
  }, 30000);
  it('aborts the native HTTP refresh immediately on public disposal', async () => {
    await expect(exercise('http')).resolves.toBeUndefined();
  }, 30000);
  it('joins a fired renewal during replacement and prevents old rescheduling', async () => {
    await expect(exercise('renewal-replace')).resolves.toBeUndefined();
  }, 30000);
  it('joins a fired installed renewal on disposal after apply has completed', async () => {
    await expect(exercise('renewal-dispose')).resolves.toBeUndefined();
  }, 30000);
});
