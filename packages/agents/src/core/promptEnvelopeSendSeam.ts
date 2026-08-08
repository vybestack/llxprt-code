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

import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RuntimeGenerateChatOptions,
  RuntimeProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { ToolGroupArray } from './streamRequestHelpers.js';
import {
  extractSystemInstructionText,
  resolveUserMemory,
} from './streamRequestHelpers.js';

export type { PromptEnvelopeEstimate };

export interface PreparedPromptEnvelopeSend {
  readonly estimate: PromptEnvelopeEstimate | null;
  readonly options: RuntimeGenerateChatOptions;
}

export function bindPreparedTransportSignal(
  prepared: PreparedPromptEnvelopeSend,
  signal: AbortSignal,
): PreparedPromptEnvelopeSend {
  const invocation = prepared.options.invocation;
  if (invocation === undefined) {
    throw new Error('Prepared provider options are missing invocation context');
  }
  return {
    estimate: prepared.estimate,
    options: {
      ...prepared.options,
      invocation: { ...invocation, signal },
      metadata: { ...prepared.options.metadata, abortSignal: signal },
    },
  };
}

export interface PromptEnvelopePreparer {
  prepare(contents: IContent[]): Promise<PreparedPromptEnvelopeSend>;
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
  requestContents: IContent[],
  tools: ToolGroupArray | undefined,
  runtimeContext: ProviderRuntimeContext,
  invocation: RuntimeGenerateChatOptions['invocation'],
  requestContext: Record<string, unknown> | undefined,
  systemInstruction: unknown,
): RuntimeGenerateChatOptions {
  return {
    contents: requestContents,
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
  };
}

export function createPromptEnvelopePreparer(
  provider: RuntimeProvider,
  buildOptions: (contents: IContent[]) => RuntimeGenerateChatOptions,
): PromptEnvelopePreparer {
  const preparedByContents = new WeakMap<
    IContent[],
    PreparedPromptEnvelopeSend
  >();
  return {
    async prepare(contents: IContent[]): Promise<PreparedPromptEnvelopeSend> {
      const existing = preparedByContents.get(contents);
      if (existing !== undefined) return existing;
      const prepared = await prepareAtSendSeam(
        provider,
        buildOptions(contents),
      );
      preparedByContents.set(contents, prepared);
      return prepared;
    },
  };
}

interface EnforcementPreparationInput {
  provider: RuntimeProvider;
  contents: IContent[];
  buildOptions: (contents: IContent[]) => RuntimeGenerateChatOptions;
  enforce: (
    contents: IContent[],
    estimate: (contents: IContent[]) => Promise<number>,
  ) => Promise<IContent[]>;
  fallbackEstimate: (contents: IContent[]) => Promise<number>;
}

export async function preparePromptEnvelopeAfterEnforcement(
  input: EnforcementPreparationInput,
): Promise<{
  contents: IContent[];
  prepared: PreparedPromptEnvelopeSend;
  preparer: PromptEnvelopePreparer;
}> {
  const preparer = createPromptEnvelopePreparer(
    input.provider,
    input.buildOptions,
  );
  const contents = await input.enforce(input.contents, async (candidate) => {
    const prepared = await preparer.prepare(candidate);
    return (
      prepared.estimate?.estimatedPromptTokens ??
      input.fallbackEstimate(candidate)
    );
  });
  return { contents, prepared: await preparer.prepare(contents), preparer };
}

export async function enforceAndSendWithPromptEnvelopeRetries<T>(
  input: EnforcementPreparationInput & {
    send: (
      contents: IContent[],
      prepared: PreparedPromptEnvelopeSend,
    ) => Promise<T>;
    shouldRetryOnError: (error: unknown) => boolean;
    signal?: AbortSignal;
  },
): Promise<T> {
  const { contents, preparer } =
    await preparePromptEnvelopeAfterEnforcement(input);
  return sendWithFreshPromptEnvelopeRetries({
    provider: input.provider,
    contents,
    preparer,
    buildOptions: () => input.buildOptions(contents),
    send: (prepared) => input.send(contents, prepared),
    shouldRetryOnError: input.shouldRetryOnError,
    signal: input.signal,
  });
}

function sendWithFreshPromptEnvelopeRetries<T>(input: {
  provider: RuntimeProvider;
  contents: IContent[];
  preparer: PromptEnvelopePreparer;
  buildOptions: () => RuntimeGenerateChatOptions;
  send: (prepared: PreparedPromptEnvelopeSend) => Promise<T>;
  shouldRetryOnError: (error: unknown) => boolean;
  signal?: AbortSignal;
}): Promise<T> {
  let providerAttempt = 0;
  return retryWithBackoff(
    async () => {
      const prepared =
        providerAttempt === 0
          ? await input.preparer.prepare(input.contents)
          : await prepareAtSendSeam(input.provider, input.buildOptions());
      providerAttempt += 1;
      return input.send(prepared);
    },
    {
      shouldRetryOnError: input.shouldRetryOnError,
      signal: input.signal,
    },
  );
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
  const config = (options.config ?? options.runtime?.config) as
    | { getTokenizerFactory(): unknown }
    | undefined;
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
  };
}
