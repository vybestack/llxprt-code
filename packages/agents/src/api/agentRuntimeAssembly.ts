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
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { buildAgentClientFactory } from './agentBootstrap.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { Agent } from './agent.js';
import type { IsolatedRuntimeContextOptions } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { registerProvidersOntoManager } from './createAgent.js';
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';

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
  handle: IsolatedRuntimeContextHandle,
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
      await handle.cleanup();
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
    context,
    context.config,
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
  handle: IsolatedRuntimeContextHandle,
  mediaOwner: SessionMediaOwner,
  sessionClient: SessionClientOwner | undefined,
): Promise<void> {
  const clients = await Promise.allSettled([sessionClient?.dispose()]);
  const results = await Promise.allSettled([
    handle.cleanup(),
    handle.config.dispose(),
  ]);
  const mediaResults = await Promise.allSettled([mediaOwner.dispose()]);
  const failures = [...clients, ...results, ...mediaResults].flatMap(
    (result) => (result.status === 'rejected' ? [result.reason] : []),
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'Isolated media runtime cleanup failed');
}

export async function createIsolatedSessionClient(
  handle: IsolatedRuntimeContextHandle,
  mediaOwner: SessionMediaOwner,
  factory: AgentClientFactory = buildAgentClientFactory(),
  readInstructions: () => string | undefined,
  workspacePaths: WorkspacePathOperations,
  messageBus?: MessageBus,
  imageOperation?: SessionImageSelection['imageOperation'],
): Promise<SessionClientOwner> {
  const client = await SessionClientOwner.create(
    handle.config,
    assembleTaskSchemaPolicy(handle.settingsService),
    handle.providerManager,
    factory,
    mediaOwner.store,
    readInstructions,
    workspacePaths,
    handle.settingsOwner,
    handle.contentGeneratorFactory,
    handle.tokenizerFactory,
    undefined,
    messageBus,
  );
  assembleSessionImages(
    client,
    handle.config.getTargetDir(),
    handle.providerManager,
    handle.oauthManager,
    handle.settingsService,
    imageOperation,
  );
  const mainScope = handle.config.getSessionId();
  client.bindProviderFiles(
    handle.providerFileLifecycle,
    (provider) => handle.oauthManager.composeRetryOperations(provider),
    (scope) =>
      scope === mainScope
        ? Promise.resolve()
        : SessionClientOwner.cleanupProviderScope(
            handle.providerFileLifecycle,
            scope,
          ),
  );
  return client;
}

export function closeIsolatedSessionRuntime(
  handle: IsolatedRuntimeContextHandle & {
    readonly mediaOwner: SessionMediaOwner;
    readonly sessionClient: SessionClientOwner;
  },
): Promise<void> {
  return disposeIsolatedMediaRuntime(
    handle,
    handle.mediaOwner,
    handle.sessionClient,
  );
}
