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
    it('includes claude-opus-4-8 with 1M context / 128K output in OAUTH_MODELS', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-8');
      expect(model).toBeDefined();
      expect(model?.name).toBe('Claude Opus 4.8');
      expect(model?.contextWindow).toBe(1000000);
      expect(model?.maxOutputTokens).toBe(128000);
    });

    it('includes claude-opus-4-7 with 1M context / 128K output in OAUTH_MODELS', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-7');
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(1000000);
      expect(model?.maxOutputTokens).toBe(128000);
    });

    it('includes claude-opus-4-8 and claude-opus-4-7 in DEFAULT_MODELS', () => {
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-8')).toBe(true);
      expect(DEFAULT_MODELS.some((m) => m.id === 'claude-opus-4-7')).toBe(true);
    });

    it('retains claude-opus-4-6 with 200K context / 128K output', () => {
      const model = OAUTH_MODELS.find((m) => m.id === 'claude-opus-4-6');
      expect(model).toBeDefined();
      expect(model?.contextWindow).toBe(200000);
      expect(model?.maxOutputTokens).toBe(128000);
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
    it('returns 128000 for opus 4.6, 4.7, and 4.8', () => {
      expect(getMaxTokensForModel('claude-opus-4-8')).toBe(128000);
      expect(getMaxTokensForModel('claude-opus-4-7')).toBe(128000);
      expect(getMaxTokensForModel('claude-opus-4-6')).toBe(128000);
    });

    it('returns 128000 for the claude-opus-4-latest alias', () => {
      expect(getMaxTokensForModel('claude-opus-4-latest')).toBe(128000);
    });
  });

  describe('getContextWindowForModel', () => {
    it('returns 1000000 for opus 4.7 and 4.8', () => {
      expect(getContextWindowForModel('claude-opus-4-8')).toBe(1000000);
      expect(getContextWindowForModel('claude-opus-4-7')).toBe(1000000);
    });

    it('returns 1000000 for the claude-opus-4-latest alias (tracks newest Opus)', () => {
      expect(getContextWindowForModel('claude-opus-4-latest')).toBe(1000000);
    });

    it('returns 200000 for opus 4.6 (distinct from 4.7/4.8)', () => {
      expect(getContextWindowForModel('claude-opus-4-6')).toBe(200000);
    });
  });
});
