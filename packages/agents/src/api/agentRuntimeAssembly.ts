/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assembleSessionImages,
  type SessionImageSelection,
} from './session-image-assembly.js';
import type { MessageBus } from '@vybestack/llxprt-code-core';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

import { SessionClientOwner } from '../session/session-client-owner.js';

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * Agent-owned runtime assembly. The public Agent API (createAgent/fromConfig)
 * builds complete shipped runtimes itself: the agent client and task-tool registration factories, the runtime
 * managers, and the isolated-runtime Config for subagent runtimes. Defaults
 * are installed per-field ONLY where the Config reports absence — caller
 * supplied factories and managers always win. Nothing here registers into
 * module-global state.
 */

import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { buildAgentClientFactory } from './agentBootstrap.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Agent } from './agent.js';
import type { IsolatedRuntimeContextOptions } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { registerProvidersOntoManager } from './createAgent.js';
import type {
  AgentRuntimeFactoryBindings,
  RuntimeProviderManager,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
  ContentGenerator,
} from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';

const DEFAULT_MODEL = 'gemini-1.5-flash';
const DEFAULT_DEBUG_MODE = false;

/** Inputs for {@link buildIsolatedAgentConfig}. */
export interface IsolatedAgentConfigInputs {
  readonly sessionId: string;
  readonly workspaceDir?: string;
  readonly model?: string;
  readonly settingsService: SettingsService;
  readonly runtimeFactoryBindings?: AgentRuntimeFactoryBindings;
}

/**
 * Builds the isolated-runtime Config for agent-owned runtimes (subagents,
 * compression, role runtimes): fresh Config with the provider-factory
 * construction defaults, then agent-owned factories and runtime managers.
 */
export function buildIsolatedAgentConfig(inputs: IsolatedAgentConfigInputs): {
  config: Config;
  mediaOwner: SessionMediaOwner;
} {
  const workspaceDir = inputs.workspaceDir ?? process.cwd();
  const config = new Config({
    sessionId: inputs.sessionId,
    targetDir: workspaceDir,
    debugMode: DEFAULT_DEBUG_MODE,
    cwd: workspaceDir,
    model: inputs.model ?? DEFAULT_MODEL,
    initialSettings: inputs.settingsService.getAllGlobalSettings(),
  });
  const mediaOwner = new SessionMediaOwner(
    config.projectTempDir,
    config.getMediaStoreQuotaByteLimit(),
  );
  return { config, mediaOwner };
}

/**
 * Extra teardown context for {@link cleanupFailedRuntimeBootstrap} beyond the
 * isolated runtime handle.
 */
export interface FailedBootstrapTeardown {
  /**
   * The fully built Agent facade, when the failure happened AFTER finalize
   * (e.g. session-start). Its idempotent dispose() is the complete teardown —
   * isolated handle, agent-owned Config, hooks — and replaces piecemeal
   * cleanup.
   */
  readonly facade?: Agent;
  /**
   * The agent-owned Config to dispose when no facade exists yet. Disposed
   * AFTER the isolated handle (children before parents): initialize() started
   * MCP discovery, the extension loader, LSP and the AgentClient on it, and
   * only Config.dispose() releases those — except the LSP service, which
   * Config.dispose() does NOT stop and which cleanupFailedRuntimeBootstrap
   * shuts down explicitly after the dispose. Caller-owned Configs (fromConfig
   * adopts one) are never passed here.
   */
  readonly ownedConfig?: Config;
}

/**
 * Cleans up a failed agent bootstrap and surfaces the ORIGINAL error. When
 * cleanup also fails, every error surfaces through an AggregateError so
 * neither is swallowed.
 */
export async function cleanupFailedRuntimeBootstrap(
  closeRuntime: () => void | Promise<void>,
  primaryError: unknown,
  source: string,
  teardown: FailedBootstrapTeardown = {},
): Promise<never> {
  const cleanupErrors: unknown[] = [];
  if (teardown.facade !== undefined) {
    try {
      await teardown.facade.dispose();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
  } else {
    try {
      await closeRuntime();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (teardown.ownedConfig !== undefined) {
      try {
        await teardown.ownedConfig.dispose();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      `${source} bootstrap failed and isolated runtime cleanup also failed`,
    );
  }
  throw primaryError;
}

export const prepareIsolatedProviders: NonNullable<
  IsolatedRuntimeContextOptions['prepare']
> = (context): void => {
  registerProvidersOntoManager(
    context.providerManager,
    context.settingsService,
    context.config,
    context.oauthManager,
  );
};

export async function disposeIsolatedMediaConfig(
  config: Config,
  mediaOwner: SessionMediaOwner,
): Promise<void> {
  const results = await Promise.allSettled([
    config.dispose(),
    mediaOwner.dispose(),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Isolated media cleanup failed');
}

export async function disposeIsolatedMediaRuntime(
  closeRuntime: () => void | Promise<void>,
  closeConfig: () => Promise<void>,
  closeMedia: () => Promise<void>,
  closeClient: (() => Promise<void>) | undefined,
): Promise<void> {
  const clients = await Promise.allSettled([closeClient?.()]);
  const results = await Promise.allSettled([closeRuntime(), closeConfig()]);
  const mediaResults = await Promise.allSettled([closeMedia()]);
  const failures = [...clients, ...results, ...mediaResults].flatMap(
    (result) => (result.status === 'rejected' ? [result.reason] : []),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Isolated media runtime cleanup failed');
}

export async function createIsolatedSessionClient(
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  contentGeneratorFactory: RuntimeContentGeneratorFactory<ContentGenerator>,
  tokenizerFactory: RuntimeTokenizerFactory,
  providerFileLifecycle: ProviderFileLifecycle,
  mediaOwner: SessionMediaOwner,
  factory: AgentClientFactory = buildAgentClientFactory(),
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  messageBus?: MessageBus,
  imageOperation?: SessionImageSelection['imageOperation'],
): Promise<SessionClientOwner> {
  const client = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settings),
    providerManager,
    factory,
    mediaOwner.store,
    readInstructions,
    workspacePaths,
    settingsOwner,
    contentGeneratorFactory,
    tokenizerFactory,
    undefined,
    messageBus,
  );
  client.bindInteractiveAuthRequests((prompt) =>
    oauthManager.requestInteractiveAuth(prompt),
  );
  assembleSessionImages(
    client,
    config.getTargetDir(),
    providerManager,
    oauthManager,
    settings,
    imageOperation,
  );
  const mainScope = config.getSessionId();
  client.bindProviderFiles(
    providerFileLifecycle,
    (provider) => oauthManager.composeRetryOperations(provider),
    (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : SessionClientOwner.cleanupProviderScope(providerFileLifecycle, scope),
  );
  return client;
}

export function closeIsolatedSessionRuntime(
  closeRuntime: () => void | Promise<void>,
  closeConfig: () => Promise<void>,
  closeMedia: () => Promise<void>,
  closeClient: () => Promise<void>,
): Promise<void> {
  return disposeIsolatedMediaRuntime(
    closeRuntime,
    closeConfig,
    closeMedia,
    closeClient,
  );
}
