/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

export function tokenLimit(model: Model): TokenCount {
  // Strip provider prefix if present (e.g., "openai:gpt-4o" -> "gpt-4o")
  const modelWithoutPrefix = model.includes(':') ? model.split(':')[1] : model;

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
    case 'gemini-2.0-flash':
      return 1_048_576;
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;

    // OpenAI models
    case 'o4-mini':
    case 'o3':
    case 'o3-mini':
    case 'gpt-4.1':
    case 'gpt-4o':
    case 'gpt-4o-mini':
      return 128_000;
    case 'o1':
    case 'o1-mini':
      return 200_000;

    // Anthropic models
    // Claude 4 series - larger context windows
    case 'claude-opus-4-latest':
    case 'claude-opus-4-20250514':
      return 500_000;
    case 'claude-sonnet-4-latest':
    case 'claude-sonnet-4-20250301':
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
