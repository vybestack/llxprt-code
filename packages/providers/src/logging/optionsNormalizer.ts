/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { copyProviderRequestOptions } from '../requestAdmission.js';
/**
 * Options normalization and runtime context validation helpers extracted
 * from LoggingProviderWrapper to keep the main wrapper file under the
 * lint line budget.
 */

import {
  type IContent,
  type UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { MissingProviderRuntimeError } from '../errors.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export interface NormalizerContext {
  runtimeContextResolver?: () => ProviderRuntimeContext;
  statelessRuntimeMetadata: Record<string, unknown> | null;
  optionsNormalizer:
    | ((
        options: GenerateChatOptions,
        providerName: string,
      ) => GenerateChatOptions)
    | null;
  providerName: string;
}

/** REQ-SP4-004: Normalize raw args into GenerateChatOptions, inject runtime, apply normalizer. */
export function normalizeChatCompletionOptions(
  contentOrOptions: IContent[] | GenerateChatOptions,
  maybeTools: ProviderToolset | undefined,
  ctx: NormalizerContext,
): GenerateChatOptions {
  let normalizedOptions: GenerateChatOptions = Array.isArray(contentOrOptions)
    ? { contents: contentOrOptions, tools: maybeTools }
    : copyProviderRequestOptions(contentOrOptions);

  const injectedRuntime = ctx.runtimeContextResolver?.();

  if (injectedRuntime) {
    const mergedMetadata: Record<string, unknown> = {
      ...(ctx.statelessRuntimeMetadata ?? {}),
      ...(injectedRuntime.metadata ?? {}),
      ...(normalizedOptions.metadata ?? {}),
      source: 'LoggingProviderWrapper.generateChatCompletion',
      requirement: 'REQ-SP4-001',
    };

    normalizedOptions.runtimeKind ??= injectedRuntime.runtimeKind;
    normalizedOptions.invocation ??= captureProviderInvocation(
      injectedRuntime,
      ctx.providerName,
      normalizedOptions.modelParameters,
    );
    applyInjectedRetryOperations(normalizedOptions, injectedRuntime);

    normalizedOptions.metadata = mergedMetadata;
  }

  if (!injectedRuntime && ctx.statelessRuntimeMetadata) {
    normalizedOptions.metadata = {
      ...ctx.statelessRuntimeMetadata,
      ...(normalizedOptions.metadata ?? {}),
    };
  }

  if (ctx.optionsNormalizer) {
    normalizedOptions = ctx.optionsNormalizer(
      normalizedOptions,
      ctx.providerName,
    );
  }
  return normalizedOptions;
}

/** REQ-SP4-004: Throw if runtime context is missing settings or config. */
export function ensureRuntimeContext(
  normalizedOptions: GenerateChatOptions,
  providerName: string,
  debug: DebugLogger,
): void {
  debug.log(() => `Checking admitted invocation for ${providerName}`);
  if (!normalizedOptions.invocation) {
    throw buildMissingRuntimeError(
      providerName,
      typeof normalizedOptions.metadata?.runtimeId === 'string'
        ? normalizedOptions.metadata.runtimeId
        : 'unknown',
      ['invocation'],
    );
  }
}

export function buildMissingRuntimeError(
  providerName: string,
  runtimeId: string,
  missingFields: string[],
): MissingProviderRuntimeError {
  return new MissingProviderRuntimeError({
    providerKey: `LoggingProviderWrapper[${providerName}]`,
    missingFields,
    requirement: 'REQ-SP4-004',
    stage: 'generateChatCompletion',
    metadata: {
      hint: 'Runtime context is required for stateless hardening.',
      runtimeId,
    },
  });
}

// UsageStats re-export for type consumers
export type { UsageStats };

function applyInjectedRetryOperations(
  options: GenerateChatOptions,
  injectedRuntime: ProviderRuntimeContext,
): void {
  options.readRetryAuthToken ??= injectedRuntime.readRetryAuthToken;
  options.handleAuthError ??= injectedRuntime.handleAuthError;
  options.tryBucketFailover ??= injectedRuntime.tryBucketFailover;
  options.readFailoverBuckets ??= injectedRuntime.readFailoverBuckets;
  options.readCurrentBucket ??= injectedRuntime.readCurrentBucket;
  options.readFailoverReasons ??= injectedRuntime.readFailoverReasons;
  options.resetBucketSession ??= injectedRuntime.resetBucketSession;
}
