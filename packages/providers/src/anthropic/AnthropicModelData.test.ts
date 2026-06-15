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
