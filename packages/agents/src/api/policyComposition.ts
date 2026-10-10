/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { NodeFileSystem } from '@vybestack/llxprt-code-providers/composition.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { createProviderManager } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { createFileOAuthSettingsProvider } from '@vybestack/llxprt-code-providers/auth.js';
import { AgentBootstrapError } from './agentBootstrap.js';
import {
  createIsolatedRuntimeContext,
  createRuntimeActivationBindings,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import { applyRuntimeEphemerals } from './agentConfig.adapter.js';
import type { AgentConfigSchema } from './config-schema.js';
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';
import { createIsolatedSessionClient } from './agentRuntimeAssembly.js';

import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { AgentConfig } from './config-types.js';
import { injectConfirmationForcingPolicy } from './confirmationForcing.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';

export function initializePolicyComposition(
  params: ConfigParameters,
  parsed: { readonly harness?: AgentConfig['harness'] },
  forceConfirmations: boolean,
  trustPort?: AgentConfig['trustPort'],
): {
  readonly config: Config;
  readonly messageBus: MessageBus;
  readonly policyOwner: RuntimePolicyOwner;
} {
  const config = new Config({
    ...params,
    includeDirectories: [
      ...(params.includeDirectories ?? []),
      ...((parsed.harness?.includeProcessCwd ?? true) ? [process.cwd()] : []),
    ],
  });
  const policyOwner = new RuntimePolicyOwner(config, trustPort);
  // Ensure the process working directory is a valid workspace root so that
  // fixture paths using {{CWD}} resolve within the workspace boundary. The
  // harness.includeProcessCwd gate (default true) lets production callers
  // avoid mutating the workspace with process.cwd().
  // Inject a high-priority ASK policy rule that overrides the read-only.toml
  // ALLOW rules (priority 1.050) for ALL tools so the ConfirmationCoordinator
  // falls through to evaluateAndRoute — the confirmation-forcing seam. The
  // harness.forceConfirmations gate (default true) lets production callers
  // skip the policy injection.
  if (forceConfirmations) {
    injectConfirmationForcingPolicy(policyOwner.session.confirmation);
  }
  const messageBus = policyOwner.session.messageBus;
  return { config, messageBus, policyOwner };
}

export async function assembleOwnedMcpRuntime(
  config: Config,
  bus: MessageBus,
  options: Pick<
    AgentConfig,
    | 'imageOperation'
    | 'trustPort'
    | 'idePort'
    | 'memoryOwner'
    | 'mcpHost'
    | 'mcpTokenStorage'
    | 'lspOwner'
    | 'lspOwnership'
    | 'definitionOwner'
    | 'definitionOwnership'
    | 'filesystemOwner'
    | 'filesystemOwnership'
  >,
  policy: RuntimePolicyOwner,
  settingsOwner: SessionSettingsOwner,
): Promise<McpRuntimeOwner> {
  return assembleMcpRuntime(
    config,
    bus,
    options,
    policy,
    'runtime',
    settingsOwner,
  );
}

async function bindCreatedSessionClient(
  handle: IsolatedRuntimeContextHandle,
  media: SessionMediaOwner,
  factory: Parameters<typeof createIsolatedSessionClient>[2],
  mcp: McpRuntimeOwner,
  registration: Parameters<SessionClientOwner['bindMcpRuntime']>[1],
  forceConfirmations: boolean,
  imageOperation: AgentConfig['imageOperation'],
): Promise<SessionClientOwner> {
  const client = await createIsolatedSessionClient(
    handle,
    media,
    factory,
    mcp.readInstructions,
    mcp.workspacePaths,
    mcp.messageBus,
    imageOperation,
  );
  client.bindMcpRuntime(mcp, registration);
  client.bindHooks();
  if (forceConfirmations)
    injectConfirmationForcingPolicy({
      addRule: (rule) => client.addSessionPolicyRule(rule),
    });
  return client;
}

export async function createOwnedSessionRoots(
  handle: IsolatedRuntimeContextHandle,
  media: SessionMediaOwner,
  factory: Parameters<typeof createIsolatedSessionClient>[2],
  options: Pick<
    AgentConfig,
    | 'imageOperation'
    | 'trustPort'
    | 'idePort'
    | 'memoryOwner'
    | 'mcpHost'
    | 'mcpTokenStorage'
    | 'lspOwner'
    | 'lspOwnership'
    | 'definitionOwner'
    | 'definitionOwnership'
    | 'filesystemOwner'
    | 'filesystemOwnership'
  >,
  policy: RuntimePolicyOwner,
  registration: Parameters<SessionClientOwner['bindMcpRuntime']>[1],
  forceConfirmations: boolean,
): Promise<readonly [McpRuntimeOwner, SessionClientOwner]> {
  const mcp = await assembleOwnedMcpRuntime(
    handle.config,
    policy.session.messageBus,
    options,
    policy,
    handle.settingsOwner,
  );
  try {
    return [
      mcp,
      await bindCreatedSessionClient(
        handle,
        media,
        factory,
        mcp,
        registration,
        forceConfirmations,
        options.imageOperation,
      ),
    ];
  } catch (error) {
    try {
      await mcp.dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Session root creation failed',
      );
    }
    throw error;
  }
}

