/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type {
  GenerateChatOptions,
  ResolvedSubProfile,
} from '@vybestack/llxprt-code-providers';
import { resolveMemberAuthentication } from '../../../../../providers/src/loadBalancing/memberAuthentication.js';
import { buildRoundRobinResolvedOptions } from '../../../../../providers/src/loadBalancing/resolvedOptionsBuilder.js';

export async function memberOptions(
  member: ResolvedSubProfile,
): Promise<GenerateChatOptions> {
  const logger = new DebugLogger('profile-member-auth-test');
  return buildRoundRobinResolvedOptions(
    await resolveMemberAuthentication(member, logger),
    { contents: [] },
    {
      lbProfileEphemeralSettings: undefined,
      lbProfileModelParams: undefined,
      logger,
      providerName: 'load-balancer',
      getEffectiveContextLimit: () => undefined,
    },
  );
}
