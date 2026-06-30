/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test proving the `/provider codex` alias returns its model list
 * from codex.config staticModels via the alias factory — NOT from a hardcoded
 * fallback in the base provider.
 *
 * @issue #2272 — CODEX_MODELS.ts was deleted; codex.config is the single
 * source of truth for Codex models.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// This test needs real config files, not the global mock
vi.unmock('./providerAliases.js');

import { loadProviderAliasEntries } from './providerAliases.js';
import { createOpenAIResponsesAliasProvider } from './aliasProviderFactory.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { ProviderAliasEntry } from './providerAliases.js';

const NULL_OAUTH_MANAGER: OAuthManager = {
  getToken: async () => null,
  isAuthenticated: async () => false,
};

function buildCodexEntry(): ProviderAliasEntry {
  const entries = loadProviderAliasEntries();
  const codexEntry = entries.find((e) => e.alias === 'codex');
  if (!codexEntry) {
    throw new Error('codex alias entry not found');
  }
  return codexEntry;
}

function buildCodexProvider() {
  const provider = createOpenAIResponsesAliasProvider(
    buildCodexEntry(),
    'irrelevant-api-key',
    undefined,
    {},
    NULL_OAUTH_MANAGER,
  );
  if (!provider) {
    throw new Error('codex alias provider not created');
  }
  return provider;
}

describe('codex alias factory getModels (@issue:2272)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns staticModels from codex.config exactly, in order', async () => {
    const entry = buildCodexEntry();
    const provider = buildCodexProvider();

    const models = await provider.getModels();
    const staticModels = entry.config.staticModels ?? [];

    expect(models.map((m) => m.id)).toStrictEqual(
      staticModels.map((m) => m.id),
    );
  });

  it('reports provider name as codex and supportedToolFormats as [openai]', async () => {
    const provider = buildCodexProvider();

    const models = await provider.getModels();

    for (const model of models) {
      expect(model.provider).toBe('codex');
      expect(model.supportedToolFormats).toStrictEqual(['openai']);
    }
  });

  it('preserves contextWindow for gpt-5.3-codex-spark from staticModels', async () => {
    const entry = buildCodexEntry();
    const provider = buildCodexProvider();
    const expectedSpark = entry.config.staticModels?.find(
      (m) => m.id === 'gpt-5.3-codex-spark',
    );
    expect(expectedSpark).toBeDefined();

    const models = await provider.getModels();
    const spark = models.find((m) => m.id === 'gpt-5.3-codex-spark');

    expect(spark).toBeDefined();
    expect(spark?.contextWindow).toBe(expectedSpark?.contextWindow);
  });

  it('does not call fetch (static models, no network)', async () => {
    const provider = buildCodexProvider();

    await provider.getModels();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
