import { adoptFixture as fromConfig } from './helpers/adoption-fixture.js';

import { AgentResourceCapture } from './helpers/agent-resource-capture.js';
import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';

import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { randomUUID } from 'node:crypto';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';

import { gate } from './helpers/async-child-disposal-join-fixture.js';

describe('Agent finalization collaborators', () => {
  const credentials = useOwnedCredentials();
  it('binds the supplied settings and joins concurrent disposal through one close operation', async () => {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
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
    const builtMcp = await McpRuntimeOwner.create(
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
      builtConfig,
      builtMessageBus,
      undefined,
      undefined,
      undefined,
      builtPolicy,
      'runtime',
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
    const closeEngine = async (): Promise<void> => {
      try {
        await runCleanupSteps([
          () => builtOwner.dispose(),
          () => builtRelease.close(),
          () => builtMedia.dispose(),
          () => builtMcp.dispose(),
          () => builtConfig.dispose(),
          () => rm(builtDirectory, { recursive: true, force: true }),
        ]);
      } finally {
        if (previousReplay === undefined)
          delete process.env.LLXPRT_FAKE_RESPONSES;
        else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
      }
    };
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
      await cleanupAfterFailure(primary, closeEngine);
    }

    const closing = gate();
    const release = gate();
    let releases = 0;
    builtOwner.bindProviderFiles(builtFiles, (provider) =>
      builtOAuth.composeRetryOperations(provider),
    );
    const capture = new AgentResourceCapture();
    const borrowed = capturedSessionClient(builtOwner);
    capture.observe(borrowed);
    capture.clients.push(borrowed);
    const agent = await capture.construct(() =>
      fromConfig(
        builtConfig,
        builtSettings,
        { sessionId: builtRuntimeId },
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtMessageBus,
        builtMcp,
        undefined,
        borrowed,
        builtFiles,
        builtTokenizer,
        builtContent,
        capture.factories(undefined),
      ),
    );
    capture.bindAgent(agent);
    expect(fixtureAgentResources(agent).messageBus).toBe(builtMessageBus);

    try {
      await agent.setModel('finalized-model');
      expect(builtSettingsOwner.readSelectedModel()).toBe(agent.getModel());
      const nativeClient = fixtureAgentResources(agent).publishedClient(agent);
      const close = nativeClient.dispose.bind(nativeClient);
      nativeClient.dispose = async () => {
        releases += 1;
        closing.release();
        await release.promise;
        await close();
      };
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'finalized history' }],
        },
      ]);
      expect(await nativeClient.getHistory()).toStrictEqual(
        await agent.getHistory(),
      );
      let completed = 0;
      const first = agent.dispose().then(() => {
        completed += 1;
      });
      await closing.promise;
      const second = agent.dispose().then(() => {
        completed += 1;
      });
      expect(completed).toBe(0);
      expect(await builtMedia.store.getStoredByteLength()).toBe(0);
      release.release();
      await Promise.all([first, second]);
      await agent.dispose();
      expect({ completed, releases }).toStrictEqual({
        completed: 2,
        releases: 1,
      });
      expect(await builtMedia.store.getStoredByteLength()).toBe(0);
    } finally {
      release.release();
      await agent.dispose();
      await closeEngine();
    }
  });
});
