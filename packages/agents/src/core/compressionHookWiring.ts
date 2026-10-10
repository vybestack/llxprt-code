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
): (context: CompressionContext, owner?: HookExecutionOwner) => Promise<void> {
  return async (context, owner) => {
    const trigger =
      context.trigger === 'auto'
        ? PreCompressTrigger.Auto
        : PreCompressTrigger.Manual;
    await triggerCompressionHook(trigger, owner);
  };
}

export async function fireCompressionHook(
  buildContext: (
    transcriptPathProvider?: () => string | undefined,
  ) => Promise<CompressionContext>,
  hookTrigger: (
    context: CompressionContext,
    owner?: HookExecutionOwner,
  ) => Promise<void>,
  options?: {
    trigger?: 'manual' | 'auto';
    transcriptPathProvider?: () => string | undefined;
    hookOwner?: HookExecutionOwner;
  },
): Promise<void> {
  const context = await buildContext(options?.transcriptPathProvider);
  try {
    await hookTrigger(
      { ...context, trigger: options?.trigger ?? 'manual' },
      options?.hookOwner,
    );
  } catch {
    // Hooks are fail-open - continue even if hook fails
  }
}
