import { prepareActivationFixture } from './helpers/activation-acquisition-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { fileURLToPath } from 'node:url';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
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
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { AgentClient } from '../../core/client.js';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';

describe('Session owner cleanup joining', () => {
  const credentials = useOwnedCredentials();
  it('joins the preflight client before media cleanup when adoption runtime construction fails', async () => {
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

    let cleanupStates: readonly boolean[] = [];
    class ObservedCleanupClient extends AgentClient {
      override async dispose(): Promise<void> {
        const open = await builtMedia.store.getStoredByteLength().then(
          () => true,
          () => false,
        );
        cleanupStates = [...cleanupStates, open];
        await super.dispose();
      }
    }
    const owner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new ObservedCleanupClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          builtMcp.workspacePaths,
        );
      },
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    const intent = { provider: 'fake', model: 'fake-model' };
    const operation = prepareActivationFixture(
      builtConfig,
      builtManager,
      async () => {
        await owner.refreshAuth();
        return { authFailed: false, infoMessages: [] };
      },
      undefined,
      builtMedia,
      owner,
      builtMcp.workspaceFilesystem,
      builtMcp.workspaceMemory,
      false,
      builtSettingsOwner,
      undefined,
      builtMcp.workspaceDefinitions,
      false,
      new WorkspaceTrustLifecycle({
        localTrust: builtConfig.initialWorkspaceTrust,
      }),
    );
    try {
      const receipt = await operation.preflight(intent);
      if (receipt.token === undefined) throw new Error('Missing receipt');
      await expect(
        fromConfig(
          builtConfig,
          builtSettings,
          { activation: intent },
          undefined,
          builtManager,
          undefined,
          builtMessageBus,
          builtMcp,
          { operation, token: receipt.token },
          undefined,
          undefined,
          undefined,
          undefined,
          {
            ...createAgentRuntimeFactoryBindings(builtMedia.store),
            taskToolRegistration: () => {
              throw new Error('Runtime assembly fault');
            },
          },
        ),
      ).rejects.toThrow('Runtime assembly fault');
      expect(cleanupStates).not.toContain(false);
      await expect(builtMedia.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await operation.dispose();
      await closeEngine();
    }
  }, 30000);
  it('joins an accepted replacement and closes every owned client before resolving disposal', async () => {
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

    const entered = createGate();
    const released = createGate();
    class GatedClient extends AgentClient {
      override async initialize(
        content: ContentGeneratorConfig,
      ): Promise<void> {
        entered.release();
        await released.promise;
        await super.initialize(content);
      }
    }
    const before = builtSettingsOwner['modelNotifications'].listenerCount(
      CoreEvent.ModelChanged,
    );
    const owner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new GatedClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          builtMcp.workspacePaths,
        );
      },
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    const pending = owner.refreshAuth();
    await entered.promise;
    let closed = false;
    const closing = owner.dispose().then(() => {
      closed = true;
    });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      released.release();
      await pending;
      await closing;
      await closeEngine();
    }
    expect(
      builtSettingsOwner['modelNotifications'].listenerCount(
        CoreEvent.ModelChanged,
      ),
    ).toBe(before - 1);
  }, 30000);
  it('still closes separately owned media when client cleanup rejects', async () => {
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

    const entered = createGate();
    const released = createGate();
    class FailingCleanupClient extends AgentClient {
      override async dispose(): Promise<void> {
        await super.dispose();
        throw new Error('Client cleanup fault');
      }
    }
    const owner = await createCapturedSessionOwner(
      builtConfig,
      assembleTaskSchemaPolicy(builtSettings),
      builtManager,
      (config, state, instructions, store) => {
        if (store === undefined) throw new Error('Missing factory store');
        return new FailingCleanupClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          builtMcp.workspacePaths,
        );
      },
      builtMedia.store,
      builtMcp.readInstructions,
      builtMcp.workspacePaths,
      builtSettingsOwner,
      builtContent,
      builtTokenizer,
    );
    const operation = prepareActivationFixture(
      builtConfig,
      builtManager,
      async () => {
        entered.release();
        await released.promise;
        return {
          authFailed: true,
          infoMessages: [],
          authError: new Error('Activation failed'),
        };
      },
      undefined,
      builtMedia,
      owner,
      builtMcp.workspaceFilesystem,
      builtMcp.workspaceMemory,
      false,
      builtSettingsOwner,
      undefined,
      builtMcp.workspaceDefinitions,
      false,
      new WorkspaceTrustLifecycle({
        localTrust: builtConfig.initialWorkspaceTrust,
      }),
    );
    const preflight = operation.preflight({ provider: 'fake' });
    await entered.promise;
    const closing = operation.dispose();
    released.release();
    try {
      await preflight;
      await expect(closing).rejects.toThrow(/cleanup/i);
      await expect(builtMedia.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      await closeEngine();
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
