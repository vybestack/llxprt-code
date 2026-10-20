import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath } from 'node:fs/promises';
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
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { SessionMcpApproval } from '../../session/session-mcp-approval.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';

class CountingClient extends AgentClient {
  disposals = 0;
  failInitialize = false;
  override async initialize(
    ...args: Parameters<AgentClient['initialize']>
  ): Promise<void> {
    if (this.failInitialize) throw new Error('refresh boom');
    await super.initialize(...args);
  }
  override async dispose(): Promise<void> {
    this.disposals += 1;
    await super.dispose();
  }
}

async function createReplacementOwner(
  builtConfig: Parameters<typeof SessionClientOwner.create>[0],
  builtSettings: SettingsService,
  builtManager: Parameters<typeof SessionClientOwner.create>[2],
  builtMedia: SessionMediaOwner,
  builtMcp: McpRuntimeOwner,
  builtSettingsOwner: SessionSettingsOwner,
  builtContent: NonNullable<Parameters<typeof SessionClientOwner.create>[8]>,
  builtTokenizer: NonNullable<Parameters<typeof SessionClientOwner.create>[9]>,
  builtFiles: ProviderFileLifecycle,
  builtOAuth: ReturnType<typeof acquirePreferredOAuth>,
  failFromClient: number,
  clients: CountingClient[],
  scopeCleanups: string[],
): Promise<SessionClientOwner> {
  const owner = await createCapturedSessionOwner(
    builtConfig,
    assembleTaskSchemaPolicy(builtSettings),
    builtManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing factory store');
      const client = new CountingClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        builtMcp.workspacePaths,
      );
      client.failInitialize = clients.length >= failFromClient;
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
  owner.bindProviderFiles(
    builtFiles,
    (provider) => builtOAuth.composeRetryOperations(provider),
    async (scope) => {
      scopeCleanups.push(scope);
    },
  );
  return owner;
}

describe('Session client replacement failure', () => {
  const credentials = useOwnedCredentials();
  it('disposes a replacement whose refresh fails once and keeps the previous client usable', async () => {
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
    const closeEngine = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      previousReplay,
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
      await cleanupAfterFailure(primary, closeEngine);
    }

    const clients: CountingClient[] = [];
    const scopeCleanups: string[] = [];
    const owner = await createReplacementOwner(
      builtConfig,
      builtSettings,
      builtManager,
      builtMedia,
      builtMcp,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
      builtFiles,
      builtOAuth,
      2,
      clients,
      scopeCleanups,
    );
    try {
      await owner.refreshAuth();
      const previous = capturedSessionClient(owner);
      expect(clients).toHaveLength(2);

      await expect(owner.refreshAuth()).rejects.toThrow('refresh boom');

      const abandoned = clients[2];
      expect(clients).toHaveLength(3);
      expect(abandoned.disposals).toBe(1);
      expect(capturedSessionClient(owner)).toBe(previous);
      expect(clients[1].disposals).toBe(0);
      await expect(owner.refreshAuth()).rejects.toThrow('refresh boom');
      expect(clients[3].disposals).toBe(1);
      expect(abandoned.disposals).toBe(1);
    } finally {
      await owner.dispose();
      await closeEngine();
    }
  }, 30000);

  it('disposes a profile candidate whose preparation fails once and keeps the previous client usable', async () => {
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
    const closeEngine = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      previousReplay,
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
      await cleanupAfterFailure(primary, closeEngine);
    }

    const clients: CountingClient[] = [];
    const scopeCleanups: string[] = [];
    const owner = await createReplacementOwner(
      builtConfig,
      builtSettings,
      builtManager,
      builtMedia,
      builtMcp,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
      builtFiles,
      builtOAuth,
      2,
      clients,
      scopeCleanups,
    );
    try {
      await owner.refreshAuth();
      const previous = capturedSessionClient(owner);

      await expect(
        owner.prepareProfileActivation(new AbortController().signal),
      ).rejects.toThrow('refresh boom');

      expect(clients[2].disposals).toBe(1);
      expect(capturedSessionClient(owner)).toBe(previous);
      expect(clients[1].disposals).toBe(0);
      expect(scopeCleanups).toStrictEqual([]);
      await owner.dispose();
      expect(clients[1].disposals).toBe(1);
      expect(clients[2].disposals).toBe(1);
      expect(scopeCleanups).toHaveLength(1);
    } finally {
      await closeEngine();
    }
  }, 30000);
});

describe('Session client owner policy persistence at disposal', () => {
  const credentials = useOwnedCredentials();
  it('joins accepted policy writes and reports their failure', async () => {
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
    let sessionPolicy: Parameters<SessionMcpApproval['bind']>[0] | undefined;
    const bindApproval = SessionMcpApproval.prototype.bind;
    const policyCapture = spyOn(
      SessionMcpApproval.prototype,
      'bind',
    ).mockImplementation(function (this: SessionMcpApproval, ...args) {
      const result = bindApproval.call(this, ...args);
      sessionPolicy = args[0];
      return result;
    });
    try {
      builtOwner.bindMcpRuntime(builtMcp);
    } finally {
      policyCapture.mockRestore();
    }
    if (sessionPolicy === undefined) throw new Error('Missing bound policy');
    builtOwner.bindHooks();
    const closeEngine = settleEngineRelease.bind(
      undefined,
      [
        () => builtOwner.dispose(),
        () => builtRelease.close(),
        () => builtMedia.dispose(),
        () => builtMcp.dispose(),
        () => builtConfig.dispose(),
        () => rm(builtDirectory, { recursive: true, force: true }),
      ],
      previousReplay,
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
      await cleanupAfterFailure(primary, closeEngine);
    }

    const policiesDir = Storage.getUserPoliciesDir();
    await mkdir(dirname(policiesDir), { recursive: true });
    await rm(policiesDir, { recursive: true, force: true });
    // A file where the policies directory belongs makes persistence fail.
    await writeFile(policiesDir, 'not a directory');
    try {
      sessionPolicy.messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'write_file',
        persist: true,
      });

      const reported = await builtOwner.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(reported).toBeInstanceOf(AggregateError);
      if (!(reported instanceof AggregateError))
        throw new Error('Disposal did not reject');
      const persistence = reported.errors.find(
        (error: unknown): error is AggregateError =>
          error instanceof AggregateError &&
          error.message === 'Session policy persistence failed',
      );
      expect(persistence?.errors).toHaveLength(1);
    } finally {
      await rm(policiesDir, { force: true });
      await closeEngine().catch(() => undefined);
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
