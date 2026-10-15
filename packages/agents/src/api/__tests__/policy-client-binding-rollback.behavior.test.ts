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
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AgentClient } from '../../core/client.js';
import { createOwnedSessionRoots } from '../policyComposition.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';

describe('Acquisition rollback', () => {
  const credentials = useOwnedCredentials();
  it('joins post-create policy binding rollback without releasing borrowed workspace resources', async () => {
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
    const policy = new RuntimePolicyOwner(builtConfig);
    let disposals = 0;
    let settled = false;
    class PolicyFailureClient extends AgentClient {
      bindings = 0;
      override bindIdeContext(
        ...args: Parameters<AgentClient['bindIdeContext']>
      ): void {
        this.bindings += 1;
        if (this.bindings > 1) throw new Error('policy binding failed');
        super.bindIdeContext(...args);
      }
      override async dispose(): Promise<void> {
        disposals += 1;
        entered.release();
        await gate.promise;
        await super.dispose();
        throw new Error('policy client cleanup failed');
      }
    }
    const pending = createOwnedSessionRoots(
      builtConfig,
      builtSettings,
      builtSettingsOwner,
      builtManager,
      builtOAuth,
      builtContent,
      builtTokenizer,
      builtFiles,
      builtMedia,
      (config, state, instructions, store, paths) => {
        if (store === undefined || paths === undefined)
          throw new Error('Missing client inputs');
        return new PolicyFailureClient(
          config,
          state,
          instructions ?? (() => undefined),
          store,
          paths,
        );
      },
      {
        filesystemOwner: builtMcp.workspaceFilesystem,
        filesystemOwnership: 'caller',
        memoryOwner: { owner: builtMcp.workspaceMemory, ownership: 'caller' },
        definitionOwner: builtMcp.workspaceDefinitions,
        definitionOwnership: 'caller',
      },
      policy,
      undefined,
      false,
      undefined,
    ).then(
      () => undefined,
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      const progress = await Promise.race([
        entered.promise.then(() => 'cleanup'),
        pending.then(() => 'rejected'),
      ]);
      expect(progress).toBe('cleanup');
      expect(settled).toBe(false);
      gate.release();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AggregateError);
      expect(disposals).toBe(1);
      expect(builtMcp.workspaceFilesystem.paths.directories()).toContain(
        builtConfig.getTargetDir(),
      );
      await builtOwner.publishTools();
    } finally {
      gate.release();
      await pending;
      await policy.dispose();
      await closeEngine();
    }
  }, 30000);
});
