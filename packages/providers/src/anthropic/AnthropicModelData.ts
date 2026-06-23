/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic Model Data Module
 * Contains pure model catalog data and stateless model utility functions
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 5)
 */

import type { IModel } from '../IModel.js';

/**
 * Model token patterns for max output tokens - static configuration only.
 * These intentionally use substring matchers rather than regexes so the table
 * stays readable. The v4 hardcoded checks in getMaxTokensForModel run first,
 * and Anthropic model IDs consistently use claude-family-name ordering.
 */
export const MODEL_TOKEN_PATTERNS: Array<{
  matchers: string[];
  tokens: number;
}> = [
  { matchers: ['claude-', 'opus-4'], tokens: 32000 },
  { matchers: ['claude-', 'sonnet-4'], tokens: 64000 },
  { matchers: ['claude-', 'haiku-4'], tokens: 200000 }, // Future-proofing for Haiku 4
  { matchers: ['claude-', '3-7', 'sonnet'], tokens: 64000 },
  { matchers: ['claude-', '3-5', 'sonnet'], tokens: 8192 },
  { matchers: ['claude-', '3-5', 'haiku'], tokens: 8192 },
  { matchers: ['claude-', '3', 'opus'], tokens: 4096 },
  { matchers: ['claude-', '3', 'haiku'], tokens: 4096 },
];

/**
 * OAuth-compatible models (without provider field - added by provider class)
 */
export const OAUTH_MODELS: Array<Omit<IModel, 'provider'>> = [
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-1',
    name: 'Claude Opus 4.1',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 16000,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 16000,
  },
];

/**
 * Default models (without provider field - added by provider class)
 */
export const DEFAULT_MODELS: Array<Omit<IModel, 'provider'>> = [
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    supportedToolFormats: ['anthropic'],
    contextWindow: 200000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-5-20251101',
    name: 'Claude Opus 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-opus-4-1-20250805',
    name: 'Claude Opus 4.1',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    supportedToolFormats: ['anthropic'],
    contextWindow: 500000,
    maxOutputTokens: 16000,
  },
];

/**
 * Helper method to get the latest Claude 4 model ID for a given tier.
 * This can be used when you want to ensure you're using the latest model.
 * @param tier - The model tier: 'opus', 'sonnet', or 'haiku'
 * @returns The latest model ID for that tier
 */
export function getLatestClaude4Model(
  tier: 'opus' | 'sonnet' | 'haiku' = 'sonnet',
): string {
  switch (tier) {
    case 'opus':
      return 'claude-opus-4-latest';
    case 'sonnet':
      return 'claude-sonnet-4-latest';
    case 'haiku':
      // Haiku 4 not yet available, but future-proofed
      return 'claude-haiku-4-latest';
    default:
      return 'claude-sonnet-4-latest';
  }
}

/**
 * Whether the model is Claude Opus 4.6 or later (supports adaptive thinking, 128K output)
 */
export function isOpus46Plus(modelId: string): boolean {
  return (
    modelId === 'claude-opus-4-latest' ||
    modelId.includes('claude-opus-4-6') ||
    modelId.includes('claude-opus-4-7') ||
    modelId.includes('claude-opus-4-8')
  );
}

/**
 * Get max output tokens for a given model
 */
export function getMaxTokensForModel(modelId: string): number {
  // Opus 4 models (including 4.6+ and the "latest" alias) default to the
  // Claude Code / subscription max output of 32K. The 128K ceiling is
  // API-only and can be raised via /set or a profile (maxOutputTokens).
  if (modelId === 'claude-opus-4-latest' || modelId.includes('claude-opus-4')) {
    return 32000;
  }
  if (
    modelId === 'claude-sonnet-4-latest' ||
    modelId.includes('claude-sonnet-4')
  ) {
    return 64000;
  }

  // Try to match model patterns
  const loweredModelId = modelId.toLowerCase();
  for (const { matchers, tokens } of MODEL_TOKEN_PATTERNS) {
    if (matchers.every((m) => loweredModelId.includes(m))) {
      return tokens;
    }
  }

  // Default for unknown models
  return 4096;
}

/**
 * Get context window for a given model
 */
export function getContextWindowForModel(modelId: string): number {
  // Claude Opus 4.6/4.7/4.8 (and the "latest" alias) default to the
  // Claude Code / subscription 200K context window. The 1M window is
  // API-only and plan-gated; raise it via /set or a profile (context-limit).
  if (
    modelId === 'claude-opus-4-latest' ||
    modelId.includes('claude-opus-4-6') ||
    modelId.includes('claude-opus-4-7') ||
    modelId.includes('claude-opus-4-8')
  ) {
    return 200000;
  }
  // Other Claude 4 opus models have larger context windows
  if (modelId.includes('claude-opus-4')) {
    return 500000;
  }
  if (modelId.includes('claude-sonnet-4')) {
    return 400000;
  }
  // Claude 3.7 models
  if (modelId.includes('claude-3-7')) {
    return 300000;
  }
  // Default for Claude 3.x models
  return 200000;
}
