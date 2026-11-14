/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import { PreCompressTrigger } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';

export function createCompressionHookTrigger(
  triggerCompressionHook: typeof triggerPreCompressHook,
): (
  context: Pick<CompressionContext, 'trigger'>,
  owner?: HookExecutionOwner,
) => Promise<void> {
  return async (context, owner) => {
    const trigger =
      context.trigger === 'auto'
        ? PreCompressTrigger.Auto
        : PreCompressTrigger.Manual;
    await triggerCompressionHook(trigger, owner);
  };
}
