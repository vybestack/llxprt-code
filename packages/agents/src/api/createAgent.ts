/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  assembleModelSelection,
  type ModelSelectionOperations,
} from './model-selection.js';

import type { McpAssemblyOptions } from './mcpOAuthAssembly.js';
import { PreferredAgentAssembly } from './agentRuntimeAssembly.js';
import type { AgentRetainedProviderFile } from './provider-file-domain.js';

import type { SessionClientOwner } from '../session/session-client-owner.js';

import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @pseudocode createAgent.md steps 10-176
 */

import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

import type { RuntimeKind } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  SessionSettingsOwner,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';

import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  captureSettingsSnapshot,
  type SettingsStateSnapshot,
  type SettingsService,
} from '@vybestack/llxprt-code-settings';
import type { AgentConfig, ProviderActivationIntent } from './config-types.js';
import type { AgentAuth } from './config-types.js';
import type { Agent } from './agent.js';
import type { AgentConfigSchema } from './config-schema.js';
import { toConfigParameters } from './agentConfig.adapter.js';

import { assembleProviderSwitch } from './providerSwitchAssembly.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import { executeProviderActivation } from './providerActivationExecutor.js';
import { PLACEHOLDER_MODEL } from './constants.js';
import { AgentBootstrapError } from './agentBootstrap.js';

/**
 * Builds a ready Agent by composing shipped primitives through a shared runtime
 * context with a single shared MessageBus.
 * @pseudocode createAgent.md steps 10-176
 */
import type { assembleHostGitHubBroker } from './host-github-broker-owner.js';

export function createAgent(rawConfig: AgentConfig): Promise<Agent> {
  return createAgentWithRetainedProviderFiles(rawConfig, []);
}

export async function createAgentWithRetainedProviderFiles(
  rawConfig: AgentConfig,
  retainedFiles: readonly AgentRetainedProviderFile[],
): Promise<Agent> {
  return new PreferredAgentAssembly(
    rawConfig,
    retainedFiles,
    undefined,
  ).assemble();
}

export async function createAgentFromSettingsSnapshot(
  rawConfig: AgentConfig,
  snapshot: SettingsStateSnapshot,
): Promise<Agent> {
  const captured = captureSettingsSnapshot(snapshot);
  const provider = snapshotSelection(
    captured.global.activeProvider,
    rawConfig.provider,
  );
  const model = snapshotSelection(
    captured.providers[provider]?.model,
    rawConfig.model,
  );
  const selected = captureSettingsSnapshot({
    ...captured,
    global: { ...captured.global, activeProvider: provider },
    providers: {
      ...captured.providers,
      [provider]: { ...captured.providers[provider], model },
    },
  });
  return new PreferredAgentAssembly(
    { ...rawConfig, provider, model },
    [],
    selected,
  ).assemble();
}

function snapshotSelection(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : fallback;
}

export type CreatedAgentMcpOptions = McpAssemblyOptions &
  Pick<AgentConfig, 'imageOperation' | 'credentialAuthority'>;

export async function initializeCreatedClient(
  client: SessionClientOwner,
  github: ReturnType<typeof assembleHostGitHubBroker>,
): Promise<void> {
  client.bindHostGitHub(github);
  await client.initializeTools();
}

export async function activateCreatedSession(
  parsed: Parameters<typeof applyActivation>[0],
  resolvedAuth: Parameters<typeof applyActivation>[1],
  config: Config,
  settings: SettingsService,
  settingsOwner: SessionSettingsOwner,
  providerManager: RuntimeProviderManager,
  oauthManager: OAuthManager,
  readRuntimeKind: () => RuntimeKind,
  messageBus: MessageBus,
  mcpRuntime: McpRuntimeOwner,
  client: SessionClientOwner,
): ReturnType<typeof applyActivation> {
  return applyActivation(
    parsed,
    resolvedAuth,
    config,
    messageBus,
    assembleProviderSwitch(
      config,
      settings,
      providerManager,
      oauthManager,
      readRuntimeKind,
      client.operations.refreshAuth,
      settingsOwner,
    ),
    settings,
    mcpRuntime,
    providerManager,
    (method) => client.refreshAuth(method),
    assembleModelSelection(settingsOwner),
    () => settingsOwner.readSelectedProvider(),
  );
}

export async function startAgentSession(agent: Agent): Promise<Agent> {
  try {
    await agent.hooks.triggerSessionStart();
    return agent;
  } catch (primaryError) {
    try {
      await agent.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'Agent SessionStart and cleanup failed',
      );
    }
    throw primaryError;
  }
}

/**
 * Builds the shared holders + ONE stable forwarding DisplayCallbacks object.
 * The stable object reads live from the holders so post-construction
 * setDisplayCallbacks/setEditorCallbacks are observable by the CURRENT loop.
 */

/**
 * Finalizes the agent after the runtime context is active and authenticated.
 * Builds the runtime state, binds the post-auth client, constructs the initial
 * loop, records ownership, builds the facade, and fires the SessionStart hook.
 * Exported so {@link fromConfig} reuses the SAME finalize path (CRIT-4:
 * single source of finalize — no parallel copy).
 * @pseudocode createAgent.md steps 105-166
 */

