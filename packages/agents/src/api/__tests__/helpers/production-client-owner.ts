/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientFactory } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  type createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import { createCapturedSessionOwner } from './session-client-capture.js';

export type ProviderTokenizer = ReturnType<typeof configureProviderTokenizer>;

/**
 * The production-constructor inputs a `SessionClientOwner` host chooses; every
 * other collaborator is the one production builds.
 */
export interface ProductionClientOwnerInputs {
  readonly authority: CredentialAuthority;
  /** The public config the session `Config` and the MCP runtime are built from. */
  readonly selection: AgentConfig;
  /** The provider activation the owner runs once assembled. */
  readonly activation: ProviderActivationIntent;
  /** Contributed providers registered onto the manager; `undefined` for built-ins only. */
  readonly providerContributions: ProviderContributionRegistry | undefined;
  /** The owner's client factory (production's `buildAgentClientFactory()` or a wrapper over it). */
  readonly clientFactory: AgentClientFactory;
  /**
   * The content generator factory the owner is created with; production
   * passes `createRuntimeContentGeneratorFactory()` unless the host supplies
   * `AgentConfig.contentGeneratorFactory`.
   */
  readonly contentGeneratorFactory: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;
  /** Replaces the tokenizer the owner and provider manager are given; defaults to production's. */
  readonly tokenizer?: (base: ProviderTokenizer) => ProviderTokenizer;
  /**
   * Builds the session settings owner over the session settings service.
   * Defaults to `new SessionSettingsOwner(settings)`.
   */
  readonly createSettingsOwner?: (
    settings: SettingsService,
  ) => SessionSettingsOwner;
}

export interface ProductionClientOwner {
  readonly owner: SessionClientOwner;
  /** The Config the owner was built over; the test reads its session identity and storage paths. */
  readonly config: Config;
  readonly settingsOwner: SessionSettingsOwner;
  /** Releases everything the assembly acquired except the owner. */
  readonly closeResources: () => Promise<void>;
}

interface ProviderStack {
  readonly config: Config;
  readonly settings: SettingsService;
  readonly settingsOwner: SessionSettingsOwner;
  readonly policy: RuntimePolicyOwner;
  readonly mcp: McpRuntimeOwner;
  readonly runtimeId: string;
  readonly release: AcquisitionRelease;
  readonly files: ProviderFileLifecycle;
  readonly manager: ReturnType<typeof acquirePreferredProviderManager>;
  readonly oauth: ReturnType<typeof acquirePreferredOAuth>;
  readonly tokenizer: ProviderTokenizer;
}

async function acquireProviderStack(
  inputs: ProductionClientOwnerInputs,
): Promise<ProviderStack> {
  const { authority, selection } = inputs;
  const config = new Config(
    toConfigParameters({ sessionId: randomUUID(), ...selection }),
  );
  const settings = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settings.set(key, value);
  const policy = new RuntimePolicyOwner(config);
  injectConfirmationForcingPolicy(policy.session.confirmation);
  const mcp = await buildTestMcpRuntime(
    config,
    policy.session.messageBus,
    selection,
    undefined,
    policy,
  );
  const runtimeId = 'client-owner-' + randomUUID();
  const release = new AcquisitionRelease();
  const settingsOwner =
    inputs.createSettingsOwner?.(settings) ??
    new SessionSettingsOwner(settings);
  release.acquire('settings', () => settingsOwner.dispose());
  settingsOwner.initializeProviderSelection(
    config.getProvider(),
    config.getModel(),
  );
  settingsOwner.bindTelemetry(config);
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  for (const scope of [runtimeId, config.getSessionId()])
    release.acquire('files', () => releaseAdoptedFileScope(files, scope));
  const manager = acquirePreferredProviderManager(
    config,
    settings,
    settingsOwner,
    files,
    runtimeId,
    authority,
    release,
  );
  const oauth = acquirePreferredOAuth(
    undefined,
    policy.session.messageBus,
    config,
    settings,
    manager,
    runtimeId,
    mcp.profileDefinitions,
    authority,
    release,
    undefined,
  );
  const base = configureProviderTokenizer(manager);
  return {
    config,
    settings,
    settingsOwner,
    policy,
    mcp,
    runtimeId,
    release,
    files,
    manager,
    oauth,
    tokenizer: inputs.tokenizer?.(base) ?? base,
  };
}

async function activateProvider(
  stack: ProviderStack,
  owner: SessionClientOwner,
  inputs: ProductionClientOwnerInputs,
): Promise<void> {
  const { config, settings, settingsOwner, manager, oauth, mcp } = stack;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    stack.runtimeId,
    stack.tokenizer,
    inputs.providerContributions,
  );
  await mcp.initialize();
  const result = await executeProviderActivation(
    config,
    inputs.activation,
    assembleProviderSwitch(
      config,
      settings,
      manager,
      oauth,
      () => 'agent',
      () => owner.refreshAuth(),
      settingsOwner,
    ),
    settings,
    manager,
    (method) => owner.refreshAuth(method),
    assembleModelSelection(settingsOwner),
  );
  if (result.authFailed) throw result.authError;
  await owner.initializeTools();
}

/**
 * Builds a `SessionClientOwner` through its production `create` with the
 * collaborators production fills (Config, settings, policy, MCP runtime,
 * provider files, provider manager, OAuth, tokenizer, media store), binds the
 * MCP runtime, provider files and hooks, and runs the provider activation.
 * Subject-specific adapters decide what the owner then does (start the chat,
 * observe the clients its factory returns).
 */
export async function openProductionClientOwner(
  inputs: ProductionClientOwnerInputs,
): Promise<ProductionClientOwner> {
  const stack = await acquireProviderStack(inputs);
  const { config, settings, mcp, manager } = stack;
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    inputs.clientFactory,
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    stack.settingsOwner,
    inputs.contentGeneratorFactory,
    stack.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.bindProviderFiles(stack.files, (provider) =>
    stack.oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const closeResources = (): Promise<void> =>
    runCleanupSteps([
      () => stack.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => stack.policy.dispose(),
      () => config.dispose(),
    ]);
  try {
    await activateProvider(stack, owner, inputs);
  } catch (primary) {
    return cleanupAfterFailure(primary, () =>
      runCleanupSteps([() => owner.dispose(), closeResources]),
    );
  }
  return {
    owner,
    config,
    settingsOwner: stack.settingsOwner,
    closeResources,
  };
}
