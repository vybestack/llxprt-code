/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { fireCompressionHook } from '../core/compressionHookWiring.js';

interface CompressionHookRuntime {
  buildCompressionContext(
    promptId: string,
    options: { modelParameters?: AdmittedModelParameters },
    transcriptPathProvider?: () => string | undefined,
  ): Promise<CompressionContext>;
}

export interface CompressionAttemptOptions {
  readonly bypassCooldown?: boolean;
  readonly modelParameters?: AdmittedModelParameters;
  readonly transcriptPathProvider?: () => string | undefined;
  readonly trigger?: 'manual' | 'auto';
  readonly hookOwner?: HookExecutionOwner;
  readonly historyOrigin?: object;
}

export function fireCompressionHookForAttempt(
  runtime: CompressionHookRuntime,
  promptId: string,
  options: CompressionAttemptOptions | undefined,
  hookTrigger: (
    context: CompressionContext,
    owner?: HookExecutionOwner,
  ) => Promise<void>,
): Promise<void> {
  return fireCompressionHook(
    () =>
      runtime.buildCompressionContext(
        promptId,
        { modelParameters: options?.modelParameters },
        options?.transcriptPathProvider,
      ),
    hookTrigger,
    options,
  );
}
