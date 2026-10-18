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
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgent } from '../createAgent.js';

import { fileURLToPath } from 'node:url';
import { fromConfig } from '../fromConfig.js';
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
  for (const firstClosed of [0, 1]) {
    it(`keeps the shared caller and surviving facade usable when facade ${firstClosed} closes first`, async () => {
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
      const builtOwner = await SessionClientOwner.create(
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
        await builtOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, builtClose);
      }

      const caller = builtOwner.getAgentClient();
      const optionsSettingsService: Parameters<typeof fromConfig>[1] =
        builtSettings;
      const optionsConfig: Parameters<typeof fromConfig>[0] = builtConfig;
      const optionsProviderManager: Parameters<typeof fromConfig>[4] =
        builtManager;
      const optionsMessageBus: Parameters<typeof fromConfig>[6] =
        builtMessageBus;
      const optionsMcpRuntime: Parameters<typeof fromConfig>[7] = builtMcp;
      const optionsAgentClient: Parameters<typeof fromConfig>[9] = caller;
      const facades = [
        await fromConfig(
          optionsConfig,
          optionsSettingsService,
          {},
          undefined,
          optionsProviderManager,
          undefined,
          optionsMessageBus,
          optionsMcpRuntime,
          undefined,
          optionsAgentClient,
        ),
        await fromConfig(
          optionsConfig,
          optionsSettingsService,
          {},
          undefined,
          optionsProviderManager,
          undefined,
          optionsMessageBus,
          optionsMcpRuntime,
          undefined,
          optionsAgentClient,
        ),
      ];
      try {
        const closing = facades[firstClosed].dispose();
        expect(new Set([closing, facades[firstClosed].dispose()]).size).toBe(1);
        await closing;
        await builtMcp.refreshContext();
        await facades[1 - firstClosed].setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'surviving facade' }],
          },
        ]);
        expect(
          (await facades[1 - firstClosed].getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(1);
        await facades[1 - firstClosed].dispose();
        await builtMcp.refreshContext();
        await caller.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'caller after both facades' }],
        });
        expect(
          (await caller.getHistory()).filter(
            (item) => item.speaker === 'human',
          ),
        ).toHaveLength(2);
        expect(await caller.mediaStore?.getStoredByteLength()).toBe(0);
        expect(builtManager.getActiveProviderName()).toBe('fake');
      } finally {
        await Promise.all(facades.map((facade) => facade.dispose()));
        await builtClose();
      }
    }, 30000);
  }
  it('releases failed shared activation without losing a surviving facade or the caller MCP collaborator', async () => {
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
    const builtOwner = await SessionClientOwner.create(
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
      await builtOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }

    const caller = builtOwner.getAgentClient();
    const optionsSettingsService: Parameters<typeof fromConfig>[1] =
      builtSettings;
    const optionsConfig: Parameters<typeof fromConfig>[0] = builtConfig;
    const optionsProviderManager: Parameters<typeof fromConfig>[4] =
      builtManager;
    const optionsMessageBus: Parameters<typeof fromConfig>[6] = builtMessageBus;
    const optionsMcpRuntime: Parameters<typeof fromConfig>[7] = builtMcp;
    const optionsAgentClient: Parameters<typeof fromConfig>[9] = caller;
    const facade = await fromConfig(
      optionsConfig,
      optionsSettingsService,
      {},
      undefined,
      optionsProviderManager,
      undefined,
      optionsMessageBus,
      optionsMcpRuntime,
      undefined,
      optionsAgentClient,
    );
    try {
      await expect(
        fromConfig(
          optionsConfig,
          optionsSettingsService,
          { activation: { provider: 'missing-shared-provider' } },
          undefined,
          optionsProviderManager,
          undefined,
          optionsMessageBus,
          optionsMcpRuntime,
          undefined,
          optionsAgentClient,
        ),
      ).rejects.toThrow(/activation failed/i);
      await builtMcp.refreshContext();
      await facade.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'survives failed sibling' }],
        },
      ]);
      expect(
        (await facade.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(1);
      await facade.dispose();
      await builtMcp.refreshContext();
      await caller.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'caller survives failed sibling' }],
      });
      expect(
        (await caller.getHistory()).filter((item) => item.speaker === 'human'),
      ).toHaveLength(2);
    } finally {
      await facade.dispose();
      await builtClose();
    }
  }, 30000);
  it('creates and disposes an owned public agent with its separate media lifetime', async () => {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'public-media-owner-')),
    );
    try {
      const agent = await createAgent({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        credentialAuthority: credentials().authority,
      });
      const client = agent.agentClient;
      const store = client.mediaStore;
      if (store === undefined) throw new Error('Missing owned media');
      try {
        await agent.setHistory([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'owned public session' }],
          },
        ]);
        expect(
          (await agent.getHistory()).filter((item) => item.speaker === 'human'),
        ).toHaveLength(1);
        await agent.dispose();
        expect(() => agent.agentClient).toThrow(/disposed/i);
        await expect(store.getStoredByteLength()).rejects.toThrow(/closed/i);
      } finally {
        await agent.dispose();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
      if (previousReplay === undefined)
        delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
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
