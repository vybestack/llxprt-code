/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

export function tokenLimit(
  model: Model,
  userContextLimit?: number,
): TokenCount {
  // If user has set a context limit, use it
  if (userContextLimit && userContextLimit > 0) {
    return userContextLimit;
  }

  // Strip provider prefix if present (e.g., "openai:gpt-4o" -> "gpt-4o")
  const modelWithoutPrefix = model.includes(':') ? model.split(':')[1] : model;

  // Check OpenAI models with version suffixes first
  if (modelWithoutPrefix.startsWith('gpt-4.1')) {
    return 1_000_000;
  }
  // Check more specific models first
  if (
    modelWithoutPrefix.startsWith('o3-pro') ||
    modelWithoutPrefix.startsWith('o3-mini') ||
    modelWithoutPrefix.startsWith('o1-mini')
  ) {
    return 200_000;
  }
  // Then check base models
  if (
    modelWithoutPrefix.startsWith('o3') ||
    modelWithoutPrefix.startsWith('o1')
  ) {
    return 200_000;
  }
  if (
    modelWithoutPrefix.startsWith('o4-mini') ||
    modelWithoutPrefix.startsWith('gpt-4o-mini') ||
    modelWithoutPrefix.startsWith('gpt-4o-realtime') ||
    modelWithoutPrefix.startsWith('gpt-4o') ||
    modelWithoutPrefix.startsWith('gpt-4-turbo')
  ) {
    return 128_000;
  }
  if (modelWithoutPrefix.startsWith('gpt-3.5-turbo')) {
    return 16_385;
  }

  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models
  switch (modelWithoutPrefix) {
    // Gemini models
    case 'gemini-1.5-pro':
      return 2_097_152;
    case 'gemini-1.5-flash':
    case 'gemini-2.5-pro-preview-05-06':
    case 'gemini-2.5-pro-preview-06-05':
    case 'gemini-2.5-pro':
    case 'gemini-2.5-flash-preview-05-20':
    case 'gemini-2.5-flash':
    case 'gemini-2.5-flash-lite':
    case 'gemini-2.0-flash':
      return 1_048_576;
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;

    // Anthropic models
    // Claude 4 series - larger context windows
    case 'claude-opus-4-6':
      return 200_000;
    case 'claude-opus-4-latest':
      return 500_000;
    case 'claude-sonnet-4-latest':
      return 400_000;
    // Claude 3.7 series
    case 'claude-3-7-opus-20250115':
    case 'claude-3-7-sonnet-20250115':
      return 300_000;
    // Claude 3.5 and 3.0 series
    case 'claude-3-opus-20240229':
    case 'claude-3-sonnet-20240229':
    case 'claude-3-haiku-20240307':
    case 'claude-3.5-sonnet-20240620':
    case 'claude-3.5-sonnet-20241022':
    case 'claude-3.5-haiku-20241022':
    case 'claude-3-5-sonnet-20241022':
    case 'claude-3-5-haiku-20241022':
      return 200_000;

    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
