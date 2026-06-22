/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import type { StripPolicy } from '../reasoning/reasoningUtils.js';

import type {
  ModelCallParams,
  ReasoningSettings,
} from './vercelStreamTypes.js';

/**
 * Extracts model parameters from normalized invocation options, translating
 * the generic maxOutputTokens ephemeral to OpenAI's max_tokens.
 */
export function extractModelParamsFromOptions(
  options: NormalizedGenerateChatOptions,
): Record<string, unknown> | undefined {
  const modelParams = { ...options.invocation.modelParams };

  const rawMaxOutput = options.settings.get('maxOutputTokens');
  const genericMaxOutput =
    typeof rawMaxOutput === 'number' &&
    Number.isFinite(rawMaxOutput) &&
    rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  if (
    genericMaxOutput !== undefined &&
    modelParams['max_tokens'] === undefined
  ) {
    modelParams['max_tokens'] = genericMaxOutput;
  }

  return Object.keys(modelParams).length > 0 ? modelParams : undefined;
}

/**
 * Resolves reasoning settings from ephemeral options with defaults.
 */
export function resolveReasoningSettings(
  options: NormalizedGenerateChatOptions,
): ReasoningSettings {
  return {
    enabled:
      (options.settings.get('reasoning.enabled') as boolean | undefined) ??
      true,
    includeInResponse:
      (options.settings.get('reasoning.includeInResponse') as
        | boolean
        | undefined) ?? true,
    includeInContext:
      (options.settings.get('reasoning.includeInContext') as
        | boolean
        | undefined) ?? false,
    stripFromContext:
      (options.settings.get('reasoning.stripFromContext') as
        | StripPolicy
        | undefined) ?? 'all',
    format:
      (options.settings.get('reasoning.format') as
        | 'native'
        | 'field'
        | undefined) ?? 'field',
  };
}

/**
 * Resolves whether streaming should be enabled from ephemeral/resolved options.
 */
export function resolveStreamingEnabled(
  options: NormalizedGenerateChatOptions,
): boolean {
  const ephemerals = options.invocation.ephemerals;
  const streamingSetting = ephemerals['streaming'];
  const streamingResolved = options.resolved.streaming;
  if (streamingResolved === false) return false;
  if (streamingResolved === true) return true;
  return streamingSetting !== 'disabled';
}

export function resolveMaxOutputTokens(
  maxTokensMeta: number | undefined,
  maxTokensOverride: number | undefined,
): number | undefined {
  if (typeof maxTokensMeta === 'number' && Number.isFinite(maxTokensMeta)) {
    return maxTokensMeta;
  }
  if (
    typeof maxTokensOverride === 'number' &&
    Number.isFinite(maxTokensOverride)
  ) {
    return maxTokensOverride;
  }
  return undefined;
}

export function resolveStopSequences(
  stopSetting: string | string[] | undefined,
): string | string[] | undefined {
  if (typeof stopSetting === 'string') return [stopSetting];
  if (Array.isArray(stopSetting)) return stopSetting;
  return undefined;
}

/**
 * Resolves all model call parameters from options and metadata.
 */
export function resolveModelCallParams(
  options: NormalizedGenerateChatOptions,
  metadata: NormalizedGenerateChatOptions['metadata'],
  provider: BaseProvider,
): ModelCallParams {
  const modelParams = extractModelParamsFromOptions(options) ?? {};
  const ephemerals = options.invocation.ephemerals;
  const maxTokensMeta =
    (metadata['maxTokens'] as number | undefined) ??
    (ephemerals['max-tokens'] as number | undefined);
  const maxTokensOverride =
    (modelParams['max_tokens'] as number | undefined) ?? undefined;
  const maxOutputTokens = resolveMaxOutputTokens(
    maxTokensMeta,
    maxTokensOverride,
  );
  const temperature = modelParams['temperature'] as number | undefined;
  const topP = modelParams['top_p'] as number | undefined;
  const presencePenalty = modelParams['presence_penalty'] as number | undefined;
  const frequencyPenalty = modelParams['frequency_penalty'] as
    | number
    | undefined;
  const stopSetting = modelParams['stop'] as string | string[] | undefined;
  const stopSequences = resolveStopSequences(stopSetting);
  const seed = modelParams['seed'] as number | undefined;
  const maxRetries = (ephemerals['retries'] as number | undefined) ?? 2;
  void provider;
  return {
    maxOutputTokens,
    temperature,
    topP,
    presencePenalty,
    frequencyPenalty,
    stopSequences,
    seed,
    maxRetries,
  };
}
