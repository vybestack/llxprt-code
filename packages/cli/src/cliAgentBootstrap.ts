/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Agent,
  AgentProfilePreflight,
  type AgentForegroundHost,
  type ActivationPreflightToken,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createGitHubBrokerClient } from './config/githubBrokerClient.js';
import { registerCleanup } from './utils/cleanup.js';

export async function createForegroundAgent(
  preflight: AgentProfilePreflight,
  token: ActivationPreflightToken,
  intent: ProviderActivationIntent,
  authority: CredentialAuthority,
  host: AgentForegroundHost,
): Promise<Agent> {
  const broker =
    host.githubBrokerClient === undefined
      ? createGitHubBrokerClient(authority)
      : undefined;
  let closing: Promise<void> | undefined;
  const closeBroker = (): Promise<void> => {
    closing ??= Promise.resolve().then(() => broker?.dispose());
    return closing;
  };
  try {
    const agent = await AgentProfilePreflight.createForegroundAgent(
      preflight,
      token,
      intent,
      {
        ...host,
        githubBrokerClient: host.githubBrokerClient ?? broker,
        disposeGitHubBroker:
          broker === undefined ? host.disposeGitHubBroker : closeBroker,
      },
    );
    registerCleanup(() => agent.dispose());
    return agent;
  } catch (primary) {
    try {
      await closeBroker();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        'Foreground broker cleanup failed',
      );
    }
    throw primary;
  }
}
