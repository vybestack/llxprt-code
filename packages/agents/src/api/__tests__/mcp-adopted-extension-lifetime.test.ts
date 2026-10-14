import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
async function addExtension(loader: {
  load(extension: LlxprtExtension): Promise<void>;
}): Promise<void> {
  await loader.load({
    name: 'caller-extension',
    version: '1.0.0',
    path: process.cwd(),
    isActive: true,
    contextFiles: [],
  });
}
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
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { fromConfig } from '../fromConfig.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
describe('MCP extension lifetime ownership', () => {
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

  it('keeps caller extensions and catalog alive when an adopted Agent is disposed', async () => {
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
    const {
      tokenizerFactory: builtTokenizer,
      contentGeneratorFactory: builtContent,
    } = configureProviderRuntimeFactories(builtConfig, builtManager);
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
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.refreshAuth();
      await builtOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }

    const loader = builtMcp.extensionOperations;
    await addExtension(loader);
    const catalog = builtMcp.toolSelection;

    const agent = await fromConfig({
      settingsOwner: builtSettingsOwner,
      settingsService: builtSettings,
      agentClient: builtOwner.getAgentClient(),
      providerManager: builtManager,
      config: builtConfig,
      mcpRuntime: builtMcp,
    });
    try {
      await agent.dispose();
      expect(loader.list().map((extension) => extension.name)).toContain(
        'caller-extension',
      );
      expect(new Set([builtMcp.toolSelection, catalog]).size).toBe(1);
      expect(builtMcp.isStopped()).toBe(false);
      expect(agent.getMessageBus()).toBe(builtMessageBus);
      await loader.unload(loader.list()[0]);
      expect(loader.list()).toHaveLength(0);
    } finally {
      await agent.dispose();
      await builtConfig.dispose();
      await builtClose();
    }
  }, 30000);

  for (const reverse of [false, true]) {
    it(`preserves an exact borrowed workspace after both facade orders (${reverse})`, async () => {
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
      const {
        tokenizerFactory: builtTokenizer,
        contentGeneratorFactory: builtContent,
      } = configureProviderRuntimeFactories(builtConfig, builtManager);
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
        );
        await builtMcp.initialize();
        await builtOwner.initializeTools();
        await builtOwner.refreshAuth();
        await builtOwner.getAgentClient().startChat();
      } catch (primary) {
        await cleanupAfterFailure(primary, builtClose);
      }

      const options = {
        settingsService: builtSettings,
        config: builtConfig,
        providerManager: builtManager,
        agentClient: builtOwner.getAgentClient(),
        mcpRuntime: builtMcp,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const facades = reverse ? [second, first] : [first, second];
      const operations = builtMcp.extensionOperations;
      try {
        expect('getExtensionLoader' in builtConfig).toBe(false);
        for (const facade of facades) {
          await facade.dispose();
          await addExtension(operations);
          expect(operations.list()).toHaveLength(1);
          expect(builtConfig.getExtensions()).toHaveLength(0);
          await operations.unload(operations.list()[0]);
          expect(builtMcp.isStopped()).toBe(false);
        }
      } finally {
        await first.dispose();
        await second.dispose();
        await builtClose();
      }
    }, 30000);
  }
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
