import { assembleAdoptedAgent } from './agentRuntimeAssembly.js';
import { HostCredentialOwner } from '@vybestack/llxprt-code-providers/auth.js';
import { assertPreflightOwners } from './activationPreflightState.js';
import {
  cleanupFailedFromConfig,
  closePreflightAfterAdoption,
  cleanupFailedMediaAssembly,
} from './fromConfig-cleanup.js';
import { prepareImageConstruction } from './session-image-assembly.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
/**
 * @plan:PLAN-20260621-COREAPIREMED.P09
 * @requirement:REQ-001,REQ-005,REQ-INT-001
 * @pseudocode lines 10-78
 *
 * Public config-adoption entry: builds a ready Agent by ADOPTING an
 * existing caller-supplied Config (never constructing a second one) and
 * reusing the SAME shared finalize path createAgent uses (CRIT-4).
 */

import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { McpRuntimeOwner } from './mcpRuntimeAssembly.js';
import { assembleMcpRuntime } from './mcpOAuthAssembly.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { FromConfigOptions } from './config-types.js';
import { FromConfigValidatableSchema } from './config-types.js';
import type { Agent } from './agent.js';
import {
  generateRuntimeId,
  AgentBootstrapError,
  validateAgentRuntimeId,
} from './agentBootstrap.js';
import { AgentActivationBootstrap } from './activationPreflightState.js';

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
        options.settingsService,
      );
    }
    const messageBus = resolveAdoptionMessageBus(
      options.messageBus,
      options.activationPreflight?.operation.messageBus,
      options.mcpRuntime?.messageBus,
      options.policyOwner?.session.messageBus,
    );
    const runtimeId = validateAdoption(options, messageBus);
    agent = await adoptConfig(
      { ...options, messageBus, imageOperation: images.selection },
      github,
      runtimeId,
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

function resolveAdoptionMessageBus(
  callerBus: MessageBus | undefined,
  preflightBus: MessageBus | undefined,
  mcpBus: MessageBus | undefined,
  policyBus: MessageBus | undefined,
): MessageBus | undefined {
  return callerBus ?? preflightBus ?? mcpBus ?? policyBus;
}

function validateAdoption(
  options: FromConfigOptions,
  messageBus: MessageBus | undefined,
): string {
  FromConfigValidatableSchema.parse({
    sessionId: options.sessionId,
    activation: options.activation,
  });
  assertBorrowedClient(options);
  const runtimeId = options.sessionId ?? generateRuntimeId();
  validateAgentRuntimeId(runtimeId);
  options.settingsOwner?.assertSettingsIdentity(options.settingsService);
  if (options.mcpRuntime !== undefined)
    assertAdoptedMcpConfig(options, options.mcpRuntime);
  const oauth =
    options.oauthManager ?? options.activationPreflight?.operation.oauthManager;
  if (
    oauth?.runtimeMessageBus !== undefined &&
    messageBus !== undefined &&
    oauth.runtimeMessageBus !== messageBus
  )
    throw new AgentBootstrapError(
      'Borrowed OAuth must retain its selected runtime message bus',
    );
  return runtimeId;
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
  messageBus: MessageBus | undefined,
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
      messageBus,
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

async function adoptConfig(
  options: FromConfigOptions,
  github: HostGitHubBrokerOwner | undefined,
  runtimeId: string,
): Promise<Agent> {
  const mcp = await resolveAdoptedMcpRuntime(options, options.messageBus);
  const preflight = options.activationPreflight?.operation;
  const media = await assembleAdoptedMedia(
    options.config,
    preflight?.takeMediaOwner.bind(preflight),
    options.agentClient?.mediaStore,
    preflight?.dispose.bind(preflight),
  );
  return assembleAdoptedAgent(options, github, runtimeId, mcp, media);
}
