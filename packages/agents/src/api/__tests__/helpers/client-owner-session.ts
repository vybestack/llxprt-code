/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../config-types.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { assembleModelSelection } from '../../model-selection.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import {
  createCapturedSessionOwner,
  ownerClients,
} from './session-client-capture.js';

export interface ClientOwnerOptions {
  /**
   * Builds the session settings owner over the session settings service.
   * Defaults to `new SessionSettingsOwner(settings)`; a subclass can record
   * what the production owner hands out.
   */
  readonly createSettingsOwner?: (
    settings: SettingsService,
  ) => SessionSettingsOwner;
}

export interface OpenedClientOwner {
  readonly owner: SessionClientOwner;
  readonly client: AgentClientContract;
  readonly close: () => Promise<void>;
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
  readonly tokenizer: ReturnType<typeof configureProviderTokenizer>;
}

async function acquireProviderStack(
  authority: CredentialAuthority,
  selection: AgentConfig,
  options: ClientOwnerOptions,
): Promise<ProviderStack> {
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
    options.createSettingsOwner?.(settings) ??
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
    tokenizer: configureProviderTokenizer(manager),
  };
}

async function activateAndStart(
  stack: ProviderStack,
  owner: SessionClientOwner,
  activation: ProviderActivationIntent,
): Promise<AgentClientContract> {
  const { config, settings, settingsOwner, manager, oauth, mcp } = stack;
  await preparePreferredProviderCompletion(
    config,
    settings,
    settingsOwner,
    manager,
    oauth,
    stack.runtimeId,
    stack.tokenizer,
    undefined,
  );
  await mcp.initialize();
  const result = await executeProviderActivation(
    config,
    activation,
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
  const clients = ownerClients(owner);
  const client = clients[clients.length - 1];
  await client.startChat();
  return client;
}

/**
 * Builds a `SessionClientOwner` through its production `create` with the
 * collaborators production fills, activates the provider and starts the chat.
 * `client` is the last client the owner's factory returned.
 */
export async function openClientOwner(
  authority: CredentialAuthority,
  selection: AgentConfig,
  activation: ProviderActivationIntent,
  options: ClientOwnerOptions = {},
): Promise<OpenedClientOwner> {
  const stack = await acquireProviderStack(authority, selection, options);
  const { config, settings, settingsOwner, manager, oauth, mcp } = stack;
  const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
  const owner = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settings),
    manager,
    buildAgentClientFactory(),
    media.store,
    mcp.readInstructions,
    mcp.workspacePaths,
    settingsOwner,
    createRuntimeContentGeneratorFactory(),
    stack.tokenizer,
  );
  owner.bindMcpRuntime(mcp);
  owner.bindProviderFiles(stack.files, (provider) =>
    oauth.composeRetryOperations(provider),
  );
  owner.bindHooks();
  const close = (): Promise<void> =>
    runCleanupSteps([
      () => owner.dispose(),
      () => stack.release.close(),
      () => media.dispose(),
      () => mcp.dispose(),
      () => stack.policy.dispose(),
      () => config.dispose(),
    ]);
  try {
    const client = await activateAndStart(stack, owner, activation);
    return { owner, client, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
