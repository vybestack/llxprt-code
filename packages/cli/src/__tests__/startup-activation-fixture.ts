/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'bun:test';
import {
  AgentProfilePreflight,
  type ActivationPreflightToken,
  type AgentActivationOperation,
  type ProviderActivationIntent,
} from '@vybestack/llxprt-code-agents';

export type StartupReceipt = {
  token: ActivationPreflightToken;
  intent: ProviderActivationIntent;
};

export function transferActivation(
  preflight: AgentProfilePreflight,
): AgentActivationOperation {
  let activation: AgentActivationOperation | undefined;
  preflight.transferActivation((operation) => {
    activation = operation;
  });
  if (activation === undefined) throw new Error('Missing activation operation');
  return activation;
}

export async function expectClosed(
  operation: Pick<AgentActivationOperation, 'preflight'>,
): Promise<void> {
  const result = await operation.preflight({ authMode: 'none' });
  expect(result.authFailed).toBe(true);
  expect(result.authError).toBeInstanceOf(Error);
  if (!(result.authError instanceof Error))
    throw new Error('Missing disposal error');
  expect(result.authError.message).toContain('disposed');
  expect(result.token).toBeUndefined();
}

/**
 * A disposed, untransferred preflight refuses a new activation preflight, and
 * a receipt it issued can no longer build a foreground Agent.
 */
export async function expectPreflightRetired(
  preflight: AgentProfilePreflight,
  receipt: StartupReceipt,
): Promise<void> {
  expect(() => preflight.preflight({ authMode: 'none' })).toThrow('disposed');
  await expect(
    AgentProfilePreflight.createForegroundAgent(
      preflight,
      receipt.token,
      receipt.intent,
      {},
    ),
  ).rejects.toThrow('disposed');
}

export class StartupExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`startup exit ${code}`);
  }
}
