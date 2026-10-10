/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt-envelope estimation at the final per-attempt send seam (issue #2817).
 *
 * Extracted from TurnProcessor/StreamProcessor to keep those files under the
 * 800-line lint cap. The estimation logic runs after all content/tool/hook
 * enforcement and before transport, at the same finalized options structure
 * transport consumes.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RuntimeGenerateChatOptions,
  RuntimeProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import {
  extractSystemInstructionText,
  resolveUserMemory,
} from './streamRequestHelpers.js';

export type { PromptEnvelopeEstimate };

export {
  buildSourceProviderChatOptions,
  createSourcePromptEnvelopePreparer,
  prepareSourcePromptEnvelopeAfterEnforcement,
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PromptEnvelopeSource,
  type PreparedSourcePromptEnvelopeSend,
  type SourceProviderChatOptions,
} from './prompt-envelope-source-send.js';

export interface PreparedPromptEnvelopeSend {
  readonly estimate: PromptEnvelopeEstimate | null;
  readonly options: RuntimeGenerateChatOptions;
  readonly releaseIfUnsent?: () => Promise<void>;
}

/**
 * Build the finalized provider chat options that both estimation and transport
 * consume — the single immutable prepared-attempt value (issue #2817).
 *
 * The invocation is passed from the caller to avoid reconstructing the
 * RuntimeInvocationContext (which requires provider ephemerals and settings
 * separation). The signal is embedded so retry/abort propagation works.
 */
export function buildProviderChatOptions(
  requestContents: Iterable<IContent> | AsyncIterable<IContent>,
  tools: ToolDeclaration[] | undefined,
  runtimeContext: ProviderRuntimeContext,
  invocation: RuntimeGenerateChatOptions['invocation'],
  requestContext: Record<string, unknown> | undefined,
  systemInstruction: unknown,
  systemPromptAssembler?: RuntimeGenerateChatOptions['systemPromptAssembler'],
): RuntimeGenerateChatOptions {
  return {
    // The provider-facing history is a stream (issue #854); re-open the
    // assembled rows so estimation and transport each get a fresh pass.
    contents: {
      async *[Symbol.asyncIterator]() {
        for await (const content of requestContents) {
          yield content;
        }
      },
    },
    tools: tools as RuntimeProviderToolset | undefined,
    config: runtimeContext.config,
    runtime: runtimeContext,
    invocation,
    settings:
      runtimeContext.settingsService as RuntimeGenerateChatOptions['settings'],
    metadata: {
      ...runtimeContext.metadata,
      _retryRequestContext: requestContext,
    },
    userMemory: resolveUserMemory(runtimeContext.config),
    systemInstruction: extractSystemInstructionText(systemInstruction),
    ...(systemPromptAssembler !== undefined && { systemPromptAssembler }),
  };
}

/**
 * Estimate the finalized prompt envelope at the final send seam.
 *
 * Returns the estimate when the provider implements projectPromptEnvelope, or
 * null when it does not (genuine compatibility behavior for out-of-scope
 * protocols). Each attempt calls this so compression/retry/material changes
 * are reflected.
 *
 * Projection and estimate contract failures are fatal because compression and
 * hard-limit enforcement require a trustworthy finalized-envelope estimate.
 */
export async function prepareAtSendSeam(
  provider: RuntimeProvider,
  options: RuntimeGenerateChatOptions,
): Promise<PreparedPromptEnvelopeSend> {
  if (typeof provider.projectPromptEnvelope !== 'function') {
    return { estimate: null, options };
  }
  const projection = await provider.projectPromptEnvelope(options);
  if (projection === undefined) {
    return { estimate: null, options };
  }
  try {
    const config = options.config ?? options.runtime?.config;
    const getTokenizerFactory = config?.getTokenizerFactory;
    const tokenizerFactory =
      typeof getTokenizerFactory === 'function'
        ? getTokenizerFactory.call(config)
        : undefined;
    if (tokenizerFactory === undefined) {
      throw new Error(
        'Prompt-envelope projection requires the configured runtime prompt estimator factory',
      );
    }
    const estimate = await estimatePromptEnvelope(
      provider.name,
      projection,
      tokenizerFactory,
    );
    return {
      estimate,
      options: {
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      },
      ...(projection.releaseIfUnsent === undefined
        ? {}
        : { releaseIfUnsent: projection.releaseIfUnsent }),
    };
  } catch (error: unknown) {
    try {
      await projection.releaseIfUnsent?.();
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [error, cleanupError],
        'Prompt projection preparation and cleanup failed',
      );
    }
    throw error;
  }
}
