/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Options normalization and runtime context validation helpers extracted
 * from LoggingProviderWrapper to keep the main wrapper file under the
 * lint line budget.
 */

import {
  type IContent,
  type UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
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
    : { ...contentOrOptions };

  const injectedRuntime = ctx.runtimeContextResolver?.();
  const providedRuntime = normalizedOptions.runtime;

  if (injectedRuntime) {
    const mergedMetadata: Record<string, unknown> = {
      ...(ctx.statelessRuntimeMetadata ?? {}),
      ...(injectedRuntime.metadata ?? {}),
      ...(providedRuntime?.metadata ?? {}),
      ...(normalizedOptions.metadata ?? {}),
      source: 'LoggingProviderWrapper.generateChatCompletion',
      requirement: 'REQ-SP4-001',
    };

    normalizedOptions.runtime = {
      ...injectedRuntime,
      ...providedRuntime,
      settingsService:
        providedRuntime?.settingsService ?? injectedRuntime.settingsService,
      config: providedRuntime?.config ?? injectedRuntime.config,
      metadata: mergedMetadata,
    };

    normalizedOptions.settings =
      normalizedOptions.settings ??
      (normalizedOptions.runtime.settingsService as SettingsService);
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
  const runtime = normalizedOptions.runtime;
  const runtimeId = runtime?.runtimeId ?? 'unknown';
  debug.log(
    () =>
      `Checking runtime context: runtimeId=${runtimeId}, hasRuntime=${!!runtime}, hasSettings=${!!runtime?.settingsService}, hasConfig=${!!runtime?.config}`,
  );
  debug.log(
    () => `Contents length at entry: ${normalizedOptions.contents.length}`,
  );

  if (!runtime) {
    throw buildMissingRuntimeError(providerName, runtimeId, [
      'runtime',
      'settings',
      'config',
    ]);
  }

  const runtimeShape = runtime as { settingsService?: unknown };
  if (runtimeShape.settingsService == null) {
    debug.error(
      () => `Missing settings in runtime context for runtimeId=${runtimeId}`,
    );
    throw new MissingProviderRuntimeError({
      providerKey: `LoggingProviderWrapper[${providerName}]`,
      missingFields: ['settings'],
      requirement: 'REQ-SP4-004',
      stage: 'generateChatCompletion',
      metadata: {
        hint: 'Runtime context must include settings for stateless hardening.',
        runtimeId,
      },
    });
  }

  if (!runtime.config) {
    debug.error(
      () => `Missing config in runtime context for runtimeId=${runtimeId}`,
    );
    throw new MissingProviderRuntimeError({
      providerKey: `LoggingProviderWrapper[${providerName}]`,
      missingFields: ['config'],
      requirement: 'REQ-SP4-004',
      stage: 'generateChatCompletion',
      metadata: {
        hint: 'Runtime context must include config for stateless hardening.',
        runtimeId,
      },
    });
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
