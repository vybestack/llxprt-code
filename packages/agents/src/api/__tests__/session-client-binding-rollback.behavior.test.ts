import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fileURLToPath } from 'node:url';
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
import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { cleanupAfterFailure } from '../../core/subagent-cleanup.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';

class BindingFailureClient extends AgentClient {
  failBinding = false;
  disposals = 0;
  cleanupGate: Promise<void> = Promise.resolve();
  cleanupEntered: () => void = () => {};
  override bindIdeContext(
    ...args: Parameters<AgentClient['bindIdeContext']>
  ): void {
    if (this.failBinding) throw new Error('candidate binding failed');
    super.bindIdeContext(...args);
  }
  override async dispose(): Promise<void> {
    this.disposals += 1;
    this.cleanupEntered();
    await this.cleanupGate;
    await super.dispose();
    if (this.failBinding) throw new Error('candidate cleanup failed');
  }
}

async function bindingOwner(
  builtConfig: Parameters<typeof SessionClientOwner.create>[0],
  builtSettings: SettingsService,
  builtManager: Parameters<typeof SessionClientOwner.create>[2],
  builtMedia: SessionMediaOwner,
  builtMcp: McpRuntimeOwner,
  builtSettingsOwner: SessionSettingsOwner,
  builtContent: NonNullable<Parameters<typeof SessionClientOwner.create>[8]>,
  builtTokenizer: NonNullable<Parameters<typeof SessionClientOwner.create>[9]>,
  clients: BindingFailureClient[],
  gate: ReturnType<typeof createGate>,
  entered: ReturnType<typeof createGate>,
): Promise<SessionClientOwner> {
  const owner = await SessionClientOwner.create(
    builtConfig,
    assembleTaskSchemaPolicy(builtSettings),
    builtManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing media store');
      const client = new BindingFailureClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        builtMcp.workspacePaths,
      );
      client.failBinding = clients.length > 0;
      if (client.failBinding) {
        client.cleanupGate = gate.promise;
        client.cleanupEntered = entered.release;
      }
      clients.push(client);
      return client;
    },
    builtMedia.store,
    builtMcp.readInstructions,
    builtMcp.workspacePaths,
    builtSettingsOwner,
    builtContent,
    builtTokenizer,
  );
  return owner;
}

async function checkRollback(
  authority: Parameters<typeof acquirePreferredProviderManager>[5],
  operation: (owner: SessionClientOwner) => Promise<unknown>,
): Promise<readonly number[]> {
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
    authority,
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
    authority,
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
    await builtOwner.getAgentClient().startChat();
  } catch (primary) {
    await cleanupAfterFailure(primary, closeEngine);
  }

  const gate = createGate();
  const entered = createGate();
  const clients: BindingFailureClient[] = [];
  const owner = await bindingOwner(
    builtConfig,
    builtSettings,
    builtManager,
    builtMedia,
    builtMcp,
    builtSettingsOwner,
    builtContent,
    builtTokenizer,
    clients,
    gate,
    entered,
  );
  const previous = owner.getAgentClient();
  let settled = false;
  const pending = operation(owner).then(
    () => undefined,
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await entered.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(owner.getAgentClient()).toBe(previous);
    gate.release();
    const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing aggregate');
    expect(
      failure.errors.map((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      ),
    ).toStrictEqual(['candidate binding failed', 'candidate cleanup failed']);
    expect(clients[1].disposals).toBe(1);
    await owner.dispose();
    return clients.map((client) => client.disposals);
  } finally {
    gate.release();
    await pending;
    await owner.dispose();
    await closeEngine();
  }
}

describe('Session candidate binding rollback', () => {
  const credentials = useOwnedCredentials();
  it('joins replacement cleanup and reports both failures without replacing the live client', async () => {
    expect(
      await checkRollback(credentials().authority, (owner) =>
        owner.refreshAuth(),
      ),
    ).toStrictEqual([1, 1]);
  }, 30000);
  it('joins profile-candidate cleanup and reports both failures without replacing the live client', async () => {
    expect(
      await checkRollback(credentials().authority, (owner) =>
        owner.prepareProfileClientReplacement(),
      ),
    ).toStrictEqual([1, 1]);
  }, 30000);
  it('joins detached-client cleanup and reports both failures', async () => {
    expect(
      await checkRollback(credentials().authority, (owner) =>
        owner.createDetachedAgentClient('held-detached'),
      ),
    ).toStrictEqual([1, 1]);
  }, 30000);
});
