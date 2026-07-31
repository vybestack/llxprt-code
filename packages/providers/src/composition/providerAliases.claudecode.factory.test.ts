/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test proving the `/provider claudecode` alias:
 * - Resolves to base provider `anthropic` at https://api.anthropic.com (A1)
 * - Returns its model list from claudecode.config staticModels (A2)
 * - Retains subscription models except retired Opus 4.1 entries (A3)
 * - Receives the OAuth manager/identity; `anthropic` receives none (A7)
 *
 * @issue #2274 — Split Claude Code OAuth from Anthropic API-key access
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the Anthropic SDK at the HTTP boundary so the real alias factory +
// AnthropicProvider can exercise the dynamic /models listing path without a
// network call. We capture the constructor args to prove API-key wiring.
const mockBetaModelsList = vi.hoisted(() => vi.fn());
const sdkConstructorCalls = vi.hoisted<
  Array<{ apiKey?: string; authToken?: string }>
>(() => []);

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    sdkConstructorCalls.push({
      apiKey: opts.apiKey as string | undefined,
      authToken: opts.authToken as string | undefined,
    });
    return {
      messages: { create: vi.fn() },
      beta: {
        models: {
          list: mockBetaModelsList.mockReturnValue({
            async *[Symbol.asyncIterator]() {
              yield { id: 'claude-dynamic-test', display_name: 'Dynamic Test' };
            },
          }),
        },
      },
    };
  }),
}));

import { loadProviderAliasEntries } from './providerAliases.js';
import { createAnthropicAliasProvider } from './aliasProviderFactory.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { ProviderAliasEntry } from './providerAliases.js';

// Literal accepted ordered static-model catalog from claudecode.config. Every
// entry's id, contextWindow, and maxOutputTokens is asserted so any catalog
// drift (retired models, geometry changes) is caught here.
const EXPECTED_CLAUDECODE_CATALOG = [
  { id: 'claude-opus-5', contextWindow: 1000000, maxOutputTokens: 128000 },
  { id: 'claude-fable-5', contextWindow: 1000000, maxOutputTokens: 128000 },
  { id: 'claude-opus-4-8', contextWindow: 1000000, maxOutputTokens: 128000 },
  { id: 'claude-opus-4-7', contextWindow: 1000000, maxOutputTokens: 128000 },
  { id: 'claude-opus-4-6', contextWindow: 1000000, maxOutputTokens: 128000 },
  {
    id: 'claude-opus-4-5-20251101',
    contextWindow: 500000,
    maxOutputTokens: 32000,
  },
  { id: 'claude-opus-4-5', contextWindow: 500000, maxOutputTokens: 32000 },
  { id: 'claude-sonnet-5', contextWindow: 1000000, maxOutputTokens: 128000 },
  { id: 'claude-sonnet-4-6', contextWindow: 1000000, maxOutputTokens: 128000 },
  {
    id: 'claude-sonnet-4-5-20250929',
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  { id: 'claude-sonnet-4-5', contextWindow: 400000, maxOutputTokens: 64000 },
  {
    id: 'claude-sonnet-4-20250514',
    contextWindow: 400000,
    maxOutputTokens: 64000,
  },
  { id: 'claude-sonnet-4', contextWindow: 400000, maxOutputTokens: 64000 },
  {
    id: 'claude-haiku-4-5-20251001',
    contextWindow: 500000,
    maxOutputTokens: 16000,
  },
  { id: 'claude-haiku-4-5', contextWindow: 500000, maxOutputTokens: 16000 },
] as const;

const STUB_OAUTH_MANAGER: OAuthManager = {
  getToken: async () => null,
  isAuthenticated: async () => false,
} as unknown as OAuthManager;

function findAliasEntry(alias: string): ProviderAliasEntry {
  const entries = loadProviderAliasEntries();
  const entry = entries.find((e) => e.alias === alias);
  if (!entry) {
    throw new Error(`${alias} alias entry not found`);
  }
  return entry;
}

describe('claudecode alias config (@issue:2274)', () => {
  it('resolves to base provider anthropic at https://api.anthropic.com (A1)', () => {
    const entry = findAliasEntry('claudecode');

    expect(entry.config.baseProvider).toBe('anthropic');
    expect(entry.config['base-url']).toBe('https://api.anthropic.com');
  });

  it('has a defaultModel consistent with the current catalog (A1)', () => {
    const entry = findAliasEntry('claudecode');

    expect(entry.config.defaultModel).toBe('claude-opus-5');
  });

  it('does not declare an apiKeyEnv (OAuth-only identity) (A7)', () => {
    const entry = findAliasEntry('claudecode');

    expect(entry.config.apiKeyEnv).toBeUndefined();
  });
});

describe('claudecode alias static models (@issue:2274)', () => {
  it('exposes config-owned staticModels rather than calling /models (A2)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );
    expect(provider).not.toBeNull();

    const models = await provider!.getModels();

    const staticIds = (entry.config.staticModels ?? []).map((m) => m.id);
    expect(models.map((m) => m.id)).toStrictEqual(staticIds);
  });

  it('serves the exact accepted ordered static-model ID catalog and geometry (A3)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );
    expect(provider).not.toBeNull();

    const models = await provider!.getModels();

    const actualGeometry = models.map((m) => ({
      id: m.id,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    }));

    expect(actualGeometry).toStrictEqual(
      EXPECTED_CLAUDECODE_CATALOG.map((e) => ({ ...e })),
    );
  });

  it('includes claude-sonnet-4-20250514 and claude-fable-5 (A3)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );

    const models = await provider!.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).toContain('claude-sonnet-4-20250514');
    expect(ids).toContain('claude-fable-5');
  });

  it('does NOT include retired claude-opus-4-1 or claude-opus-4-1-20250805 (A3)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );

    const models = await provider!.getModels();
    const ids = models.map((m) => m.id);

    expect(ids).not.toContain('claude-opus-4-1');
    expect(ids).not.toContain('claude-opus-4-1-20250805');
  });

  it('reports provider name as claudecode and supportedToolFormats as [anthropic] (A1)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );

    expect(provider!.name).toBe('claudecode');

    const models = await provider!.getModels();
    for (const model of models) {
      expect(model.provider).toBe('claudecode');
      expect(model.supportedToolFormats).toStrictEqual(['anthropic']);
    }
  });
});