export async function prepareOwnedMediaRuntime(
  config: Config,
  mediaOwner: SessionMediaOwner,
  _factories: AgentRuntimeFactoryBindings | undefined,
  parsed: ReturnType<typeof AgentConfigSchema.parse>,
  runtimeId: string,
  runtimeActivationBindings: AgentConfig['runtimeActivationBindings'],
  tokenStore: AgentConfig['tokenStore'],
  messageBus: MessageBus,
  policyOwner: RuntimePolicyOwner,
  factorySelection: Pick<
    AgentConfig,
    'tokenizerFactory' | 'contentGeneratorFactory' | 'definitionOwner'
  > = {},
): Promise<IsolatedRuntimeContextHandle> {
  let settingsOwner: SessionSettingsOwner | undefined;
  try {
    // Apply typed stream-timeout AgentConfig fields as runtime Config ephemerals.
    // These drive the idle/first-response watchdogs but are not ConfigParameters
    // fields, so they are pushed after Config construction (issue #2607 Finding 2).
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    settingsOwner = new SessionSettingsOwner(settings);
    const selectedSettings = settingsOwner;
    selectedSettings.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    applyRuntimeEphemerals(
      {
        setEphemeralSetting: (key, value) =>
          selectedSettings.writeUserParameter(key, value),
      },
      parsed,
    );

    // @pseudocode createAgent.md steps 41-58
    // SHARED runtime context — adopts OUR Config/MessageBus. DO NOT pass
    // provider/apiKey/baseUrl (they are not valid options; applied via mutators
    // after activation). The prepare callback registers providers (including
    // FakeProvider under LLXPRT_FAKE_RESPONSES) onto the isolated manager.
    return createIsolatedRuntimeContext(
      {
        profileReads: factorySelection.definitionOwner?.profileReads,
        tokenizerFactory: factorySelection.tokenizerFactory,
        contentGeneratorFactory: factorySelection.contentGeneratorFactory,
        runtimeId,
        activationBindings:
          runtimeActivationBindings ?? createRuntimeActivationBindings(),
        ...(tokenStore !== undefined ? { tokenStore } : {}),
        config,
        settingsOwner,
        settingsOwnerOwnership: 'transferred',
        messageBus,
        prepare: (ctx) => {
          registerProvidersOntoManager(ctx.providerManager, ctx, ctx.config);
        },
      },
      settings,
    );
  } catch (primaryError) {
    const cleanup = await Promise.allSettled([
      Promise.resolve().then(() => settingsOwner?.dispose()),
      Promise.resolve().then(() => policyOwner.dispose()),
      Promise.resolve().then(() => config.dispose()),
      Promise.resolve().then(() => mediaOwner.dispose()),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(
        [primaryError, ...failures],
        'Agent media assembly cleanup failed',
      );
    throw primaryError;
  }
}

/**
 * Registers providers onto the isolated context's ProviderManager. Uses
 * createProviderManager (from composition) to build a fully-registered manager
 * and transfers all registered provider names + their provider instances onto
 * the isolated manager. Under LLXPRT_FAKE_RESPONSES this registers only
 * FakeProvider and sets it active.
 */
export function registerProvidersOntoManager(
  isolatedManager: IsolatedRuntimeContextHandle['providerManager'],
  source: {
    settingsService: IsolatedRuntimeContextHandle['settingsService'];
    runtimeId: IsolatedRuntimeContextHandle['runtimeId'];
    metadata: IsolatedRuntimeContextHandle['metadata'];
  },
  config: Config,
): void {
  const context = {
    settingsService: source.settingsService,
    runtimeId: source.runtimeId,
    metadata: source.metadata,
  };
  // Wire the file-backed OAuth settings provider so the provider instances
  // built here are bound to an OAuthManager that can read oauthEnabledProviders
  // (and therefore use shared-keychain OAuth tokens). Without it,
  // createProviderManager's contract leaves the OAuth manager without a
  // settings provider, so isOAuthEnabled('codex'|'anthropic'|…) always returns
  // false and OAuth-only providers report "auth required" (Issue #2410). This
  // mirrors the CLI foreground (createOAuthSettingsAdapter) and the isolated
  // runtime factory (resolveOAuthManager), staying on the providers layer to
  // preserve the agents-vs-CLI package boundary.
  if (!(isolatedManager instanceof ProviderManager))
    throw new AgentBootstrapError(
      'Owned provider registration requires its concrete manager',
    );
  createProviderManager(
    context as Parameters<typeof createProviderManager>[0],
    {
      fileSystem: new NodeFileSystem(),
      manager: isolatedManager,
      config,
      oauthSettings: createFileOAuthSettingsProvider(),
      activateConfiguredProvider: false,
    },
  );
}
