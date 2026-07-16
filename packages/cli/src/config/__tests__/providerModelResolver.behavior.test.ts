/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the unconfigured-provider state (#2481).
 *
 * Verifies resolveProviderAndModel returns `undefined` for the provider when
 * no provider is configured via CLI, profile, or environment — and that
 * explicit Gemini configurations still resolve correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core';
import { resolveProviderAndModel } from '../providerModelResolver.js';
import { loadProviderAliasEntries } from '@vybestack/llxprt-code-providers/composition.js';

vi.mock('@vybestack/llxprt-code-providers/composition.js', () => ({
  loadProviderAliasEntries: vi.fn(() => []),
}));

describe('resolveProviderAndModel: unconfigured state (#2481)', () => {
  it('returns undefined provider when no CLI/profile/env provider is set', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBeUndefined();
  });

  it('returns empty model when no provider or model is configured', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.model).toBe('');
  });

  it('returns undefined provider when profileProvider is empty string', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: '',
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBeUndefined();
  });

  it('returns undefined provider when profileProvider is whitespace', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: '   ',
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBeUndefined();
  });
});

describe('resolveProviderAndModel: explicit provider precedence (#2481)', () => {
  it('resolves CLI provider when set', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'openai',
      profileProvider: 'anthropic',
      envDefaultProvider: 'gemini',
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('openai');
  });

  it('resolves profile provider when no CLI provider', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: 'anthropic',
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('anthropic');
  });

  it('resolves env provider when no CLI or profile provider', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: 'ollama',
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('ollama');
  });
});

describe('resolveProviderAndModel: explicit Gemini unchanged (#2481)', () => {
  it('resolves gemini when set via CLI with DEFAULT_GEMINI_MODEL', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('resolves gemini when set via env', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: 'gemini',
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('resolves GEMINI_MODEL env when gemini provider is explicit', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: 'gemini-2.5-flash',
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
  });
});

describe('resolveProviderAndModel: consistent trimming of all provider sources (#2481)', () => {
  it('trims whitespace from cliProvider', () => {
    const result = resolveProviderAndModel({
      cliProvider: '  openai  ',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('openai');
  });

  it('trims whitespace from envDefaultProvider', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: '  ollama  ',
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('ollama');
  });

  it('treats whitespace-only cliProvider as absent (falls through to next source)', () => {
    const result = resolveProviderAndModel({
      cliProvider: '   ',
      profileProvider: 'anthropic',
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('anthropic');
  });

  it('treats whitespace-only envDefaultProvider as absent', () => {
    const result = resolveProviderAndModel({
      cliProvider: undefined,
      profileProvider: undefined,
      envDefaultProvider: '   ',
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBeUndefined();
  });
});

describe('resolveProviderAndModel: model precedence (#2481)', () => {
  it('CLI model wins over profile model', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: 'cli-model',
      profileModel: 'profile-model',
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.model).toBe('cli-model');
  });

  it('profile model wins over settings model', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: 'profile-model',
      settingsModel: 'settings-model',
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.model).toBe('profile-model');
  });

  it('settings model wins over envDefaultModel', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: 'settings-model',
      envDefaultModel: 'env-model',
      envGeminiModel: undefined,
    });
    expect(result.model).toBe('settings-model');
  });
});

describe('resolveProviderAndModel: explicit non-Gemini provider with no model (#2481)', () => {
  it('returns empty model when a non-Gemini provider is set with no model source', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'openai',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('');
  });

  it('returns empty model when anthropic provider is set with no model source', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'anthropic',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('');
  });
});

describe('resolveProviderAndModel: envGeminiModel must not leak to non-Gemini (#2481)', () => {
  it('does NOT use envGeminiModel when provider is openai', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'openai',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: 'gemini-2.5-flash',
    });
    expect(result.provider).toBe('openai');
    expect(result.model).not.toBe('gemini-2.5-flash');
    expect(result.model).toBe('');
  });

  it('does NOT use envGeminiModel when provider is anthropic', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'anthropic',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: 'gemini-2.5-flash',
    });
    expect(result.provider).toBe('anthropic');
    expect(result.model).not.toBe('gemini-2.5-flash');
  });

  it('DOES use envGeminiModel when provider IS gemini', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: 'gemini-2.5-flash',
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
  });
});

describe('resolveProviderAndModel: whitespace model sources treated as absent (#2481)', () => {
  it('treats whitespace-only cliModel as absent', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: '   ',
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('treats whitespace-only profileModel as absent', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: '  ',
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('treats whitespace-only settingsModel as absent', () => {
    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: '   ',
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('resolveProviderAndModel: alias default model preserved (#2481)', () => {
  it('falls back to alias default model for a non-gemini provider with no explicit model', () => {
    vi.mocked(loadProviderAliasEntries).mockReturnValue([
      {
        alias: 'myalias',
        config: {
          baseProvider: 'openai',
          defaultModel: 'alias-default-model',
        },
        filePath: '/test/providers/myalias.json',
        source: 'user',
      },
    ]);

    const result = resolveProviderAndModel({
      cliProvider: 'myalias',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('myalias');
    expect(result.model).toBe('alias-default-model');
  });

  it('prefers an explicit provider alias default over an unrelated environment model', () => {
    vi.mocked(loadProviderAliasEntries).mockReturnValue([
      {
        alias: 'myalias',
        config: {
          baseProvider: 'openai',
          defaultModel: 'alias-default-model',
        },
        filePath: '/test/providers/myalias.json',
        source: 'user',
      },
    ]);

    const result = resolveProviderAndModel({
      cliProvider: 'myalias',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: 'unrelated-environment-model',
      envGeminiModel: undefined,
    });
    expect(result.provider).toBe('myalias');
    expect(result.model).toBe('alias-default-model');
  });

  it('treats a canonical provider entry as a provider default, not an explicit alias default', () => {
    vi.mocked(loadProviderAliasEntries).mockReturnValue([
      {
        alias: 'gemini',
        config: {
          baseProvider: 'gemini',
          defaultModel: DEFAULT_GEMINI_MODEL,
        },
        filePath: '/test/providers/gemini.json',
        source: 'builtin',
      },
    ]);

    const result = resolveProviderAndModel({
      cliProvider: 'gemini',
      profileProvider: undefined,
      envDefaultProvider: undefined,
      cliModel: undefined,
      profileModel: undefined,
      settingsModel: undefined,
      envDefaultModel: undefined,
      envGeminiModel: 'gemini-environment-model',
    });
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-environment-model');
  });
});