describe('real alias binding/behavior: claudecode OAuth vs anthropic API-key (@issue:2274 A7)', () => {
  beforeEach(() => {
    sdkConstructorCalls.length = 0;
    mockBetaModelsList.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('claudecode serves static models and binds the claudecode OAuth identity (A4/A7)', async () => {
    const entry = findAliasEntry('claudecode');
    const provider = createAnthropicAliasProvider(
      entry,
      STUB_OAUTH_MANAGER,
      true,
    );
    expect(provider).toBeInstanceOf(AnthropicProvider);

    const models = await provider!.getModels();
    const ids = models.map((m) => m.id);

    // Static catalog is served; the dynamic /models endpoint is never called.
    expect(sdkConstructorCalls).toHaveLength(0);
    expect(ids).toStrictEqual(EXPECTED_CLAUDECODE_CATALOG.map((e) => e.id));

    // The concrete AnthropicProvider instance carries the claudecode OAuth
    // identity binding established by the alias factory.
    const baseConfig = (
      provider as unknown as {
        baseProviderConfig: { oauthProvider?: string; name?: string };
      }
    ).baseProviderConfig;
    expect(baseConfig.oauthProvider).toBe('claudecode');
    expect(baseConfig.name).toBe('claudecode');
  });

  it('anthropic dynamically lists with an API key without requesting a Claude OAuth token (A7)', async () => {
    const entry = findAliasEntry('anthropic');
    // The anthropic alias must be constructed WITHOUT an OAuth manager so it
    // remains API-key-only and has no bound OAuth identity.
    const provider = createAnthropicAliasProvider(entry, undefined, false);
    expect(provider).toBeInstanceOf(AnthropicProvider);

    // Resolve an API key through the real provider's auth path so getModels()
    // exercises the dynamic endpoint. This proves the alias is API-key-capable.
    const apiKey = 'sk-test-anthropic-api-key';
    vi.spyOn(provider as never, 'getAuthToken').mockResolvedValue(apiKey);

    const models = await provider!.getModels();
    const ids = models.map((m) => m.id);

    // The dynamic models endpoint was hit and its response mapped.
    expect(sdkConstructorCalls).toHaveLength(1);
    expect(sdkConstructorCalls[0]?.apiKey).toBe(apiKey);
    expect(sdkConstructorCalls[0]?.authToken).toBeUndefined();
    expect(ids).toContain('claude-dynamic-test');
    // Static catalog is NOT served by the anthropic alias.
    expect(ids).not.toContain('claude-fable-5');

    // No OAuth identity is bound to the API-key-only anthropic alias.
    const baseConfig = (
      provider as unknown as {
        baseProviderConfig: { oauthProvider?: string; name?: string };
      }
    ).baseProviderConfig;
    expect(baseConfig.oauthProvider).toBeUndefined();
    expect(baseConfig.name).toBe('anthropic');
  });

  it('does not declare an apiKeyEnv on claudecode but does on anthropic (A7)', () => {
    const claudecode = findAliasEntry('claudecode');
    const anthropic = findAliasEntry('anthropic');

    expect(claudecode.config.apiKeyEnv).toBeUndefined();
    expect(anthropic.config.apiKeyEnv).toBe('ANTHROPIC_API_KEY');
  });
});
