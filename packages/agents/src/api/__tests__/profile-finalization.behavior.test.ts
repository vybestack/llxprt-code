import { createCapturedSessionOwner } from './helpers/session-client-capture.js';
import { currentOwnerClient } from './helpers/owner-current-client.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { AgentExecutionCoordinator } from '../agentExecutionCoordinator.js';
import {
  AgentProviderState,
  createAgentAuthState,
} from '../control/authState.js';
import { ProfilesControl } from '../control/profilesControl.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { assembleProfileApplication } from '../profileApplicationAssembly.js';
import { captureProfileModelParams } from '../profileSnapshot.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
describe('Profile finalization', () => {
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
  const credentials = useOwnedCredentials();

  it('keeps facade and owner state unchanged when the final loop rebuild fails', async () => {
    const builtPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const builtDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const builtConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: builtDirectory,
      }),
    );
    const builtSettings = new SettingsService();
    const builtPolicy = new RuntimePolicyOwner(builtConfig);
    const builtMessageBus = builtPolicy.session.messageBus;
    const builtMcp = await createTestMcpRuntime(
      {
        oauth: {
          openBrowser: async () => {
            throw new Error('Unexpected browser request');
          },
          tokenStorage: new MCPOAuthTokenStorage({
            getCredentials: async () => null,
            setCredentials: async () => {
              throw new Error('Unexpected token write');
            },
            deleteCredentials: async () => {},
            listServers: async () => [],
            getAllCredentials: async () => new Map(),
            clearAll: async () => {},
          }),
        },
        config: builtConfig,
        policy: { owner: builtPolicy, ownership: 'runtime' },
      },
      {},
    );

    const builtRuntimeId = 'engine-' + randomUUID();
    const builtRelease = new AcquisitionRelease();
    const builtSettingsOwner = new SessionSettingsOwner(builtSettings);
    builtRelease.acquire('settings', () => builtSettingsOwner.dispose());
    builtSettingsOwner.initializeProviderSelection(
      builtConfig.getProvider(),
      builtConfig.getModel(),
    );
    builtSettingsOwner.bindTelemetry(builtConfig);
    const builtFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [builtRuntimeId, builtConfig.getSessionId()])
      builtRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtFiles, scope),
      );
    const builtManager = acquirePreferredProviderManager(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtFiles,
      builtRuntimeId,
      credentials().authority,
      builtRelease,
    );
    const builtTokenizer = configureProviderTokenizer(builtManager);
    const builtContent = createRuntimeContentGeneratorFactory();
    const builtOAuth = acquirePreferredOAuth(
      undefined,
      builtMessageBus,
      builtConfig,
      builtSettings,
      builtManager,
      builtRuntimeId,
      builtMcp.profileDefinitions,
      credentials().authority,
      builtRelease,
      undefined,
    );
    const builtMedia = new SessionMediaOwner(
      builtConfig.projectTempDir,
      1024 * 1024,
    );
    const builtOwner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      buildAgentClientFactory(),
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    builtOwner.bindMcpRuntime(builtMcp);
    builtOwner.bindHooks();
    const builtClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      builtPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtRuntimeId,
        builtTokenizer,
        undefined,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.refreshAuth();
      await (await currentOwnerClient(builtOwner)).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }

    try {
      const config = builtConfig;
      const settings = builtSettings;
      const manager = builtManager;

      const providerState: AgentProviderState = {
        provider: 'fake',
        model: config.getModel(),
        modelParams: {},
      };
      const authState = createAgentAuthState();
      const before = structuredClone({ providerState, authState });
      const settingsBefore = settings.exportForStateSnapshot();
      const ephemeralsBefore = structuredClone(
        builtSettingsOwner.captureNamedParameters(),
      );
      const failure = new Error('loop rebuild failed');
      let failRebuild = true;
      const coordinator = new AgentExecutionCoordinator();
      const profiles = (() => {
        const readString = (key: string): string | undefined => {
          const value = builtSettingsOwner.readNamedParameter(key);
          return typeof value === 'string' && value.length > 0
            ? value
            : undefined;
        };
        return new ProfilesControl(
          () => providerState,
          assembleProfileApplication(
            settings,
            manager,
            null,
            (name, options) =>
              assembleProviderSwitch(
                config,
                settings,
                manager,
                null,
                () => undefined,
                () => builtOwner.refreshAuth(),
                builtSettingsOwner,
              )(name, { ...options, clientReplacement: 'deferred' }),
            builtSettingsOwner,
            builtMcp.profileDefinitions,
            async (result) => {
              const modelParams = captureProfileModelParams(
                settings.getProviderSettings(result.providerName),
              );
              const replacement = await (async () => {
                if (failRebuild) throw failure;
                return {
                  publish: () => {},
                  retire: async () => {},
                  discard: async () => {},
                };
              })();
              return {
                publish: () => {
                  replacement.publish();
                  providerState.provider = result.providerName;
                  providerState.model = result.modelName;
                  providerState.modelParams = modelParams;
                  providerState.baseUrl = result.baseUrl;
                  providerState.keyName = readString('auth-key-name');
                  providerState.isLoadBalancer =
                    result.providerName === 'load-balancer';
                  authState.keyFile = readString('auth-keyfile');
                  authState.rawKeyPresent =
                    readString('auth-key') !== undefined;
                  authState.inlineKeyPresent = false;
                  authState.baseUrl = result.baseUrl;
                },
                retire: () => replacement.retire(),
                discard: () => replacement.discard(),
              };
            },
            () => coordinator.assertNoCommit(),
          ),
          () => ({ ...builtSettingsOwner.captureUserParameters() }),
          config.getTargetDir(),
        );
      })();
      const profile: Profile = {
        version: 1,
        provider: 'fake',
        model: 'replacement-model',
        modelParams: { temperature: 0.25 },
        ephemeralSettings: {
          'auth-key': 'replacement-key',
          'base-url': 'https://replacement.example',
        },
      };

      await expect(profiles.applySnapshot(profile)).rejects.toBe(failure);
      expect({ providerState, authState }).toStrictEqual(before);
      expect(settings.exportForStateSnapshot()).toStrictEqual(settingsBefore);
      expect(builtSettingsOwner.captureNamedParameters()).toStrictEqual(
        ephemeralsBefore,
      );
      expect(config.getModel()).toBe(before.providerState.model);
      expect(profiles.isApplying()).toBe(false);

      failRebuild = false;
      await profiles.applySnapshot(profile);
      expect(providerState).toMatchObject({
        model: 'replacement-model',
        modelParams: { temperature: 0.25 },
      });
      expect(authState).toMatchObject({
        rawKeyPresent: true,
        baseUrl: 'https://replacement.example',
      });
    } finally {
      await builtClose();
    }
  });
});
async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}
