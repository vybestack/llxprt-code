/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import * as agents from '@vybestack/llxprt-code-agents';
import type { Config } from '@vybestack/llxprt-code-core';

export type ObservedBootstrap = {
  config: Config;
  settingsService: Parameters<
    typeof agents.assembleAgentActivationBootstrap
  >[1];
  providerManager: agents.Agent['providerManager'];
  operation: agents.AgentActivationOperation;
  receipt?: agents.ActivationPreflight;
  intent?: agents.ProviderActivationIntent;
};

export function requireReceipt(owner: ObservedBootstrap): {
  activation: agents.ProviderActivationIntent;
  activationPreflight: agents.ActivationPreflight;
} {
  if (!owner.receipt || !owner.intent)
    throw new Error('Missing preflight receipt');
  return { activation: owner.intent, activationPreflight: owner.receipt };
}

export async function expectInvalidReceipt(
  owner: ObservedBootstrap,
): Promise<void> {
  await expect(
    agents.fromConfig(
      owner.config,
      owner.settingsService,
      { activation: requireReceipt(owner).activation },
      undefined,
      owner.providerManager,
      undefined,
      undefined,
      undefined,
      requireReceipt(owner).activationPreflight,
    ),
  ).rejects.toThrow('token is invalid or already consumed');
}

export async function expectClosed(owner: ObservedBootstrap): Promise<void> {
  const result = await owner.operation.preflight({ authMode: 'none' });
  expect(result.authFailed).toBe(true);
  expect(result.authError).toBeInstanceOf(Error);
  if (!(result.authError instanceof Error))
    throw new Error('Missing disposal error');
  expect(result.authError.message).toContain('disposed');
  expect(result.token).toBeUndefined();
}

export class StartupExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`startup exit ${code}`);
  }
}

export function expectStartupAdmissionClosed(owner: ObservedBootstrap): void {
  expect(() => owner.operation.sessionClient.getAgentClient()).toThrow(
    'disposed',
  );
}
