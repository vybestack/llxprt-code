/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';

import { loadProviderAliasEntries } from './providerAliases.js';

describe('Built-in provider alias (CheaperInference)', () => {
  const builtinEntries = loadProviderAliasEntries().filter(
    (entry) => entry.source === 'builtin',
  );
  const cheaperInferenceEntry = builtinEntries.find(
    (candidate) => candidate.alias === 'CheaperInference',
  );

  it('cheaperinference alias is registered as a builtin', () => {
    expect(cheaperInferenceEntry).toBeDefined();
  });

  it('has correct base-url pointing to the Cheaper Inference API', () => {
    expect(cheaperInferenceEntry?.config['base-url']).toBe(
      'https://api.cheaperinference.com/v1',
    );
  });

  it('uses openai as the base provider', () => {
    expect(cheaperInferenceEntry?.config.baseProvider).toBe('openai');
  });

  it('reads CHEAPER_INFERENCE_API_KEY env var for auth', () => {
    expect(cheaperInferenceEntry?.config.apiKeyEnv).toBe(
      'CHEAPER_INFERENCE_API_KEY',
    );
  });

  it('defaults to gpt-5.4-mini', () => {
    expect(cheaperInferenceEntry?.config.defaultModel).toBe('gpt-5.4-mini');
  });

  it('does not map to a models.dev provider', () => {
    expect(cheaperInferenceEntry?.config.modelsDevProviderId).toBeNull();
  });

  it('has a human-readable name', () => {
    expect(cheaperInferenceEntry?.config.name).toBe('CheaperInference');
  });

  it('has a description', () => {
    expect(cheaperInferenceEntry?.config.description).toBeDefined();
    expect(cheaperInferenceEntry?.config.description?.length).toBeGreaterThan(
      0,
    );
  });
});
