import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  OwnedCredentialFixture,
  useOwnedCredentials,
} from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { fromConfig } from '../fromConfig.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
describe('failed adopted session binding', () => {
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

  it('retires the created session client while retaining caller authority', async () => {
    const callerCredentials = await OwnedCredentialFixture.create();
    const callerPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const callerDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const callerConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: callerDirectory,
      }),
    );
    const callerSettings = new SettingsService();
    const callerPolicy = new RuntimePolicyOwner(callerConfig);
    const callerMessageBus = callerPolicy.session.messageBus;
    const callerMcp = await McpRuntimeOwner.create(
      {
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
      callerConfig,
      callerMessageBus,
      undefined,
      undefined,
      undefined,
      callerPolicy,
      'runtime',
    );

    const callerRuntimeId = 'engine-' + randomUUID();
    const callerRelease = new AcquisitionRelease();
    const callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    const callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
      );
    const callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      callerCredentials.authority,
      callerRelease,
    );
    const {
      tokenizerFactory: callerTokenizer,
      contentGeneratorFactory: callerContent,
    } = configureProviderRuntimeFactories(callerConfig, callerManager);
    const callerOAuth = acquirePreferredOAuth(
      undefined,
      callerMessageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      callerCredentials.authority,
      callerRelease,
    );
    const callerMedia = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024,
    );
    const callerOwner = await SessionClientOwner.create(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      buildAgentClientFactory(),
      callerMedia.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindHooks();
    const callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => callerMedia.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => callerCredentials.dispose(),
        () => rm(callerDirectory, { recursive: true, force: true }),
      ],
      callerPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
      );
      await callerMcp.initialize();
      await callerOwner.initializeTools();
      await callerOwner.refreshAuth();
      await callerOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }

    await callerMcp.workspaceMemory.dispose();
    const retired: SessionClientOwner[] = [];
    const dispose = SessionClientOwner.prototype.dispose;
    const observation = vi
      .spyOn(SessionClientOwner.prototype, 'dispose')
      .mockImplementation(async function (
        this: SessionClientOwner,
      ): Promise<void> {
        await dispose.call(this);
        retired.push(this);
      });
    try {
      const failure = await fromConfig({
        credentialAuthority: credentials().authority,
        config: callerConfig,
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        providerManager: callerManager,
        agentClient: callerOwner.getAgentClient(),
        mcpRuntime: callerMcp,
        messageBus: callerMessageBus,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(AggregateError);
      expect(failure).toMatchObject({
        message: 'Workspace memory is disposed',
      });
      expect(retired).toHaveLength(1);
      expect(() => retired[0].getAgentClient()).toThrow('disposed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      callerSettingsOwner.writeUserParameter('maxOutputTokens', 37);
      expect(callerSettings.get('maxOutputTokens')).toBe(37);
      expect(callerOwner.getAgentClient().isInitialized()).toBe(true);
      expect(callerManager.getActiveProviderName()).toBe('fake');
      expect(callerMessageBus.evaluate('read_file', {})).toBeDefined();
    } finally {
      observation.mockRestore();
      await callerClose();
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
