import {
  createCapturedSessionOwner,
  acquireCapturedSessionClient,
} from './helpers/session-client-capture.js';
import { currentOwnerClient } from './helpers/owner-current-client.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fileURLToPath } from 'node:url';
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
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';

describe('Isolated session client collaborators', () => {
  const credentials = useOwnedCredentials();
  it('creates a usable client without acquiring or closing its supplied provider lifetime', async () => {
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
      await (await currentOwnerClient(builtOwner)).startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, closeEngine);
    }

    try {
      const captured: AgentClientContract[] = [];
      const factory = buildAgentClientFactory();
      const imageFailure = new Error('External image composition failed');
      try {
        await expect(
          acquireCapturedSessionClient(
            builtConfig,
            builtSettings,
            builtSettingsOwner,
            builtManager,
            builtOAuth,
            builtContent,
            builtTokenizer,
            builtFiles,
            builtMedia.store,
            (...args) => {
              const client = factory(...args);
              captured.push(client);
              return client;
            },
            builtMcp.readInstructions,
            builtMcp.workspacePaths,
            builtMessageBus,
            {
              get run(): ImageOperationRunner {
                throw imageFailure;
              },
            },
          ),
        ).rejects.toThrow(imageFailure);
        expect(captured).toHaveLength(1);
        await expect(captured[0].generateEmbedding([])).rejects.toThrow(
          'Auxiliary generation is closed',
        );
        expect(builtManager.getActiveProviderName()).toBe('fake');
        expect(await builtMedia.store.getStoredByteLength()).toBe(0);
      } finally {
        for (const client of captured) await client.dispose();
      }
      const owner = await acquireCapturedSessionClient(
        builtConfig,
        builtSettings,
        builtSettingsOwner,
        builtManager,
        builtOAuth,
        builtContent,
        builtTokenizer,
        builtFiles,
        builtMedia.store,
        undefined,
        builtMcp.readInstructions,
        builtMcp.workspacePaths,
        builtMessageBus,
      );
      try {
        owner.bindMcpRuntime(builtMcp);
        owner.bindHooks();
        await owner.initializeTools();
        await owner.refreshAuth();
        const client = await currentOwnerClient(owner);
        await client.startChat();
        await client.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'independent client history' }],
        });
        expect(
          (await client.getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        expect(
          (await (await currentOwnerClient(builtOwner)).getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(0);
        await owner.dispose();
        await builtOwner.refreshAuth();
        await (await currentOwnerClient(builtOwner)).startChat();
        expect(builtManager.getActiveProviderName()).toBe('fake');
        expect(await builtMedia.store.getStoredByteLength()).toBe(0);
      } finally {
        await owner.dispose();
      }
    } finally {
      await closeEngine();
    }
  });
});
