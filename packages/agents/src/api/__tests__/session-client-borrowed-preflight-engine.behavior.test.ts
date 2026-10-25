import { capturedActivation } from './helpers/activation-acquisition-capture.js';
import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

import { captureActivationAcquisition as assembleAgentActivationBootstrap } from './helpers/activation-acquisition-capture.js';

import { fileURLToPath } from 'node:url';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
describe('Explicit session client lifetime', () => {
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
  it('rejects a borrowed client from another Config even when both session labels match', async () => {
    const leftPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const leftDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const leftConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-engine-label',
        workingDir: leftDirectory,
      }),
    );
    const leftSettings = new SettingsService();
    const leftPolicy = new RuntimePolicyOwner(leftConfig);
    const leftMessageBus = leftPolicy.session.messageBus;
    const leftMcp = await createTestMcpRuntime(
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
        config: leftConfig,
        policy: { owner: leftPolicy, ownership: 'runtime' },
      },
      {},
    );

    const leftRuntimeId = 'engine-' + randomUUID();
    const leftRelease = new AcquisitionRelease();
    const leftSettingsOwner = new SessionSettingsOwner(leftSettings);
    leftRelease.acquire('settings', () => leftSettingsOwner.dispose());
    leftSettingsOwner.initializeProviderSelection(
      leftConfig.getProvider(),
      leftConfig.getModel(),
    );
    leftSettingsOwner.bindTelemetry(leftConfig);
    const leftFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [leftRuntimeId, leftConfig.getSessionId()])
      leftRelease.acquire('files', () =>
        releaseAdoptedFileScope(leftFiles, scope),
      );
    const leftManager = acquirePreferredProviderManager(
      leftConfig,
      leftSettings,
      leftSettingsOwner,
      leftFiles,
      leftRuntimeId,
      credentials().authority,
      leftRelease,
    );
    const leftTokenizer = configureProviderTokenizer(leftManager);
    const leftContent = createRuntimeContentGeneratorFactory();
    const leftOAuth = acquirePreferredOAuth(
      undefined,
      leftMessageBus,
      leftConfig,
      leftSettings,
      leftManager,
      leftRuntimeId,
      leftMcp.profileDefinitions,
      credentials().authority,
      leftRelease,
      undefined,
    );
    const leftMedia = new SessionMediaOwner(
      leftConfig.projectTempDir,
      1024 * 1024,
    );
    const leftOwner = await createCapturedSessionOwner(
      leftConfig,
      assembleTaskSchemaPolicy(leftSettings),
      leftManager,
      buildAgentClientFactory(),
      leftMedia.store,
      leftMcp.readInstructions,
      leftMcp.workspacePaths,
      leftSettingsOwner,
      leftContent,
      leftTokenizer,
    );
    leftOwner.bindMcpRuntime(leftMcp);
    leftOwner.bindHooks();
    const leftClose = settleEngineRelease.bind(
      undefined,
      [
        () => leftOwner.dispose(),
        () => leftRelease.close(),
        () => leftMedia.dispose(),
        () => leftMcp.dispose(),
        () => leftConfig.dispose(),
        () => rm(leftDirectory, { recursive: true, force: true }),
      ],
      leftPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        leftConfig,
        leftSettings,
        leftSettingsOwner,
        leftManager,
        leftOAuth,
        leftRuntimeId,
        leftTokenizer,
        undefined,
      );
      await leftMcp.initialize();
      await leftOwner.initializeTools();
      await leftOwner.refreshAuth();
      await capturedSessionClient(leftOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, leftClose);
    }

    const rightPreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const rightDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const rightConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: 'same-engine-label',
        workingDir: rightDirectory,
      }),
    );
    const rightSettings = new SettingsService();
    const rightPolicy = new RuntimePolicyOwner(rightConfig);
    const rightMessageBus = rightPolicy.session.messageBus;
    const rightMcp = await createTestMcpRuntime(
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
        config: rightConfig,
        policy: { owner: rightPolicy, ownership: 'runtime' },
      },
      {},
    );

    const rightRuntimeId = 'engine-' + randomUUID();
    const rightRelease = new AcquisitionRelease();
    const rightSettingsOwner = new SessionSettingsOwner(rightSettings);
    rightRelease.acquire('settings', () => rightSettingsOwner.dispose());
    rightSettingsOwner.initializeProviderSelection(
      rightConfig.getProvider(),
      rightConfig.getModel(),
    );
    rightSettingsOwner.bindTelemetry(rightConfig);
    const rightFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [rightRuntimeId, rightConfig.getSessionId()])
      rightRelease.acquire('files', () =>
        releaseAdoptedFileScope(rightFiles, scope),
      );
    const rightManager = acquirePreferredProviderManager(
      rightConfig,
      rightSettings,
      rightSettingsOwner,
      rightFiles,
      rightRuntimeId,
      credentials().authority,
      rightRelease,
    );
    const rightTokenizer = configureProviderTokenizer(rightManager);
    const rightContent = createRuntimeContentGeneratorFactory();
    const rightOAuth = acquirePreferredOAuth(
      undefined,
      rightMessageBus,
      rightConfig,
      rightSettings,
      rightManager,
      rightRuntimeId,
      rightMcp.profileDefinitions,
      credentials().authority,
      rightRelease,
      undefined,
    );
    const rightMedia = new SessionMediaOwner(
      rightConfig.projectTempDir,
      1024 * 1024,
    );
    const rightOwner = await createCapturedSessionOwner(
      rightConfig,
      assembleTaskSchemaPolicy(rightSettings),
      rightManager,
      buildAgentClientFactory(),
      rightMedia.store,
      rightMcp.readInstructions,
      rightMcp.workspacePaths,
      rightSettingsOwner,
      rightContent,
      rightTokenizer,
    );
    rightOwner.bindMcpRuntime(rightMcp);
    rightOwner.bindHooks();
    const rightClose = settleEngineRelease.bind(
      undefined,
      [
        () => rightOwner.dispose(),
        () => rightRelease.close(),
        () => rightMedia.dispose(),
        () => rightMcp.dispose(),
        () => rightConfig.dispose(),
        () => rm(rightDirectory, { recursive: true, force: true }),
      ],
      rightPreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        rightConfig,
        rightSettings,
        rightSettingsOwner,
        rightManager,
        rightOAuth,
        rightRuntimeId,
        rightTokenizer,
        undefined,
      );
      await rightMcp.initialize();
      await rightOwner.initializeTools();
      await rightOwner.refreshAuth();
      await capturedSessionClient(rightOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, rightClose);
    }

    try {
      await expect(
        fromConfig(
          rightConfig,
          rightSettings,
          {},
          undefined,
          rightManager,
          undefined,
          rightMessageBus,
          rightMcp,
          undefined,
          capturedSessionClient(leftOwner),
        ),
      ).rejects.toThrow(/different Config/i);
    } finally {
      await rightClose();
      await leftClose();
    }
  }, 30000);
  it('transfers one borrowed preflight owner without closing the caller client, manager, media or MCP', async () => {
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
      await capturedSessionClient(builtOwner).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }

    const client = capturedSessionClient(builtOwner);
    await client.startChat();
    const intent = { provider: 'fake', model: 'fake-model' };
    const operation = await assembleAgentActivationBootstrap(
      builtConfig,
      builtSettings,
      builtManager,
      builtOAuth,
      () => 'agent',
      'borrowed',
      client,
      builtMcp,
    );
    try {
      const result = await operation.preflight(intent);
      if (result.token === undefined)
        throw new Error('Missing preflight receipt');
      const agent = await fromConfig(
        builtConfig,
        builtSettings,
        { activation: intent },
        undefined,
        builtManager,
        undefined,
        builtMessageBus,
        builtMcp,
        { operation, token: result.token },
        client,
      );
      try {
        expect(fixtureAgentResources(agent).publishedClient(agent)).toBe(
          client,
        );
        expect(fixtureAgentResources(agent).publishedClient(agent)).toBe(
          capturedSessionClient(capturedActivation(operation).owner),
        );
      } finally {
        await agent.dispose();
      }
      await builtMcp.refreshContext();
      await client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller retains preflight session' }],
      });
      expect(
        (await client.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      expect(await builtMedia.store.getStoredByteLength()).toBe(0);
      expect(builtManager.getActiveProviderName()).toBe('fake');
    } finally {
      await operation.dispose();
      await builtClose();
    }
  }, 30000);
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
