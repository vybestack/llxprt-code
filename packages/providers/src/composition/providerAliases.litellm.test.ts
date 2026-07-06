/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';

describe('Built-in provider alias (LiteLLM)', () => {
  const builtinEntries = loadProviderAliasEntries().filter(
    (entry) => entry.source === 'builtin',
  );
  const litellmEntry = builtinEntries.find(
    (candidate) => candidate.alias === 'LiteLLM',
  );

  it('litellm alias is registered as a builtin', () => {
    expect(litellmEntry).toBeDefined();
  });

  it('has correct base-url pointing to default LiteLLM proxy', () => {
    expect(litellmEntry?.config['base-url']).toBe('http://127.0.0.1:4000/v1/');
  });

  it('uses openai as the base provider', () => {
    expect(litellmEntry?.config.baseProvider).toBe('openai');
  });

  it('reads LITELLM_API_KEY env var for auth', () => {
    expect(litellmEntry?.config.apiKeyEnv).toBe('LITELLM_API_KEY');
  });

  it('has a default model set', () => {
    expect(litellmEntry?.config.defaultModel).toBeDefined();
    expect(typeof litellmEntry?.config.defaultModel).toBe('string');
    expect(litellmEntry?.config.defaultModel?.length).toBeGreaterThan(0);
  });

  it('has a human-readable name', () => {
    expect(litellmEntry?.config.name).toBe('LiteLLM');
  });

  it('has a description', () => {
    expect(litellmEntry?.config.description).toBeDefined();
    expect(litellmEntry?.config.description?.length).toBeGreaterThan(0);
  });

  it('has a sandbox-base-url for Docker environments', () => {
    expect(litellmEntry?.config['sandbox-base-url']).toBe(
      'http://host.docker.internal:4000/v1/',
    );
  });
});
