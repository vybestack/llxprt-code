import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../../../agents/src/api/mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../../agents/src/api/agentConfig.adapter.js';
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
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import { buildAgentClientFactory } from '../../../agents/src/api/agentBootstrap.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { SessionClientOwner } from '../../../agents/src/api/../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { json } from 'node:stream/consumers';
import { z } from 'zod';
import { fetchGitHubSuggestions } from './hooks/githubAtCompletion.js';
import { FakeProvider } from '../../../providers/src/fake/FakeProvider.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';

import {
  buildSlashCommandRuntime,
  buildUiRuntimeFromSource,
} from './cliUiRuntime.js';

describe('UI session client ownership', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'ui-owner-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const credentials = useOwnedCredentials();
  it('routes completion through the explicit session report tool and closes retained completion admission', async () => {
    const fixturePreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    const fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const fixtureConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: fixtureDirectory,
      }),
    );
    const fixtureSettings = new SettingsService();
    const fixturePolicy = new RuntimePolicyOwner(fixtureConfig);
    const fixtureMessageBus = fixturePolicy.session.messageBus;
    const fixtureMcp = await McpRuntimeOwner.create(
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
      fixtureConfig,
      fixtureMessageBus,
      undefined,
      undefined,
      undefined,
      fixturePolicy,
      'runtime',
    );

    const fixtureRuntimeId = 'engine-' + randomUUID();
    const fixtureRelease = new AcquisitionRelease();
    const fixtureSettingsOwner = new SessionSettingsOwner(fixtureSettings);
    fixtureRelease.acquire('settings', () => fixtureSettingsOwner.dispose());
    fixtureSettingsOwner.initializeProviderSelection(
      fixtureConfig.getProvider(),
      fixtureConfig.getModel(),
    );
    fixtureSettingsOwner.bindTelemetry(fixtureConfig);
    const fixtureFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [fixtureRuntimeId, fixtureConfig.getSessionId()])
      fixtureRelease.acquire('files', () =>
        releaseAdoptedFileScope(fixtureFiles, scope),
      );
    const fixtureManager = acquirePreferredProviderManager(
      fixtureConfig,
      fixtureSettings,
      fixtureSettingsOwner,
      fixtureFiles,
      fixtureRuntimeId,
      credentials().authority,
      fixtureRelease,
    );
    const fixtureTokenizer = configureProviderTokenizer(fixtureManager);
    const fixtureContent = createRuntimeContentGeneratorFactory();
    const fixtureOAuth = acquirePreferredOAuth(
      undefined,
      fixtureMessageBus,
      fixtureConfig,
      fixtureSettings,
      fixtureManager,
      fixtureRuntimeId,
      fixtureMcp.profileDefinitions,
      credentials().authority,
      fixtureRelease,
      undefined,
    );
    const fixtureMedia = new SessionMediaOwner(
      fixtureConfig.projectTempDir,
      1024 * 1024,
    );
    const fixtureOwner = await SessionClientOwner.create(
      fixtureConfig,
      assembleTaskSchemaPolicy(fixtureSettings),
      fixtureManager,
      buildAgentClientFactory(),
      fixtureMedia.store,
      fixtureMcp.readInstructions,
      fixtureMcp.workspacePaths,
      fixtureSettingsOwner,
      fixtureContent,
      fixtureTokenizer,
    );
    fixtureOwner.bindMcpRuntime(fixtureMcp);
    fixtureOwner.bindHooks();
    const fixtureClose = settleEngineRelease.bind(
      undefined,
      [
        () => fixtureOwner.dispose(),
        () => fixtureRelease.close(),
        () => fixtureMedia.dispose(),
        () => fixtureMcp.dispose(),
        () => fixtureConfig.dispose(),
        () => rm(fixtureDirectory, { recursive: true, force: true }),
      ],
      fixturePreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        fixtureConfig,
        fixtureSettings,
        fixtureSettingsOwner,
        fixtureManager,
        fixtureOAuth,
        fixtureRuntimeId,
        fixtureTokenizer,
        undefined,
      );
      await fixtureMcp.initialize();
      await fixtureOwner.initializeTools();
      await fixtureOwner.refreshAuth();
      await fixtureOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, fixtureClose);
    }

    const requestSchema = z
      .object({
        op: z.enum(['issue.list', 'pr.list']),
        params: z
          .object({
            limit: z.literal(10),
            state: z.literal('open'),
            search: z.string(),
          })
          .strict(),
      })
      .strict();
    const server = createServer((request, response) => {
      void json(request)
        .then((input: unknown) => {
          const { op, params } = requestSchema.parse(input);
          const items = [
            { number: 27, title: params.search.toUpperCase(), state: 'OPEN' },
          ];
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ [op === 'issue.list' ? 'issues' : 'prs']: items }),
          );
        })
        .catch((cause: unknown) =>
          response.destroy(new Error('Invalid completion request', { cause })),
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing completion server');
    const endpoint = `http://127.0.0.1:${address.port}`;
    const agent = await fromConfig({
      config: fixtureConfig,
      settingsService: fixtureSettings,
      settingsOwner: fixtureSettingsOwner,
      providerManager: fixtureManager,
      messageBus: fixtureMessageBus,
      mcpRuntime: fixtureMcp,
      agentClient: fixtureOwner.getAgentClient(),
      githubBrokerClient: {
        runOperation: async (op, params, signal) => {
          const response = await fetch(endpoint, {
            method: 'POST',
            body: JSON.stringify({ op, params }),
            signal,
          });
          const input: unknown = await response.json();
          return z.record(z.unknown()).parse(input);
        },
      },
    });
    try {
      const runtime = buildUiRuntimeFromSource(fixtureConfig, agent);
      const reads = runtime.app.githubCompletion;
      if (reads === undefined)
        throw new Error('Missing GitHub completion reads');
      expect('submitReport' in reads).toBe(false);
      expect('getGitHubBrokerClient' in runtime.app).toBe(false);
      const suggestions = await fetchGitHubSuggestions(
        reads,
        { kind: 'issue', query: 'completion report' },
        new AbortController().signal,
      );
      expect(suggestions).toStrictEqual([
        {
          label: 'issue-27  COMPLETION REPORT',
          value: 'issue-27',
          description: 'issue · open',
        },
      ]);
      const invalid: unknown = Reflect.apply(reads.readReport, undefined, [
        'issue.create',
        { title: 'forbidden' },
        new AbortController().signal,
      ]);
      await expect(invalid).rejects.toThrow('Invalid enum value');
      await agent.dispose();
      await expect(
        reads.readReport(
          'issue.list',
          { limit: 10, state: 'open', search: 'after close' },
          new AbortController().signal,
        ),
      ).rejects.toThrow('closed');
      expect(
        await fetchGitHubSuggestions(
          reads,
          { kind: 'pr', query: 'closed' },
          new AbortController().signal,
        ),
      ).toStrictEqual([]);
    } finally {
      await agent.dispose();
      await fixtureClose();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await closed;
    }
  });

  it('resolves the published current client without embedding it in the workspace command projection', async () => {
    const fixturePreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    const fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const fixtureConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: fixtureDirectory,
      }),
    );
    const fixtureSettings = new SettingsService();
    const fixturePolicy = new RuntimePolicyOwner(fixtureConfig);
    const fixtureMessageBus = fixturePolicy.session.messageBus;
    const fixtureMcp = await McpRuntimeOwner.create(
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
      fixtureConfig,
      fixtureMessageBus,
      undefined,
      undefined,
      undefined,
      fixturePolicy,
      'runtime',
    );

    const fixtureRuntimeId = 'engine-' + randomUUID();
    const fixtureRelease = new AcquisitionRelease();
    const fixtureSettingsOwner = new SessionSettingsOwner(fixtureSettings);
    fixtureRelease.acquire('settings', () => fixtureSettingsOwner.dispose());
    fixtureSettingsOwner.initializeProviderSelection(
      fixtureConfig.getProvider(),
      fixtureConfig.getModel(),
    );
    fixtureSettingsOwner.bindTelemetry(fixtureConfig);
    const fixtureFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [fixtureRuntimeId, fixtureConfig.getSessionId()])
      fixtureRelease.acquire('files', () =>
        releaseAdoptedFileScope(fixtureFiles, scope),
      );
    const fixtureManager = acquirePreferredProviderManager(
      fixtureConfig,
      fixtureSettings,
      fixtureSettingsOwner,
      fixtureFiles,
      fixtureRuntimeId,
      credentials().authority,
      fixtureRelease,
    );
    const fixtureTokenizer = configureProviderTokenizer(fixtureManager);
    const fixtureContent = createRuntimeContentGeneratorFactory();
    const fixtureOAuth = acquirePreferredOAuth(
      undefined,
      fixtureMessageBus,
      fixtureConfig,
      fixtureSettings,
      fixtureManager,
      fixtureRuntimeId,
      fixtureMcp.profileDefinitions,
      credentials().authority,
      fixtureRelease,
      undefined,
    );
    const fixtureMedia = new SessionMediaOwner(
      fixtureConfig.projectTempDir,
      1024 * 1024,
    );
    const fixtureOwner = await SessionClientOwner.create(
      fixtureConfig,
      assembleTaskSchemaPolicy(fixtureSettings),
      fixtureManager,
      buildAgentClientFactory(),
      fixtureMedia.store,
      fixtureMcp.readInstructions,
      fixtureMcp.workspacePaths,
      fixtureSettingsOwner,
      fixtureContent,
      fixtureTokenizer,
    );
    fixtureOwner.bindMcpRuntime(fixtureMcp);
    fixtureOwner.bindHooks();
    const fixtureClose = settleEngineRelease.bind(
      undefined,
      [
        () => fixtureOwner.dispose(),
        () => fixtureRelease.close(),
        () => fixtureMedia.dispose(),
        () => fixtureMcp.dispose(),
        () => fixtureConfig.dispose(),
        () => rm(fixtureDirectory, { recursive: true, force: true }),
      ],
      fixturePreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        fixtureConfig,
        fixtureSettings,
        fixtureSettingsOwner,
        fixtureManager,
        fixtureOAuth,
        fixtureRuntimeId,
        fixtureTokenizer,
        undefined,
      );
      await fixtureMcp.initialize();
      await fixtureOwner.initializeTools();
      await fixtureOwner.refreshAuth();
      await fixtureOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, fixtureClose);
    }

    const agent = await fromConfig({
      settingsService: fixtureSettings,
      settingsOwner: fixtureSettingsOwner,
      config: fixtureConfig,
      providerManager: fixtureManager,
      messageBus: fixtureMessageBus,
      mcpRuntime: fixtureMcp,
      agentClient: fixtureOwner.getAgentClient(),
    });
    try {
      const ui = buildUiRuntimeFromSource(fixtureConfig, agent);
      const workspace = buildSlashCommandRuntime(fixtureConfig, agent);
      const previous = ui.agentClientSource.getAgentClient();
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'carried history' }],
        },
      ]);
      const provider = new FakeProvider(
        fileURLToPath(
          new URL(
            '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
            import.meta.url,
          ),
        ),
        fixtureConfig.getTargetDir(),
      );
      provider.name = 'ui-profile-owner';
      fixtureManager.registerProvider(provider);
      await agent.profiles.applySnapshot({
        version: 1,
        provider: provider.name,
        model: 'replacement-model',
        modelParams: {},
        ephemeralSettings: {},
      });
      const current = ui.agentClientSource.getAgentClient();
      expect(current).not.toBe(previous);
      expect(
        (await agent.getHistory()).filter(
          (content) => content.speaker === 'human',
        ),
      ).toHaveLength(1);
      expect('getAgentClient' in workspace).toBe(false);
      expect('createDetachedAgentClient' in workspace).toBe(false);
      expect('getAgentClientFactory' in workspace).toBe(false);
      await agent.dispose();
      await fixtureMcp.refreshContext();
      await previous.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'borrowed caller survives' }],
      });
      expect(
        (await previous.getHistory()).filter(
          (content) => content.speaker === 'human',
        ),
      ).toHaveLength(2);
    } finally {
      await agent.dispose();
      await fixtureClose();
    }
  });

  it('creates detached clients from the session owner while retaining the primary client', async () => {
    const fixturePreviousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL(
        '../../../agents/src/api/__tests__/fixtures/multi-turn-text.jsonl',
        import.meta.url,
      ),
    );
    const fixtureDirectory = await realpath(
      await mkdtemp(join(tmpdir(), 'explicit-engine-owner-')),
    );
    const fixtureConfig = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: fixtureDirectory,
      }),
    );
    const fixtureSettings = new SettingsService();
    const fixturePolicy = new RuntimePolicyOwner(fixtureConfig);
    const fixtureMessageBus = fixturePolicy.session.messageBus;
    const fixtureMcp = await McpRuntimeOwner.create(
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
      fixtureConfig,
      fixtureMessageBus,
      undefined,
      undefined,
      undefined,
      fixturePolicy,
      'runtime',
    );

    const fixtureRuntimeId = 'engine-' + randomUUID();
    const fixtureRelease = new AcquisitionRelease();
    const fixtureSettingsOwner = new SessionSettingsOwner(fixtureSettings);
    fixtureRelease.acquire('settings', () => fixtureSettingsOwner.dispose());
    fixtureSettingsOwner.initializeProviderSelection(
      fixtureConfig.getProvider(),
      fixtureConfig.getModel(),
    );
    fixtureSettingsOwner.bindTelemetry(fixtureConfig);
    const fixtureFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [fixtureRuntimeId, fixtureConfig.getSessionId()])
      fixtureRelease.acquire('files', () =>
        releaseAdoptedFileScope(fixtureFiles, scope),
      );
    const fixtureManager = acquirePreferredProviderManager(
      fixtureConfig,
      fixtureSettings,
      fixtureSettingsOwner,
      fixtureFiles,
      fixtureRuntimeId,
      credentials().authority,
      fixtureRelease,
    );
    const fixtureTokenizer = configureProviderTokenizer(fixtureManager);
    const fixtureContent = createRuntimeContentGeneratorFactory();
    const fixtureOAuth = acquirePreferredOAuth(
      undefined,
      fixtureMessageBus,
      fixtureConfig,
      fixtureSettings,
      fixtureManager,
      fixtureRuntimeId,
      fixtureMcp.profileDefinitions,
      credentials().authority,
      fixtureRelease,
      undefined,
    );
    const fixtureMedia = new SessionMediaOwner(
      fixtureConfig.projectTempDir,
      1024 * 1024,
    );
    const fixtureOwner = await SessionClientOwner.create(
      fixtureConfig,
      assembleTaskSchemaPolicy(fixtureSettings),
      fixtureManager,
      buildAgentClientFactory(),
      fixtureMedia.store,
      fixtureMcp.readInstructions,
      fixtureMcp.workspacePaths,
      fixtureSettingsOwner,
      fixtureContent,
      fixtureTokenizer,
    );
    fixtureOwner.bindMcpRuntime(fixtureMcp);
    fixtureOwner.bindHooks();
    const fixtureClose = settleEngineRelease.bind(
      undefined,
      [
        () => fixtureOwner.dispose(),
        () => fixtureRelease.close(),
        () => fixtureMedia.dispose(),
        () => fixtureMcp.dispose(),
        () => fixtureConfig.dispose(),
        () => rm(fixtureDirectory, { recursive: true, force: true }),
      ],
      fixturePreviousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        fixtureConfig,
        fixtureSettings,
        fixtureSettingsOwner,
        fixtureManager,
        fixtureOAuth,
        fixtureRuntimeId,
        fixtureTokenizer,
        undefined,
      );
      await fixtureMcp.initialize();
      await fixtureOwner.initializeTools();
      await fixtureOwner.refreshAuth();
      await fixtureOwner.getAgentClient().startChat();
    } catch (primary) {
      await cleanupAfterFailure(primary, fixtureClose);
    }

    try {
      const agent = await fromConfig({
        config: fixtureConfig,
        settingsService: fixtureSettings,
        settingsOwner: fixtureSettingsOwner,
        providerManager: fixtureManager,
        messageBus: fixtureMessageBus,
        mcpRuntime: fixtureMcp,
        agentClient: fixtureOwner.getAgentClient(),
      });
      const ui = buildUiRuntimeFromSource(fixtureConfig, agent);
      const detached = await ui.agentClientSource.createDetachedAgentClient?.();
      expect(detached).toBeDefined();
      expect(detached).not.toBe(agent.agentClient);
      expect(detached?.mediaStore).toBe(agent.agentClient.mediaStore);
      expect(detached?.hasChatInitialized()).toBe(false);
      await detached?.dispose();
      expect(
        agent.agentClient.getHistoryService()?.getRawHistory(),
      ).toHaveLength(0);
    } finally {
      await fixtureClose();
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
