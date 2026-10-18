import { buildOwnedMcpControl } from '../control/mcpControlWiring.js';
import { createAgentAuthState } from '../control/authState.js';
import { WorkspaceControl } from '../control/workspaceControl.js';
import { assembleIdeControl } from '../control/ideControl.js';
import { LspControl } from '../control/lspControl.js';
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { CoreToolScheduler } from '../../core/coreToolScheduler.js';
import { withChildToolDisplay } from '../../session/childToolAssembly.js';
import { ChildToolDisplay } from '../../session/childToolDisplay.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import {
  assembleTaskOwner,
  cleanupFailedShellBootstrap,
} from '../agent-shell-assembly.js';
import {
  buildFacadeState,
  createStableDisplayCallbacks,
  recordOwnership,
} from '../agentBootstrap.js';
import type { AgentSchedulerHandle } from '../config-types.js';
import {
  assembleSessionAuthentication,
  clearProviderAuthenticationCache,
} from '../control/session-authentication.js';
import { assembleModelSelection } from '../model-selection.js';
import { setActiveModel } from '../providerMutations.js';

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
import { SessionClientOwner } from '../../session/session-client-owner.js';
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
import { AgentImpl } from '../agentImpl.js';
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

    const closing = gate();
    const release = gate();
    let releases = 0;
    builtOwner.bindProviderFiles(builtFiles, (provider) =>
      builtOAuth.composeRetryOperations(provider),
    );
    const agent = await (async () => {
      const task = assembleTaskOwner(builtSettings);
      const shell = new ShellJobOwner(() =>
        resolveShellJobSettings(builtSettings),
      );
      const child = new ChildToolDisplay();
      const editor = { editorCallbacks: {} };
      const display = {};
      try {
        builtOwner.initializeExecution(
          withChildToolDisplay(
            (options) => new CoreToolScheduler(options),
            child,
            task,
            shell,
          ),
          undefined,
          createStableDisplayCallbacks(editor, display),
        );
        const runtimeState = buildFacadeState(
          { provider: 'fake', model: 'fake-model' },
          undefined,
          builtRuntimeId,
        );
        const close = async () => {
          releases += 1;
          closing.release();
          await release.promise;
          await builtRelease.close();
        };
        const handles: AgentSchedulerHandle[] = [];
        const ownership = recordOwnership({
          runtimeHandle: { cleanup: close },
          injectedSchedulerHandles: handles,
          configOwnership: 'caller',
        });
        const history =
          builtOwner.getAgentClient().getHistoryService() ??
          new HistoryService();
        builtOwner.getAgentClient().storeHistoryServiceForReuse(history);
        const mcpAuth = createAgentAuthState();
        const facade = new AgentImpl(
          builtSettingsOwner,
          builtOwner,
          builtMcp.workspaceSkills.operations,
          undefined,
          undefined,
          task,
          shell,
          new WorkspaceControl(
            builtMcp.profileDefinitions,
            builtMcp.profileWrites,
            builtMcp.subagentDefinitions,
            builtMcp.subagentWrites,
            builtMcp.checkpointOperations,
            builtMcp.workspaceIgnore,
            builtMcp.workspaceSearch,
            builtMcp.workspaceFiles,
            builtMcp.workspacePaths.contains,
            builtMcp.workspacePaths.directories,
            builtMcp.addWorkspaceDirectory,
            builtConfig.getTargetDir(),
            builtConfig.getProjectRoot(),
          ),
          assembleIdeControl(
            builtMcp.trust,
            builtMcp.ide,
            () => editor.editorCallbacks,
          ),
          new LspControl(builtMcp.lspInspection),
          (...args) => builtMcp.awaitDiscovery(...args),
          (...args) => builtMcp.closeAdmission(...args),
          buildOwnedMcpControl(
            (...args) => builtMcp.readServerSettings(...args),
            builtOwner.toolCatalog.selection,
            (...args) => builtMcp.listPrompts(...args),
            (...args) => builtMcp.listResources(...args),
            (...args) => builtMcp.readOAuthCredentials(...args),
            (...args) => builtMcp.performOAuth(...args),
            (...args) => builtMcp.status(...args),
            (...args) => builtMcp.refresh(...args),
            (...args) => builtMcp.reload(...args),
            (server) => mcpAuth.mcpAuth.has(server),
            (server) => mcpAuth.mcpAuth.add(server),
            () => builtOwner.getAgentClient().setTools(),
            (...args) => builtMcp.subscribeStatus(...args),
            (...args) => builtMcp.findResource(...args),
            (...args) => builtMcp.readResource(...args),
          ),
          mcpAuth,
          builtConfig,
          builtManager,
          builtOAuth,
          () => 'agent',
          builtSettings,
          builtRuntimeId,
          close,
          builtOwner.messageBus,
          runtimeState,
          ownership,
          'facade',
          () => builtOwner.getAgentClient(),
          history,
          editor,
          display,
          undefined,
          undefined,
          child,
          async (model) => {
            await setActiveModel(
              model,
              assembleModelSelection(builtSettingsOwner),
              builtSettings,
              builtManager.getActiveProvider(),
            );
          },
          assembleSessionAuthentication(builtOAuth, (provider) =>
            clearProviderAuthenticationCache(
              builtManager.getProviderByName(provider),
            ),
          ),
        );
        expect(facade.getMessageBus()).toBe(builtOwner.messageBus);
        return facade;
      } catch (primary) {
        return cleanupFailedShellBootstrap(primary, task, shell);
      }
    })();
    try {
      await agent.setModel('finalized-model');
      expect(builtSettingsOwner.readSelectedModel()).toBe(agent.getModel());
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'finalized history' }],
        },
      ]);
      expect(await builtOwner.getAgentClient().getHistory()).toStrictEqual(
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
