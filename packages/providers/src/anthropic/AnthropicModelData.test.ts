/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  OAUTH_MODELS,
  DEFAULT_MODELS,
  isOpus46Plus,
  isSonnet5,
  supportsAdaptiveThinking,
  getLatestClaudeModel,
  getMaxTokensForModel,
  getContextWindowForModel,
} from './AnthropicModelData.js';

describe('AnthropicModelData latest Opus models', () => {
  describe('catalog entries', () => {
    // Defaults reflect the Claude Code / subscription (auth) limits: 200K
    // context and 32K max output. The API-only 1M/128K limits are plan-gated
    // and can be raised via /set or a profile (context-limit / maxOutputTokens).
    it('includes claude-opus-4-8 with 200K context / 32K output (auth default) in OAUTH_MODELS', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-8');
      expect(model).toBeDefined();
      expect(model?.name).toBe('Claude Opus 4.8');
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(32000);
    });

    it('includes claude-opus-4-7 with 200K context / 32K output (auth default) in OAUTH_MODELS', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-7');
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(32000);
    });

    it('includes claude-opus-4-8 and claude-opus-4-7 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-8')).toBe(true);
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-7')).toBe(true);
    });

    it('retains claude-opus-4-6 with 200K context / 32K output (auth default)', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-6');
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(32000);
    });
  });

  describe('isOpus46Plus', () => {
    it('returns true for opus 4.6, 4.7, and 4.8', () => {
      expect(isOpus46Plus('claude-opus-4-6')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-7')).toBe(true);
      expect(isOpus46Plus('claude-opus-4-8')).toBe(true);
    });

    it('returns true for the claude-opus-4-latest alias (tracks newest Opus)', () => {
      expect(isOpus46Plus('claude-opus-4-latest')).toBe(true);
    });

    it('returns false for older opus and non-opus models', () => {
      expect(isOpus46Plus('claude-opus-4-1-20250805')).toBe(false);
      expect(isOpus46Plus('claude-sonnet-4-6')).toBe(false);
      expect(isOpus46Plus('gpt-5.5')).toBe(false);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 32000 (auth default) for opus 4.6, 4.7, and 4.8', () => {
      expect(getMaxTokensForModel('claude-opus-4-8')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-4-7')).toBe(32000);
      expect(getMaxTokensForModel('claude-opus-4-6')).toBe(32000);
    });

    it('returns 32000 (auth default) for the claude-opus-4-latest alias', () => {
      expect(getMaxTokensForModel('claude-opus-4-latest')).toBe(32000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 (auth default) for opus 4.6, 4.7, and 4.8', () => {
      expect(getContextWindowForModel('claude-opus-4-8')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-4-7')).toBe(200000);
      expect(getContextWindowForModel('claude-opus-4-6')).toBe(200000);
    });

    it('returns 200000 (auth default) for the claude-opus-4-latest alias', () => {
      expect(getContextWindowForModel('claude-opus-4-latest')).toBe(200000);
    });
  });
});

describe('AnthropicModelData Claude Sonnet 5 @issue:2289', () => {
  describe('catalog entries', () => {
    // Context window reflects the Claude Code / subscription (auth) 200K
    // default; the advertised 1M window is API-only/plan-gated. Max output
    // is the full 128K ceiling.
    it('includes claude-sonnet-5 with 200K context / 128K output in OAUTH_MODELS', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-sonnet-5');
      expect(model).toBeDefined();
      expect(model?.name).toBe('Claude Sonnet 5');
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(128000);
    });

    it('includes claude-sonnet-5 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-sonnet-5')).toBe(true);
    });
  });

  describe('isSonnet5', () => {
    it('returns true for claude-sonnet-5 and dated snapshot variants', () => {
      expect(isSonnet5('claude-sonnet-5')).toBe(true);
      expect(isSonnet5('claude-sonnet-5-20260630')).toBe(true);
      expect(isSonnet5('claude-sonnet-5-latest')).toBe(true);
    });

    it('returns false for sonnet 4 and non-sonnet models', () => {
      expect(isSonnet5('claude-sonnet-4-6')).toBe(false);
      expect(isSonnet5('claude-opus-4-8')).toBe(false);
      expect(isSonnet5('gpt-5.5')).toBe(false);
    });
  });

  describe('supportsAdaptiveThinking', () => {
    it('returns true for Opus 4.6+ and Sonnet 5', () => {
      expect(supportsAdaptiveThinking('claude-opus-4-6')).toBe(true);
      expect(supportsAdaptiveThinking('claude-opus-4-8')).toBe(true);
      expect(supportsAdaptiveThinking('claude-sonnet-5')).toBe(true);
      expect(supportsAdaptiveThinking('claude-sonnet-5-20260630')).toBe(true);
    });

    it('returns false for models without adaptive thinking', () => {
      expect(supportsAdaptiveThinking('claude-sonnet-4-6')).toBe(false);
      expect(supportsAdaptiveThinking('claude-opus-4-5')).toBe(false);
    });
  });

  describe('getMaxTokensForModel', () => {
    it('returns 128000 for claude-sonnet-5, the -latest alias, and dated variants', () => {
      expect(getMaxTokensForModel('claude-sonnet-5')).toBe(128000);
      expect(getMaxTokensForModel('claude-sonnet-5-latest')).toBe(128000);
      expect(getMaxTokensForModel('claude-sonnet-5-20260630')).toBe(128000);
    });

    it('is case-insensitive (routes through isSonnet5)', () => {
      expect(getMaxTokensForModel('Claude-Sonnet-5')).toBe(128000);
    });

    it('still returns 64000 for claude-sonnet-4 models', () => {
      expect(getMaxTokensForModel('claude-sonnet-4-6')).toBe(64000);
      expect(getMaxTokensForModel('claude-sonnet-4-5-20250929')).toBe(64000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 200000 (auth default) for claude-sonnet-5, the -latest alias, and dated variants', () => {
      expect(getContextWindowForModel('claude-sonnet-5')).toBe(200000);
      expect(getContextWindowForModel('claude-sonnet-5-latest')).toBe(200000);
      expect(getContextWindowForModel('claude-sonnet-5-20260630')).toBe(200000);
    });

    it('is case-insensitive (routes through isSonnet5)', () => {
      expect(getContextWindowForModel('Claude-Sonnet-5')).toBe(200000);
    });

    it('still returns 400000 for claude-sonnet-4 models', () => {
      expect(getContextWindowForModel('claude-sonnet-4-6')).toBe(400000);
    });
  });

  describe('getLatestClaudeModel', () => {
    it('returns the Sonnet 5 latest alias for the sonnet tier', () => {
      expect(getLatestClaudeModel('sonnet')).toBe('claude-sonnet-5-latest');
    });

    it('defaults to the sonnet tier', () => {
      expect(getLatestClaudeModel()).toBe('claude-sonnet-5-latest');
    });

    it('returns the Opus latest alias for the opus tier', () => {
      expect(getLatestClaudeModel('opus')).toBe('claude-opus-4-latest');
    });
  });
});