export function prepareAgentConfig(
  parsed: ReturnType<typeof AgentConfigSchema.parse>,
  runtimeId: string,
): {
  readonly params: ConfigParameters;
  readonly forceConfirmations: boolean;
} {
  const params = {
    ...toConfigParameters(parsed as unknown as AgentConfig),
    sessionId: runtimeId,
  };
  return { params, forceConfirmations: applyHarnessGates(parsed, params) };
}

function applyHarnessGates(
  parsed: { readonly harness?: AgentConfig['harness'] },
  params: { interactive?: boolean },
): boolean {
  const forceInteractive = parsed.harness?.forceInteractive ?? true;
  if (forceInteractive) {
    params.interactive = true;
  }
  return (
    (parsed.harness?.forceConfirmations ?? true) && params.interactive === true
  );
}

/**
 * Constructs the Config, applies workspace-context + confirmation-forcing
 * policy gates, and builds the shared MessageBus. Extracted from createAgent
 * to stay within the per-function line budget.
 *
 * @plan:PLAN-20260617-COREAPI.P17 @requirement:REQ-006
 * @pseudocode createAgent.md steps 30-38 + tool-confirmation-merge.md steps 10-31
 */

/** Applies the explicit or synthesized intent and returns the activated state. */
async function applyActivation(
  parsed: {
    readonly activation?: ProviderActivationIntent;
    readonly auth?: AgentAuth;
    readonly provider: string;
    readonly model: string;
  },
  resolvedAuth: {
    readonly apiKey: string | undefined;
    readonly baseUrl: string | undefined;
    readonly authMethod: string | undefined;
  },
  config: Config,
  messageBus: MessageBus,
  switchProvider: ProviderSwitcher,
  settingsService: SettingsService,
  mcpRuntime: McpRuntimeOwner,
  manager: RuntimeProviderManager,
  refreshClient: (method?: string) => Promise<void>,
  selection: ModelSelectionOperations,
  readProviderName: () => string | undefined,
): Promise<{ readonly provider: string; readonly model: string }> {
  const intent: ProviderActivationIntent = parsed.activation ?? {
    provider: parsed.provider,
    providerSwitchPolicy: 'best-effort',
    ...(parsed.model.trim() && parsed.model !== PLACEHOLDER_MODEL
      ? { model: parsed.model }
      : {}),
    authMethod: resolvedAuth.authMethod,
    cliOverrides: {
      key: resolvedAuth.apiKey,
      keyfile: parsed.auth?.apiKeyFile,
      keyName: parsed.auth?.keyName,
      baseUrl: resolvedAuth.baseUrl,
    },
  };
  mcpRuntime.assertConfig(config, messageBus);
  await mcpRuntime.initialize();
  const activationResult = await executeProviderActivation(
    config,
    intent,
    switchProvider,
    settingsService,
    manager,
    refreshClient,
    selection,
  );
  if (activationResult.authFailed) {
    const underlying = activationResult.authError;
    throw new AgentBootstrapError(
      `createAgent activation failed: ${
        underlying instanceof Error ? underlying.message : String(underlying)
      }`,
      { cause: underlying },
    );
  }
  // Explicit intents report the activated provider; legacy inputs retain their
  // public provider label when fake responses or an unconfigured start are used.
  const runtimeProvider =
    activationResult.activeProvider ??
    manager.getActiveProviderName() ??
    readProviderName() ??
    '';
  const postProvider =
    parsed.activation === undefined
      ? parsed.provider
      : runtimeProvider || parsed.provider;
  // Filter out the placeholder-model sentinel — switchActiveProvider sets the
  // active model to that placeholder while auth initializes, but the
  // externally observable provider/model snapshot should reflect the REAL
  // model once activation resolves (#2374).
  const configModel = config.getModel();
  const resolvedConfigModel =
    configModel !== PLACEHOLDER_MODEL ? configModel : '';

  const activeModel = safeActiveModelName(selection);
  const runtimeModel = resolvedConfigModel || activeModel;
  const postModel = runtimeModel || parsed.model;
  return { provider: postProvider, model: postModel };
}

/** Reads the active model name without throwing when unset. */
function safeActiveModelName(selection: ModelSelectionOperations): string {
  try {
    return selection.readModel() ?? '';
  } catch {
    return '';
  }
}

export async function cleanupFailedCreatedAgent(
  primaryError: unknown,
  closeRuntime: () => void | Promise<void>,
  config: Config,
  mediaOwner: SessionMediaOwner,
  sessionClient: SessionClientOwner | undefined,
  disposeMcpRuntime: (() => Promise<void>) | undefined,
): Promise<never> {
  const mcpCleanup = await Promise.allSettled([disposeMcpRuntime?.()]);
  const clientCleanup = await Promise.allSettled([sessionClient?.dispose()]);
  const cleanup = await Promise.allSettled([closeRuntime(), config.dispose()]);
  const mediaCleanup = await Promise.allSettled([mediaOwner.dispose()]);
  const failures = [
    ...mcpCleanup,
    ...clientCleanup,
    ...cleanup,
    ...mediaCleanup,
  ].flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (failures.length > 0) {
    throw new AggregateError(
      [primaryError, ...failures],
      'createAgent bootstrap cleanup failed',
    );
  }
  throw primaryError;
}

export { registerProvidersOntoManager } from './policyComposition.js';
