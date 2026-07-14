/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  tokenLimit,
  DEFAULT_TOKEN_LIMIT,
  resolveEffectiveContextLimit,
} from './tokenLimits.js';

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

    it('should return 200K limit for the claude-sonnet-5-latest alias', () => {
      expect(tokenLimit('claude-sonnet-5-latest')).toBe(200_000);
    });

    it('should return 200K limit for a claude-sonnet-5 dated snapshot', () => {
      expect(tokenLimit('claude-sonnet-5-20260630')).toBe(200_000);
    });

    // Claude Fable 5 defaults to the Claude Code / subscription 200K context
    // window. The advertised 1M window is API-only and plan-gated; override
    // via /set or a profile (context-limit).
    it('should return 200K (auth default) limit for claude-fable-5', () => {
      expect(tokenLimit('claude-fable-5')).toBe(200_000);
    });

    it('should return 200K limit for the claude-fable-5-latest alias', () => {
      expect(tokenLimit('claude-fable-5-latest')).toBe(200_000);
    });

    it('should return 200K limit for a claude-fable-5 dated snapshot', () => {
      expect(tokenLimit('claude-fable-5-20260701')).toBe(200_000);
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
      expect(tokenLimit('codex:gpt-5.6')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.6-sol')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.6-terra')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.6-luna')).toBe(262_144);
      expect(tokenLimit('codex:gpt-5.7-sol')).toBe(262_144);
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

  describe('GLM (z.ai) models', () => {
    it('should return 200K for glm-5.2', () => {
      expect(tokenLimit('glm-5.2')).toBe(200_000);
    });

    it('should return 200K for glm-5.1', () => {
      expect(tokenLimit('glm-5.1')).toBe(200_000);
    });

    it('should return 200K for glm-5', () => {
      expect(tokenLimit('glm-5')).toBe(200_000);
    });

    it('should return 200K for future/dated glm-5 variants via prefix', () => {
      expect(tokenLimit('glm-5.3')).toBe(200_000);
      expect(tokenLimit('glm-5-air')).toBe(200_000);
    });

    it('should return 128K for glm-4.6', () => {
      expect(tokenLimit('glm-4.6')).toBe(128_000);
    });

    it('should return 128K for glm-4.5', () => {
      expect(tokenLimit('glm-4.5')).toBe(128_000);
    });

    it('should return 128K for glm-4', () => {
      expect(tokenLimit('glm-4')).toBe(128_000);
    });

    it('should return 128K for future/dated glm-4 variants via prefix', () => {
      expect(tokenLimit('glm-4-plus')).toBe(128_000);
      expect(tokenLimit('glm-4-flash')).toBe(128_000);
    });

    it('should honor a user-supplied context limit override for glm-5.2', () => {
      expect(tokenLimit('glm-5.2', 150_000)).toBe(150_000);
    });
  });

  describe('Gemini variant prefix matching (issue #2527)', () => {
    it('should return 1M for gemini-2.0-flash-exp via prefix', () => {
      expect(tokenLimit('gemini-2.0-flash-exp')).toBe(1_048_576);
    });

    it('should still return 32K for the image-generation exact entry', () => {
      expect(tokenLimit('gemini-2.0-flash-preview-image-generation')).toBe(
        32_000,
      );
    });

    it('should return 1M for future gemini-2.5-pro previews via prefix', () => {
      expect(tokenLimit('gemini-2.5-pro-preview-07-07')).toBe(1_048_576);
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

describe('resolveEffectiveContextLimit', () => {
  it('prefers a positive user context limit over provider and model', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', 50_000, 200_000)).toBe(
      50_000,
    );
  });

  it('falls back to the provider limit when user limit is absent', () => {
    expect(
      resolveEffectiveContextLimit('load-balancer', undefined, 200_000),
    ).toBe(200_000);
  });

  it('falls back to the model lookup when neither override is set', () => {
    expect(resolveEffectiveContextLimit('gpt-4o')).toBe(128_000);
  });

  it('falls back to DEFAULT_TOKEN_LIMIT for an unrecognized model', () => {
    expect(resolveEffectiveContextLimit('unknown-model')).toBe(
      DEFAULT_TOKEN_LIMIT,
    );
  });

  it('ignores a non-positive user limit and uses the provider limit', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', 0, 200_000)).toBe(200_000);
  });

  it('ignores NaN and Infinity values', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', NaN, 200_000)).toBe(200_000);
    expect(resolveEffectiveContextLimit('gpt-4o', Infinity, 200_000)).toBe(
      200_000,
    );
    expect(resolveEffectiveContextLimit('gpt-4o', undefined, NaN)).toBe(
      128_000,
    );
    expect(resolveEffectiveContextLimit('gpt-4o', undefined, Infinity)).toBe(
      128_000,
    );
  });

  it('ignores a non-positive provider limit and uses the model lookup', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', undefined, 0)).toBe(128_000);
  });

  it('falls back to model default when both user and provider limits are invalid', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', 0, 0)).toBe(128_000);
    expect(resolveEffectiveContextLimit('gpt-4o', -1, NaN)).toBe(128_000);
    expect(resolveEffectiveContextLimit('gpt-4o', Infinity, Infinity)).toBe(
      128_000,
    );
  });

  it('uses an injected model resolver when no explicit limit is available', () => {
    const resolveTokenLimit = vi.fn(() => 64_000);

    expect(
      resolveEffectiveContextLimit(
        'custom-model',
        undefined,
        undefined,
        resolveTokenLimit,
      ),
    ).toBe(64_000);
    expect(resolveTokenLimit).toHaveBeenCalledWith('custom-model');
  });

  it('respects a user override that is larger than the model default', () => {
    expect(resolveEffectiveContextLimit('gpt-4o', 500_000, undefined)).toBe(
      500_000,
    );
  });
});
