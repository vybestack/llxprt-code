/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type Agent,
  type AgentForegroundHost,
  type ActivationPreflightToken,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { createGitHubBrokerClient } from './config/githubBrokerClient.js';
import { registerCleanup } from './utils/cleanup.js';

/**
 * The only preflight operation Agent construction performs. Callers that build
 * the foreground Agent take this instead of the preflight, whose remaining
 * surface belongs to the code that creates and finishes it.
 */
export interface ForegroundAdmission {
  admitForegroundAgent(
    token: ActivationPreflightToken,
    intent: ProviderActivationIntent,
    host: AgentForegroundHost,
  ): Promise<Agent>;
}

export async function createForegroundAgent(
  admission: ForegroundAdmission,
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
    const agent = await admission.admitForegroundAgent(token, intent, {
      ...host,
      githubBrokerClient: host.githubBrokerClient ?? broker,
      disposeGitHubBroker:
        broker === undefined ? host.disposeGitHubBroker : closeBroker,
    });
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
