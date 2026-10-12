import { SettingsService } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import {
  createIsolatedRuntimeContext,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { registerProvidersOntoManager } from '../../createAgent.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { SessionClientOwner } from '../../../session/session-client-owner.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface WorkspaceEngineFixture {
  readonly settingsService: SettingsService;
  readonly config: Config;
  readonly policy: RuntimePolicyOwner;
  readonly messageBus: MessageBus;
  readonly mcp: McpRuntimeOwner;
  cleanup(): Promise<void>;
}
export interface SessionClientEngineFixture extends WorkspaceEngineFixture {
  readonly handle: IsolatedRuntimeContextHandle;
  readonly media: SessionMediaOwner;
  readonly owner: SessionClientOwner;
}

export async function createWorkspaceEngineFixture(
  label: string = randomUUID(),
): Promise<WorkspaceEngineFixture> {
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
    new URL('../fixtures/multi-turn-text.jsonl', import.meta.url),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      sessionId: label,
      workingDir: process.cwd(),
    }),
  );
  const settingsService = new SettingsService();
  const policy = new RuntimePolicyOwner(config);
  const messageBus = policy.session.messageBus;
  const mcp = await McpRuntimeOwner.create(
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
    config,
    messageBus,
    undefined,
    undefined,
    undefined,
    policy,
    'runtime',
  );
  async function cleanup(): Promise<void> {
    try {
      await mcp.dispose();
      await config.dispose();
    } finally {
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
  }
  return { config, settingsService, policy, messageBus, mcp, cleanup };
}

export async function createSessionClientEngineFixture(
  label: string = randomUUID(),
): Promise<SessionClientEngineFixture> {
  const workspace = await createWorkspaceEngineFixture(label);
  const { config, messageBus, mcp } = workspace;
  const handle = createIsolatedRuntimeContext(
    {
      runtimeId: `engine-${randomUUID()}`,
      config,
      messageBus,
      prepare: (ctx) =>
        registerProvidersOntoManager(ctx.providerManager, ctx, config),
    },
    workspace.settingsService,
  );
  handle.settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  configureProviderRuntimeFactories(config, handle.providerManager);
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(workspace.settingsService),
    handle.providerManager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    handle.settingsOwner,
    handle.contentGeneratorFactory,
    handle.tokenizerFactory,
  );
  owner.bindMcpRuntime(mcp);
  owner.bindHooks();
  async function cleanup(): Promise<void> {
    await owner.dispose();
    await handle.cleanup();
    await media.dispose();
    await workspace.cleanup();
  }
  try {
    await handle.activate();
    await mcp.initialize();
    await owner.initializeTools();
    await owner.refreshAuth();
    await owner.getAgentClient().startChat();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { ...workspace, handle, media, owner, cleanup };
}

export function engineGate(): {
  readonly promise: Promise<void>;
  readonly release: () => void;
} {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
