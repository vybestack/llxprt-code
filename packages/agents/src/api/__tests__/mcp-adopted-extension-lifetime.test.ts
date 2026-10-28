/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';
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
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../core/subagent-cleanup.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { fromConfig } from '../fromConfig.js';
import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './helpers/provider-acquisition.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';

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

describe('MCP extension lifetime ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  useFakeResponsesReplay('multi-turn-text.jsonl');
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

  async function openCallerSession() {
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
      builtPolicy.session.messageBus,
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
    const builtClose = (): Promise<void> =>
      runCleanupSteps([
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ]);
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
        process.env.LLXPRT_FAKE_RESPONSES,
      );
      await builtMcp.initialize();
      await builtOwner.initializeTools();
      await builtOwner.clients.refreshAuth();
      const clients = ownerClients(builtOwner);
      await clients[clients.length - 1].startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, builtClose);
    }
    return { builtConfig, builtMcp, builtClose };
  }

  function openFacade(builtConfig: Config) {
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(builtConfig.getInitialSettings()))
      settings.set(key, value);
    return fromConfig(builtConfig, settings, {}, credentials().authority);
  }

  it('keeps caller extensions and catalog alive when an adopted Agent is disposed', async () => {
    const { builtConfig, builtMcp, builtClose } = await openCallerSession();
    const loader = builtMcp.extensionOperations;
    await addExtension(loader);
    const catalog = builtMcp.toolSelection;

    const agent = await openFacade(builtConfig);
    try {
      await agent.dispose();
      expect(loader.list().map((extension) => extension.name)).toContain(
        'caller-extension',
      );
      expect(new Set([builtMcp.toolSelection, catalog]).size).toBe(1);
      expect(builtMcp.isStopped()).toBe(false);
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
      const { builtConfig, builtMcp, builtClose } = await openCallerSession();
      const first = await openFacade(builtConfig);
      const second = await openFacade(builtConfig);
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
