/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { tokenLimit, DEFAULT_TOKEN_LIMIT } from './tokenLimits.js';

describe('tokenLimit', () => {
  describe('Gemini models', () => {
    it('should return correct limit for gemini-1.5-pro', () => {
      expect(tokenLimit('gemini-1.5-pro')).toBe(2_097_152);
    });

    it('should return correct limit for gemini-1.5-flash', () => {
      expect(tokenLimit('gemini-1.5-flash')).toBe(1_048_576);
    });

    it('should return correct limit for gemini-2.0-flash', () => {
      expect(tokenLimit('gemini-2.0-flash')).toBe(1_048_576);
    });
  });

  describe('OpenAI models', () => {
    it('should return correct limit for o3', () => {
      expect(tokenLimit('o3')).toBe(200_000);
    });

    it('should return correct limit for o3-mini', () => {
      expect(tokenLimit('o3-mini')).toBe(200_000);
    });

    it('should return correct limit for o4-mini', () => {
      expect(tokenLimit('o4-mini')).toBe(128_000);
    });

    it('should return correct limit for gpt-4.1', () => {
      expect(tokenLimit('gpt-4.1')).toBe(1_000_000);
    });

    it('should return correct limit for gpt-4o', () => {
      expect(tokenLimit('gpt-4o')).toBe(128_000);
    });

    it('should return correct limit for gpt-4o-mini', () => {
      expect(tokenLimit('gpt-4o-mini')).toBe(128_000);
    });

    it('should return correct limit for o1', () => {
      expect(tokenLimit('o1')).toBe(200_000);
    });

    it('should return correct limit for o1-mini', () => {
      expect(tokenLimit('o1-mini')).toBe(200_000);
    });
  });

  describe('Anthropic models', () => {
    // Opus 4.6/4.7/4.8 default to the Claude Code / subscription 200K context
    // window. The API-only 1M window is plan-gated and can be raised via /set
    // or a profile (context-limit).
    it('should return 200K (auth default) limit for claude-opus-4-8', () => {
      expect(tokenLimit('claude-opus-4-8')).toBe(200_000);
    });

    it('should return 200K (auth default) limit for claude-opus-4-7', () => {
      expect(tokenLimit('claude-opus-4-7')).toBe(200_000);
    });

    it('should return 200K (auth default) limit for claude-opus-4-latest', () => {
      expect(tokenLimit('claude-opus-4-latest')).toBe(200_000);
    });

    it('should return 200K limit for claude-opus-4-6', () => {
      expect(tokenLimit('claude-opus-4-6')).toBe(200_000);
    });

    it('should return 200K limit for claude-sonnet-4-6', () => {
      expect(tokenLimit('claude-sonnet-4-6')).toBe(200_000);
    });

    // Claude Sonnet 5 defaults to the Claude Code / subscription 200K context
    // window. The advertised 1M window is API-only and plan-gated; override
    // via /set or a profile (context-limit).
    it('should return 200K (auth default) limit for claude-sonnet-5', () => {
      expect(tokenLimit('claude-sonnet-5')).toBe(200_000);
    });

    it('honors a user-supplied context limit override (e.g. /set or profile)', () => {
      expect(tokenLimit('claude-opus-4-8', 1_000_000)).toBe(1_000_000);
    });

    it('honors a user-supplied context limit override for claude-sonnet-5', () => {
      expect(tokenLimit('claude-sonnet-5', 1_000_000)).toBe(1_000_000);
    });
  });

  describe('Codex (gpt-5.x) models', () => {
    it('should return 256K limit for gpt-5.3-codex', () => {
      expect(tokenLimit('gpt-5.3-codex')).toBe(262_144);
    });

    it('should return 128K limit for gpt-5.3-codex-spark (smaller window)', () => {
      expect(tokenLimit('gpt-5.3-codex-spark')).toBe(131_072);
    });

    it('should return 256K limit for gpt-5.2-codex', () => {
      expect(tokenLimit('gpt-5.2-codex')).toBe(262_144);
    });

    it('should return 256K limit for gpt-5.1-codex', () => {
      expect(tokenLimit('gpt-5.1-codex')).toBe(262_144);
    });

    it('should return 256K limit for gpt-5.1-codex-max', () => {
      expect(tokenLimit('gpt-5.1-codex-max')).toBe(262_144);
    });

    it('should return 256K limit for gpt-5.1-codex-mini', () => {
      expect(tokenLimit('gpt-5.1-codex-mini')).toBe(262_144);
    });

    it('should handle codex provider prefix', () => {
      expect(tokenLimit('codex:gpt-5.3-codex')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.3-codex-spark')).toBe(131_072);
    });

    it('should return 256K for codex-prefixed non-suffixed models', () => {
      // These IDs contain no "codex" substring, so only the provider prefix
      // can identify them as Codex models (per composition/aliases/codex.config).
      expect(tokenLimit('codex:gpt-5.5')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.4')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.2')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.1')).toBe(262_144);
    });

    it('should treat bare non-suffixed gpt-5.x IDs as ambiguous (default)', () => {
      // Without the codex provider prefix, a bare "gpt-5.5" could be either
      // a regular OpenAI or a Codex model, so it must fall through to the
      // default rather than assume the 256K Codex window.
      expect(tokenLimit('gpt-5.5')).toBe(DEFAULT_TOKEN_LIMIT);
      expect(tokenLimit('gpt-5.4')).toBe(DEFAULT_TOKEN_LIMIT);
      expect(tokenLimit('openai:gpt-5.5')).toBe(DEFAULT_TOKEN_LIMIT);
    });

    it('honors a user-supplied context limit override for codex models', () => {
      expect(tokenLimit('gpt-5.3-codex', 500_000)).toBe(500_000);
    });
  });

  describe('Default behavior', () => {
    it('should return default limit for unknown models', () => {
      expect(tokenLimit('unknown-model')).toBe(DEFAULT_TOKEN_LIMIT);
    });

    it('should return default limit for empty string', () => {
      expect(tokenLimit('')).toBe(DEFAULT_TOKEN_LIMIT);
    });
  });

  describe('Provider-prefixed models', () => {
    it('should handle OpenAI provider prefix', () => {
      expect(tokenLimit('openai:gpt-4o')).toBe(128_000);
      expect(tokenLimit('openai:gpt-4o-mini')).toBe(128_000);
      expect(tokenLimit('openai:o1')).toBe(200_000);
    });

    it('should handle Gemini provider prefix', () => {
      expect(tokenLimit('gemini:gemini-1.5-pro')).toBe(2_097_152);
      expect(tokenLimit('gemini:gemini-1.5-flash')).toBe(1_048_576);
    });
  });
});
