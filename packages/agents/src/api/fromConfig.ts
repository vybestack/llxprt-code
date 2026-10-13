import { createTaskRegistration } from './runtimeFactories.js';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import { assertPreflightOwners } from './activationPreflightState.js';
import {
  cleanupFailedFromConfig,
  closePreflightAfterAdoption,
  cleanupFailedAdoption,
  cleanupFailedMediaAssembly,
} from './fromConfig-cleanup.js';
import { prepareImageConstruction } from './session-image-assembly.js';
import { finalizeAdoptedAgent } from './fromConfig-finalization.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  assembleAdoptedDefinitionOperations,
  adoptedDefinitionCleanup,
} from './adopted-definition-assembly.js';
/**
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-78
 *
 * Public config-adoption entry: builds a ready Agent by ADOPTING an
 * existing caller-supplied Config (never constructing a second one) and
 * reusing the SAME shared finalize path createAgent uses (CRIT-4).
 */

import type { SessionClientOwner } from '../session/session-client-owner.js';
import { initializeAdoptedClient } from './fromConfig-session.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  createIsolatedRuntimeContext,
  createRuntimeActivationBindings,
  type IsolatedRuntimeContextHandle,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import {
  generateRuntimeId,
  AgentBootstrapError,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import { AgentActivationBootstrap } from './activationPreflightState.js';
import { registerProvidersOntoManager } from './createAgent.js';

/**
 * Adopts an existing caller-supplied Config and returns a ready Agent.
 *
 * Mirrors createAgent's finalize path WITHOUT re-constructing a Config,
 * ProviderManager, or (when a caller bus is supplied) a MessageBus. The
 * returned Agent's dispose() skips the caller-owned Config teardown
 * (REQ-001.3).
 *
 * Provider activation / auth (#2374): when `options.activation` is supplied,
 * fromConfig executes the declarative intent via executeProviderActivation
 * INSTEAD of the legacy bare refreshAuth(undefined) call, so frontends no longer
 * need to orchestrate switchActiveProvider / refreshAuth / credential overrides
 * by hand. Callers that need to observe fatal auth failure (`authFailed`)
 * use an agents-owned activation bootstrap before calling fromConfig, then
 * supply its operation and token together with the same activation intent.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-48
 */
import {
  assembleHostGitHubBroker,
  type HostGitHubBrokerOwner,
} from './host-github-broker-owner.js';

export async function fromConfig(options: FromConfigOptions): Promise<Agent> {
  const credentialAuthority =
    options.credentialAuthority ??
    new HostCredentialOwner(process.env).authority;
  options = { ...options, credentialAuthority };
  const images = prepareImageConstruction(options.imageOperation);
  const github = assembleHostGitHubBroker(options);
  const preflight = options.activationPreflight?.operation;
  const closePreflight =
    preflight === undefined
      ? undefined
      : () => AgentActivationBootstrap.close(preflight);
  const definitions = options.definitionOwner;
  const memory = options.memoryOwner;
  let agent: Agent;
  try {
    if (!hasConfig(options, 'config')) {
      throw new AgentBootstrapError('fromConfig requires an existing Config');
    }
    assertMcpHandoff(options);
    assertPreflightOwners(options);
    if (
      options.activationPreflight !== undefined &&
      options.memoryOwner !== undefined
    )
      throw new AgentBootstrapError(
        'Preflight memory ownership cannot be replaced during adoption',
      );
    if (options.activationPreflight !== undefined) {
      AgentActivationBootstrap.validate(
        options.activationPreflight,
        options.config,
        options.activation,
        options.providerManager,
      );
    }
    agent = await adoptConfig(
      { ...options, imageOperation: images.selection },
      github,
    );
  } catch (primaryError) {
    return cleanupFailedFromConfig(
      primaryError,
      github === undefined
        ? undefined
        : () => github.cleanupFailedConstruction(),
      () => images.cleanupFailedConstruction(),
      options.definitionOwnership === 'agent' && definitions !== undefined
        ? () => definitions.dispose()
        : undefined,
      memory?.ownership === 'agent' ? () => memory.owner.dispose() : undefined,
      closePreflight,
    );
  }
  await closePreflightAfterAdoption(closePreflight, () => agent.dispose());
  return agent;
}

function bindAdoptedSessionHooks(
  client: SessionClientOwner,
  mcp: McpRuntimeOwner,
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
): void {
  client.bindHostGitHub(github);
  const definitions = assembleAdoptedDefinitionOperations(
    mcp,
    options.definitionOwner,
    options.config,
    options.definitionOwnership,
    ownsMcpRuntime(options),
  );
  client.bindMcpRuntime(
    mcp,
    options.runtimeFactoryBindings?.taskToolRegistration(
      createTaskRegistration(options.credentialAuthority),
    ) ?? createTaskRegistration(options.credentialAuthority),
    definitions.profileDefinitions,
    definitions.subagentDefinitions,
  );
  if (client.hasHookComposition()) {
    if (options.hookOwner !== undefined)
      throw new AgentBootstrapError(
        'Preflight hook ownership cannot be replaced during adoption',
      );
  } else {
    client.bindHooks(options.hookOwner);
  }
}

function validateAdoption(options: FromConfigOptions): string {
  FromConfigValidatableSchema.parse({
    sessionId: options.sessionId,
    activation: options.activation,
  });
  assertBorrowedClient(options);
  const runtimeId = options.sessionId ?? generateRuntimeId();
  validateAgentRuntimeId(runtimeId);
  return runtimeId;
}

async function adoptConfig(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
): Promise<Agent> {
  // @pseudocode lines 11-13: validate presence + the small validatable portion.
  // The FromConfigOptions type marks config as required, but at runtime callers
  // may omit it (T1d); read through a generic presence check so the lint
  // accepts the runtime-undefined check without an unsafe assertion.
  const runtimeId = validateAdoption(options);

  // Adopt an explicit caller bus first, then the Config's assembled runtime bus.
  // Only non-CLI consumers without either seam receive a newly owned bus.
  const mcp = await resolveAdoptedMcpRuntime(options);
  // @pseudocode line 18 (CRIT-1): adopt the Config's existing manager.

  // @pseudocode lines 20-28: adopt the runtime context (NOT a second manager).
  const preflight = options.activationPreflight?.operation;
  const media = await assembleAdoptedMedia(
    options.config,
    preflight?.takeMediaOwner.bind(preflight),
    options.agentClient?.mediaStore,
    preflight?.dispose.bind(preflight),
  );
  const handle = await prepareAdoptionRuntime(options, runtimeId, media, mcp);

  let sessionClient: SessionClientOwner | undefined;
  try {
    sessionClient = await initializeAdoptedClient(
      options.config,
      handle.settingsService,
      handle.settingsOwner,
      handle.providerManager,
      handle.oauthManager,
      handle.contentGeneratorFactory,
      handle.tokenizerFactory,
      handle.providerFileLifecycle,
      media,
      mcp.readInstructions,
      mcp.workspacePaths,
      options.activation,
      options.activationPreflight,
      options.runtimeFactoryBindings?.agentClientFactory,
      options.agentClient,
      adoptedClientBus(options),
      options.imageOperation,
    );
    bindAdoptedSessionHooks(sessionClient, mcp, options, github);

    // @pseudocode line 29: activate infrastructure for the supplied Config.
    await handle.activate();

    // @pseudocode line 37-48 (createAgent.ts:178-180 mirror): derive managers.

    // @plan:PLAN-20270110-ISSUE2378.P02 @requirement:REQ-2378-002
    // The adopted Config's SettingsService is carried by the isolated runtime
    // handle; every consumer below reads it from that explicit owner.

    await initializeAdoptedSession(options, mcp, sessionClient);

    // @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001

    // @pseudocode lines 37-48 (Mismatch 1): synthesize parsed + resolvedAuth.

    // @pseudocode lines 37-48: SHARED finalize (CRIT-4: single finalize path).
    // The 17th positional arg 'caller' threads REQ-001.3 ownership so dispose()
    // skips the caller-owned Config teardown.
    return await finalizeAdoptedAgent(
      options.providerManager,
      options.sessionId,
      handle.tokenizerFactory,
      options.activation,
      options.activationPreflight,
      options.config,
      handle.providerManager,
      handle.oauthManager,
      options.settingsService,
      runtimeId,
      handle.settingsOwner,
      () => handle.readRuntimeKind(),
      () => handle.cleanup(),
      options.onApproval,
      options.onOAuthPrompt,
      options.editorCallbacks,
      mcp,
      options.definitionOwner,
      options.definitionOwnership,
      ownsMcpRuntime(options),
      options.toolSchedulerFactory,
      options.asyncTaskManager,
      options.sessionIdentityOwnership ?? 'facade',
      media,
      sessionClient,
    );
  } catch (primaryError) {
    return cleanupFailedAdoption(
      primaryError,
      () => handle.cleanup(),
      adoptedDefinitionCleanup(
        mcp,
        options.definitionOwner,
        options.definitionOwnership,
        ownsMcpRuntime(options),
      ),
      media === undefined ? undefined : () => media.dispose(),
      sessionClient?.dispose.bind(sessionClient),
    );
  }
}

async function createAdoptedRuntime(
  config: Config,
  messageBus: MessageBus,
  runtimeId: string,
  adoptedManager: RuntimeProviderManager | undefined,
  settingsService: FromConfigOptions['settingsService'],
  borrowedSettingsOwner: SessionSettingsOwner | undefined,
  takeSettingsOwner:
    | ((settings: FromConfigOptions['settingsService']) => SessionSettingsOwner)
    | undefined,
  settingsOwnership: 'borrowed' | 'transferred' | undefined,
  credentialAuthority: FromConfigOptions['credentialAuthority'],
  activationBindings: FromConfigOptions['runtimeActivationBindings'],
  tokenStore: FromConfigOptions['tokenStore'],
  profileReads:
    | NonNullable<FromConfigOptions['definitionOwner']>['profileReads']
    | undefined,
  tokenizerFactory: FromConfigOptions['tokenizerFactory'],
  contentGeneratorFactory: FromConfigOptions['contentGeneratorFactory'],
  oauthManager: FromConfigOptions['oauthManager'],
  providerFileLifecycle: FromConfigOptions['providerFileLifecycle'],
): Promise<IsolatedRuntimeContextHandle> {
  const transferredOwner = takeSettingsOwner?.(settingsService);
  const settingsOwner = transferredOwner ?? borrowedSettingsOwner;
  settingsOwner?.assertSettingsIdentity(settingsService);
  try {
    return createIsolatedRuntimeContext(
      {
        runtimeId,
        credentialAuthority,
        activationBindings:
          activationBindings ?? createRuntimeActivationBindings(),
        ...(tokenStore !== undefined ? { tokenStore } : {}),
        config,
        profileReads,
        tokenizerFactory,
        contentGeneratorFactory,
        settingsOwner,
        settingsOwnerOwnership:
          transferredOwner === undefined ? 'borrowed' : settingsOwnership,
        messageBus,
        providerManager: adoptedManager,
        oauthManager,
        providerFileLifecycle,
        prepare: (ctx) => {
          if (adoptedManager === undefined)
            registerProvidersOntoManager(
              ctx.providerManager,
              ctx.settingsService,
              ctx.config,
              ctx.oauthManager,
            );
        },
      },
      settingsService,
    );
  } catch (error: unknown) {
    if (settingsOwnership === 'transferred') await transferredOwner?.dispose();
    throw error;
  }
}

async function initializeAdoptedSession(
  options: FromConfigOptions,
  mcpRuntime: McpRuntimeOwner,
  activeSessionClient: SessionClientOwner,
): Promise<void> {
  const config = options.config;
  await initializeAdoptedConfig(config, mcpRuntime, () =>
    activeSessionClient.publishTools(),
  );
  await activeSessionClient.initializeTools();
  if (options.prepareSessionTools)
    activeSessionClient.toolCatalog.prepareTools((tools) =>
      options.prepareSessionTools?.(
        config,
        activeSessionClient.messageBus,
        tools,
      ),
    );
}

async function initializeAdoptedConfig(
  config: Config,
  mcpRuntime: McpRuntimeOwner,
  _publishTools: () => Promise<void>,
): Promise<void> {
  await mcpRuntime.initialize();
}

/**
 * Finding 3 (#2378): adopt the EXACT assembled OAuthManager from the Config's
 * runtime bundle when available. Falls back to the isolated-runtime handle's
 * OAuthManager when no Config-associated runtime bundle was attached (e.g. Zed).
 */

/**
 * Executes the declarative activation intent (or backward-compatible bare
 * refreshAuth) against the adopted Config. When a preflight token is supplied,
 * consumes it with exact-match intent binding instead of re-running activation.
 * A declarative intent whose auth sequence failed is FATAL.
 *
 * @plan:PLAN-20270104-ISSUE2374.P03 @requirement:REQ-001
 */
/**
 * Derive the provider from the post-activation runtime truth, falling back to
 * the Config only when the adopted manager has no active provider.
 */
/**
 * Type guard: does the options object carry a non-null Config? The
 * FromConfigOptions type marks config as required, but at runtime a caller
 * may omit it (T1d). Reading via a generic value lookup satisfies the
 * no-unnecessary-condition lint without an unsafe assertion.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 */
function hasConfig<K extends string>(
  obj: { readonly [P in K]?: unknown } | null | undefined,
  key: K,
): boolean {
  if (obj === null || typeof obj !== 'object') {
    return false;
  }
  const v: unknown = obj[key];
  return v !== null && v !== undefined;
}

function ownsMcpRuntime(options: FromConfigOptions): boolean {
  return (
    (options.mcpOwnership ??
      (options.mcpRuntime === undefined ? 'agent' : 'caller')) === 'agent'
  );
}

/**
 * Public readiness signal for workspace infrastructure initialization.
 *
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001
 * @pseudocode lines 73-75
 */
export function isConfigInitialized(config: Config): boolean {
  return config.hasInitializationStarted();
}

function assertMcpHandoff(options: {
  readonly mcpRuntime?: McpRuntimeOwner;
  readonly mcpOwnership?: 'agent' | 'caller';
  readonly mcpHost?: unknown;
  readonly mcpTokenStorage?: unknown;
}): void {
  if (options.mcpOwnership === 'caller' && options.mcpRuntime === undefined) {
    throw new AgentBootstrapError(
      'Caller-owned MCP requires an explicit runtime handoff',
    );
  }
  if (
    options.mcpRuntime !== undefined &&
    (options.mcpHost !== undefined || options.mcpTokenStorage !== undefined)
  ) {
    throw new AgentBootstrapError(
      'MCP runtime handoff must retain its credential and browser capabilities',
    );
  }
}

async function assembleAdoptedMedia(
  config: Config,
  takeMediaOwner:
    | ((config: Config) => SessionMediaOwner | undefined)
    | undefined,
  clientMedia: LocalMediaStore | undefined,
  closePreflight: (() => void | Promise<void>) | undefined,
): Promise<SessionMediaOwner | undefined> {
  const owner =
    takeMediaOwner?.(config) ??
    (clientMedia === undefined
      ? new SessionMediaOwner(
          config.projectTempDir,
          config.getMediaStoreQuotaByteLimit(),
        )
      : undefined);
  try {
    const store = clientMedia ?? owner?.store;
    if (store === undefined)
      throw new AgentBootstrapError('Missing explicit media owner');
    return owner;
  } catch (error) {
    return cleanupFailedMediaAssembly(
      error,
      closePreflight,
      owner === undefined ? undefined : () => owner.dispose(),
      undefined,
    );
  }
}

async function prepareAdoptionRuntime(
  options: FromConfigOptions,
  runtimeId: string,
  owner: SessionMediaOwner | undefined,
  mcp: McpRuntimeOwner,
): Promise<IsolatedRuntimeContextHandle> {
  try {
    return await createAdoptedRuntime(
      options.config,
      options.messageBus ??
        options.activationPreflight?.operation.messageBus ??
        mcp.messageBus,
      runtimeId,
      options.providerManager,
      options.settingsService,
      options.settingsOwner,
      options.activationPreflight?.operation.takeSettingsOwner.bind(
        options.activationPreflight.operation,
      ),
      options.activationPreflight?.operation.settingsOwnerOwnership,
      options.credentialAuthority,
      options.runtimeActivationBindings,
      options.tokenStore,
      options.definitionOwner?.profileReads ??
        options.activationPreflight?.operation.workspaceDefinitions
          .profileReads ??
        options.mcpRuntime?.profileDefinitions,
      options.tokenizerFactory ??
        options.activationPreflight?.operation.tokenizerFactory,
      options.contentGeneratorFactory ??
        options.activationPreflight?.operation.contentGeneratorFactory,
      options.oauthManager ??
        options.activationPreflight?.operation.oauthManager,
      options.providerFileLifecycle ??
        options.activationPreflight?.operation.providerFileLifecycle,
    );
  } catch (error) {
    const preflight = options.activationPreflight?.operation;
    return cleanupFailedMediaAssembly(
      error,
      preflight?.dispose.bind(preflight),
      owner === undefined ? undefined : () => owner.dispose(),
      ownsMcpRuntime(options) ? () => mcp.dispose() : undefined,
    );
  }
}

function assertBorrowedClient(options: FromConfigOptions): void {
  if (options.agentClient === undefined) return;
  if (options.mcpRuntime === undefined)
    throw new AgentBootstrapError(
      'Borrowed session client requires an explicit MCP runtime handoff',
    );
  options.agentClient.assertConfig(options.config);
  if (options.providerManager === undefined)
    throw new AgentBootstrapError(
      'Initialized Config adoption requires an explicit providerManager owner',
    );
  options.agentClient.assertProviderManager(options.providerManager);
  const preflight = options.activationPreflight?.operation.sessionClient;
  if (
    preflight !== undefined &&
    preflight.getAgentClient() !== options.agentClient
  )
    throw new AgentBootstrapError(
      'Borrowed client differs from the preflight session client',
    );
}

async function resolveAdoptedMcpRuntime(
  options: FromConfigOptions,
): Promise<McpRuntimeOwner> {
  if (
    options.mcpRuntime !== undefined &&
    [
      options.lspOwner,
      options.lspOwnership,
      options.filesystemOwner,
      options.filesystemOwnership,
      options.memoryOwner,
    ].some((value) => value !== undefined)
  )
    throw new AgentBootstrapError(
      'An existing MCP handoff already owns its LSP lifetime',
    );
  if (options.lspOwnership === 'caller' && options.lspOwner === undefined)
    throw new AgentBootstrapError(
      'Caller-owned LSP requires an explicit workspace root',
    );
  const mcp =
    options.mcpRuntime ??
    (await assembleMcpRuntime(
      options.config,
      options.messageBus ?? options.activationPreflight?.operation.messageBus,
      {
        ...options,
        trustPort:
          options.trustPort ??
          options.activationPreflight?.operation.workspaceTrust,
        trustCleanup: options.activationPreflight?.operation.trustCleanup,
        memoryOwner:
          options.memoryOwner ??
          (options.activationPreflight === undefined
            ? undefined
            : {
                owner: options.activationPreflight.operation.workspaceMemory,
                ownership:
                  options.activationPreflight.operation
                    .workspaceMemoryOwnership === 'transferred'
                    ? 'agent'
                    : 'caller',
              }),
        definitionOwner:
          options.definitionOwner ??
          options.activationPreflight?.operation.workspaceDefinitions,
        definitionOwnership:
          options.definitionOwnership ??
          (options.activationPreflight ? 'agent' : undefined),
        filesystemOwner:
          options.filesystemOwner ??
          options.activationPreflight?.operation.workspaceFilesystem,
        filesystemOwnership:
          options.filesystemOwnership ??
          (options.activationPreflight ? 'agent' : undefined),
      },
      options.policyOwner,
      options.policyOwner === undefined ? 'runtime' : 'caller',
      options.settingsOwner,
    ));
  assertAdoptedMcpConfig(options, mcp);
  return mcp;
}

function assertAdoptedMcpConfig(
  options: FromConfigOptions,
  mcp: McpRuntimeOwner,
): void {
  mcp.assertConfig(
    options.config,
    options.messageBus ??
      options.activationPreflight?.operation.messageBus ??
      mcp.messageBus,
  );
}

function adoptedClientBus(options: FromConfigOptions): MessageBus | undefined {
  return options.policyOwner === undefined && options.mcpRuntime !== undefined
    ? undefined
    : options.messageBus;
}
