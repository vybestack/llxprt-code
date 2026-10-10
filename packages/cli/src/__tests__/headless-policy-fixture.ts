/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { runNonInteractive } from '../nonInteractiveCli.js';

export async function runHeadlessPolicyFixture(
  params: Parameters<typeof runNonInteractive>[0],
  runtimeSettings: NonNullable<
    Parameters<typeof runNonInteractive>[0]['runtimeSettings']
  >,
  providerManager: NonNullable<
    Parameters<typeof runNonInteractive>[0]['providerManager']
  >,
): Promise<void> {
  const policyOwner = new RuntimePolicyOwner(params.config);
  try {
    await runNonInteractive({
      ...params,
      runtimeSettings: params.runtimeSettings ?? runtimeSettings,
      providerManager,
      runtimeMessageBus: policyOwner.session.messageBus,
      policyOwner,
    });
  } finally {
    await policyOwner.dispose();
  }
}
