/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

const OPENAI_128K_PREFIXES = [
  'o4-mini',
  'gpt-4o-mini',
  'gpt-4o-realtime',
  'gpt-4o',
  'gpt-4-turbo',
];

const OPENAI_200K_PREFIXES = ['o3-pro', 'o3-mini', 'o1-mini', 'o3', 'o1'];

interface PrefixLimit {
  prefix: string;
  limit: TokenCount;
}

const PREFIX_LIMITS: PrefixLimit[] = [
  { prefix: 'gpt-4.1', limit: 1_000_000 },
  { prefix: 'gpt-3.5-turbo', limit: 16_385 },
];

const EXACT_LIMITS: Record<string, TokenCount> = {
  // Gemini models
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
  'gemini-2.5-pro-preview-05-06': 1_048_576,
  'gemini-2.5-pro-preview-06-05': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-2.5-flash-preview-05-20': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-flash-lite': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.0-flash-preview-image-generation': 32_000,

  // Claude Opus 4.6/4.7/4.8 default to the Claude Code / subscription 200K
  // context window. The 1M window is API-only and plan-gated; override via
  // /set or a profile (context-limit).
  'claude-opus-4-8': 200_000,
  'claude-opus-4-7': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-latest': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-latest': 400_000,
  'claude-3-7-opus-20250115': 300_000,
  'claude-3-7-sonnet-20250115': 300_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-sonnet-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
  'claude-3.5-sonnet-20240620': 200_000,
  'claude-3.5-sonnet-20241022': 200_000,
  'claude-3.5-haiku-20241022': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
};

function matchesAnyPrefix(model: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => model.startsWith(prefix));
}

function resolvePrefixLimit(
  modelWithoutPrefix: string,
): TokenCount | undefined {
  for (const { prefix, limit } of PREFIX_LIMITS) {
    if (modelWithoutPrefix.startsWith(prefix)) {
      return limit;
    }
  }
  return undefined;
}

export function tokenLimit(
  model: Model,
  userContextLimit?: number,
): TokenCount {
  // If user has set a context limit, use it
  if (userContextLimit !== undefined && userContextLimit > 0) {
    return userContextLimit;
  }

  // Strip provider prefix if present (e.g., "openai:gpt-4o" -> "gpt-4o")
  const modelWithoutPrefix = model.includes(':') ? model.split(':')[1] : model;

  // Check exact model matches first
  if (modelWithoutPrefix in EXACT_LIMITS) {
    return EXACT_LIMITS[modelWithoutPrefix];
  }

  // Check prefix-based limits
  const prefixLimit = resolvePrefixLimit(modelWithoutPrefix);
  if (prefixLimit !== undefined) {
    return prefixLimit;
  }

  // Check OpenAI 200K models (includes o3, o1 series)
  if (matchesAnyPrefix(modelWithoutPrefix, OPENAI_200K_PREFIXES)) {
    return 200_000;
  }

  // Check OpenAI 128K models
  if (matchesAnyPrefix(modelWithoutPrefix, OPENAI_128K_PREFIXES)) {
    return 128_000;
  }

  return DEFAULT_TOKEN_LIMIT;
}
