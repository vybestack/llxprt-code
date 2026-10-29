import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type {
  GenerateChatOptions,
  ResolvedSubProfile,
} from '@vybestack/llxprt-code-providers';
import { resolveMemberAuthentication } from '../../../../../providers/src/loadBalancing/memberAuthentication.js';
import { buildRoundRobinResolvedOptions } from '../../../../../providers/src/loadBalancing/resolvedOptionsBuilder.js';
import { replayableContents } from '../../../../../providers/src/utils/collectContents.js';

export async function memberOptions(
  member: ResolvedSubProfile,
  storage: Pick<ProviderKeyStorageLike, 'getKey'>,
): Promise<GenerateChatOptions> {
  const logger = new DebugLogger('profile-member-auth-test');
  return buildRoundRobinResolvedOptions(
    await resolveMemberAuthentication(member, logger, storage),
    {
      contents: replayableContents([]),
      invocation: createRuntimeInvocationContext({
        fetch: () =>
          Promise.reject(new Error('This test must not make network requests')),
        providerName: 'load-balancer',
        ephemeralsSnapshot: {},
        fallbackRuntimeId: 'member-auth-test',
      }),
    },
    {
      lbProfileEphemeralSettings: undefined,
      lbProfileModelParams: undefined,
      logger,
      providerName: 'load-balancer',
      getEffectiveContextLimit: () => undefined,
    },
  );
}
