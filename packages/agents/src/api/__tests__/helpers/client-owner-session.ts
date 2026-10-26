/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createRuntimeContentGeneratorFactory } from '@vybestack/llxprt-code-providers/composition.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { buildAgentClientFactory } from '../../agentBootstrap.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../config-types.js';
import { openProductionClientOwner } from './production-client-owner.js';
import { ownerClients } from './session-client-capture.js';

export interface ClientOwnerOptions {
  /**
   * Builds the session settings owner over the session settings service.
   * Defaults to `new SessionSettingsOwner(settings)`; a subclass can record
   * what the production owner hands out.
   */
  readonly createSettingsOwner?: (
    settings: SettingsService,
  ) => SessionSettingsOwner;
  /**
   * The content generator factory the owner is created with. Defaults to
   * `createRuntimeContentGeneratorFactory()`, which production passes unless
   * the host supplies `AgentConfig.contentGeneratorFactory`.
   */
  readonly contentGeneratorFactory?: AgentConfig['contentGeneratorFactory'];
}

export interface OpenedClientOwner {
  readonly owner: SessionClientOwner;
  /** The Config the owner was built over; the test reads its session identity and storage paths. */
  readonly config: Config;
  readonly client: AgentClientContract;
  readonly close: () => Promise<void>;
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
  const { owner, config, closeResources } = await openProductionClientOwner({
    authority,
    selection,
    activation,
    providerContributions: undefined,
    clientFactory: buildAgentClientFactory(),
    contentGeneratorFactory:
      options.contentGeneratorFactory ?? createRuntimeContentGeneratorFactory(),
    createSettingsOwner: options.createSettingsOwner,
  });
  const close = (): Promise<void> =>
    runCleanupSteps([() => owner.dispose(), closeResources]);
  try {
    const clients = ownerClients(owner);
    const client = clients[clients.length - 1];
    await client.startChat();
    return { owner, config, client, close };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}
