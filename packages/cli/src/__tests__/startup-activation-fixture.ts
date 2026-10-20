import { adoptFixture } from '../../../agents/src/api/__tests__/helpers/adoption-fixture.js';
import { AgentActivationBootstrap } from '../../../agents/src/api/activationPreflightState.js';
import type { AgentProfilePreflight } from '../../../agents/src/api/profile-preflight.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  RuntimeProviderManager,
  Config,
} from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import type * as agents from '@vybestack/llxprt-code-agents';

export type ObservedBootstrap = {
  config: Config;
  settingsService: SettingsService;
  providerManager: RuntimeProviderManager;
  operation: agents.AgentActivationOperation;
  receipt?: agents.ActivationPreflight;
  intent?: agents.ProviderActivationIntent;
};

export function transferActivation(
  preflight: AgentProfilePreflight,
): agents.AgentActivationOperation {
  let activation: agents.AgentActivationOperation | undefined;
  preflight.transferActivation((operation) => {
    activation = operation;
  });
  if (activation === undefined) throw new Error('Missing activation operation');
  return activation;
}

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
    adoptFixture(
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
  const operation = owner.operation;
  if (!(operation instanceof AgentActivationBootstrap))
    throw new Error('Missing actual activation owner');
  expect(() =>
    operation.createForeground(Object.freeze({}), { authMode: 'none' }, {}),
  ).toThrow('disposed');
}
