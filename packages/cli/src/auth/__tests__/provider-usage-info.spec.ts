/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const {
  mockFetchAnthropicUsage,
  mockFetchCodexUsage,
  mockFetchGeminiQuota,
  mockGetSettingsService,
  mockSettingsServiceRef,
} = vi.hoisted(() => {
  const settingsServiceRef = { current: { get: vi.fn(() => false) } };
  return {
    mockFetchAnthropicUsage: vi.fn(),
    mockFetchCodexUsage: vi.fn(),
    mockFetchGeminiQuota: vi.fn(),
    mockGetSettingsService: vi.fn(() => settingsServiceRef.current),
    mockSettingsServiceRef: settingsServiceRef,
  };
});

vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual<
    typeof import('@vybestack/llxprt-code-core')
  >('@vybestack/llxprt-code-core');
  return {
    ...actual,
    fetchAnthropicUsage: mockFetchAnthropicUsage,
    fetchCodexUsage: mockFetchCodexUsage,
    fetchGeminiQuota: mockFetchGeminiQuota,
    getSettingsService: mockGetSettingsService,
  };
});

import {
  getAnthropicUsageInfo,
  getAllAnthropicUsageInfo,
  getAllCodexUsageInfo,
  getAllGeminiUsageInfo,
  getHigherPriorityAuth,
  isQwenCompatibleUrl,
} from '../provider-usage-info.js';
import type { TokenStore, OAuthToken } from '@vybestack/llxprt-code-core';
import { LoadedSettings } from '../../config/settings.js';
import type { Settings } from '../../config/settings.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenStore(
  overrides: Partial<TokenStore> = {},
): TokenStore & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    saveToken: vi.fn(),
    getToken: vi.fn().mockResolvedValue(null),
    removeToken: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue([]),
    listBuckets: vi.fn().mockResolvedValue([]),
    getBucketStats: vi.fn().mockResolvedValue(null),
    acquireRefreshLock: vi.fn().mockResolvedValue(true),
    releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
    acquireAuthLock: vi.fn().mockResolvedValue(true),
    releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TokenStore & { [k: string]: ReturnType<typeof vi.fn> };
}

function futureExpiry(secondsFromNow = 3600): number {
  return Math.floor(Date.now() / 1000) + secondsFromNow;
}

function pastExpiry(secondsAgo = 3600): number {
  return Math.floor(Date.now() / 1000) - secondsAgo;
}

function makeValidAnthropicToken(bucket = 'default'): OAuthToken {
  return {
    access_token: `sk-ant-oat01-validtoken-${bucket}`,
    token_type: 'Bearer',
    expiry: futureExpiry(),
  };
}

function makeLoadedSettings(overrides: Partial<Settings> = {}): LoadedSettings {
  const empty = {} as Settings;
  const merged = { ...empty, ...overrides } as Settings;
  return new LoadedSettings(
    { path: '', settings: empty },
    { path: '', settings: empty },
    { path: '', settings: empty },
    { path: '', settings: merged },
    true,
  );
}

// ---------------------------------------------------------------------------
// getAnthropicUsageInfo
// ---------------------------------------------------------------------------

describe('getAnthropicUsageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no token exists for the bucket', async () => {
    const store = makeTokenStore();
    const result = await getAnthropicUsageInfo(store, 'default');
    expect(result).toBeNull();
    expect(mockFetchAnthropicUsage).not.toHaveBeenCalled();
  });

  it('preserves single-bucket behavior by fetching usage even for non-OAuth Anthropic tokens', async () => {
    const apiKeyToken: OAuthToken = {
      access_token: 'sk-ant-api03-not-oauth',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(apiKeyToken),
    });
    mockFetchAnthropicUsage.mockResolvedValue({ plan: 'legacy-single-bucket' });

    const result = await getAnthropicUsageInfo(store, 'default');

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith(
      'sk-ant-api03-not-oauth',
    );
    expect(result).toEqual({ plan: 'legacy-single-bucket' });
  });

  it('returns null when fetch throws an error', async () => {
    const token = makeValidAnthropicToken();
    const store = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchAnthropicUsage.mockRejectedValue(new Error('network error'));

    const result = await getAnthropicUsageInfo(store, 'default');
    expect(result).toBeNull();
  });

  it('calls fetchAnthropicUsage with the token access_token', async () => {
    const token = makeValidAnthropicToken('my-bucket');
    const store = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchAnthropicUsage.mockResolvedValue({ plan: 'max' });

    const result = await getAnthropicUsageInfo(store, 'my-bucket');

    expect(mockFetchAnthropicUsage).toHaveBeenCalledWith(token.access_token);
    expect(result).toEqual({ plan: 'max' });
  });

  it('defaults to "default" bucket when no bucket specified', async () => {
    const token = makeValidAnthropicToken();
    const store = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchAnthropicUsage.mockResolvedValue({ plan: 'free' });

    await getAnthropicUsageInfo(store, undefined);

    expect(store.getToken).toHaveBeenCalledWith('anthropic', 'default');
  });

  it('returns null when fetchAnthropicUsage returns null', async () => {
    const token = makeValidAnthropicToken();
    const store = makeTokenStore({
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchAnthropicUsage.mockResolvedValue(null);

    const result = await getAnthropicUsageInfo(store, 'default');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getAllAnthropicUsageInfo
// ---------------------------------------------------------------------------

describe('getAllAnthropicUsageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty map when no tokens exist', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(null),
    });

    const result = await getAllAnthropicUsageInfo(store);
    expect(result.size).toBe(0);
  });

  it('falls back to ["default"] when listBuckets returns empty', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue([]),
      getToken: vi.fn().mockResolvedValue(null),
    });

    await getAllAnthropicUsageInfo(store);

    expect(store.getToken).toHaveBeenCalledWith('anthropic', 'default');
  });

  it('skips expired tokens', async () => {
    const expiredToken: OAuthToken = {
      access_token: 'sk-ant-oat01-expiredtoken',
      token_type: 'Bearer',
      expiry: pastExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });

    const result = await getAllAnthropicUsageInfo(store);
    expect(result.size).toBe(0);
    expect(mockFetchAnthropicUsage).not.toHaveBeenCalled();
  });

  it('skips non-OAuth tokens (not sk-ant-oat01- prefix)', async () => {
    const apiKeyToken: OAuthToken = {
      access_token: 'sk-ant-api03-notanoauthtoken',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(apiKeyToken),
    });

    const result = await getAllAnthropicUsageInfo(store);
    expect(result.size).toBe(0);
    expect(mockFetchAnthropicUsage).not.toHaveBeenCalled();
  });

  it('collects usage for multiple valid buckets', async () => {
    const tokenA = makeValidAnthropicToken('bucket-a');
    const tokenB = makeValidAnthropicToken('bucket-b');
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['bucket-a', 'bucket-b']),
      getToken: vi
        .fn()
        .mockImplementation((_provider: string, bucket: string) => {
          if (bucket === 'bucket-a') return Promise.resolve(tokenA);
          if (bucket === 'bucket-b') return Promise.resolve(tokenB);
          return Promise.resolve(null);
        }),
    });
    mockFetchAnthropicUsage
      .mockResolvedValueOnce({ plan: 'max', bucket: 'bucket-a' })
      .mockResolvedValueOnce({ plan: 'pro', bucket: 'bucket-b' });

    const result = await getAllAnthropicUsageInfo(store);

    expect(result.size).toBe(2);
    expect(result.get('bucket-a')).toEqual({ plan: 'max', bucket: 'bucket-a' });
    expect(result.get('bucket-b')).toEqual({ plan: 'pro', bucket: 'bucket-b' });
  });

  it('continues processing remaining buckets when one fetch fails', async () => {
    const tokenA = makeValidAnthropicToken('bucket-a');
    const tokenB = makeValidAnthropicToken('bucket-b');
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['bucket-a', 'bucket-b']),
      getToken: vi
        .fn()
        .mockImplementation((_provider: string, bucket: string) => {
          if (bucket === 'bucket-a') return Promise.resolve(tokenA);
          if (bucket === 'bucket-b') return Promise.resolve(tokenB);
          return Promise.resolve(null);
        }),
    });
    mockFetchAnthropicUsage
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ plan: 'pro' });

    const result = await getAllAnthropicUsageInfo(store);

    expect(result.size).toBe(1);
    expect(result.get('bucket-b')).toEqual({ plan: 'pro' });
  });

  it('skips null usage results', async () => {
    const token = makeValidAnthropicToken();
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchAnthropicUsage.mockResolvedValue(null);

    const result = await getAllAnthropicUsageInfo(store);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getAllCodexUsageInfo
// ---------------------------------------------------------------------------

describe('getAllCodexUsageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty map when no tokens exist', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(null),
    });

    const result = await getAllCodexUsageInfo(store);
    expect(result.size).toBe(0);
  });

  it('falls back to ["default"] when listBuckets returns empty', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue([]),
      getToken: vi.fn().mockResolvedValue(null),
    });

    await getAllCodexUsageInfo(store);

    expect(store.getToken).toHaveBeenCalledWith('codex', 'default');
  });

  it('skips expired tokens', async () => {
    const expiredToken = {
      access_token: 'codex-token',
      token_type: 'Bearer',
      expiry: pastExpiry(),
      account_id: 'acct-123',
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });

    const result = await getAllCodexUsageInfo(store);
    expect(result.size).toBe(0);
    expect(mockFetchCodexUsage).not.toHaveBeenCalled();
  });

  it('skips tokens without account_id', async () => {
    const tokenWithoutAccountId: OAuthToken = {
      access_token: 'codex-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(tokenWithoutAccountId),
    });

    const result = await getAllCodexUsageInfo(store);
    expect(result.size).toBe(0);
    expect(mockFetchCodexUsage).not.toHaveBeenCalled();
  });

  it('calls fetchCodexUsage with access_token and account_id', async () => {
    const token = {
      access_token: 'codex-access-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
      account_id: 'acct-abc123',
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchCodexUsage.mockResolvedValue({ quota: 1000 });

    const result = await getAllCodexUsageInfo(store);

    expect(mockFetchCodexUsage).toHaveBeenCalledWith(
      'codex-access-token',
      'acct-abc123',
      undefined,
    );
    expect(result.size).toBe(1);
    expect(result.get('default')).toEqual({ quota: 1000 });
  });

  it('passes base-url from config when available', async () => {
    const token = {
      access_token: 'codex-access-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
      account_id: 'acct-xyz',
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchCodexUsage.mockResolvedValue({ quota: 500 });

    const mockConfig = {
      getEphemeralSetting: vi.fn().mockReturnValue('https://custom.codex.io'),
    };

    await getAllCodexUsageInfo(
      store,
      mockConfig as unknown as import('@vybestack/llxprt-code-core').Config,
    );

    expect(mockFetchCodexUsage).toHaveBeenCalledWith(
      'codex-access-token',
      'acct-xyz',
      'https://custom.codex.io',
    );
  });

  it('passes undefined base-url when config returns empty string', async () => {
    const token = {
      access_token: 'codex-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
      account_id: 'acct-empty',
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchCodexUsage.mockResolvedValue({ quota: 200 });

    const mockConfig = {
      getEphemeralSetting: vi.fn().mockReturnValue('   '),
    };

    await getAllCodexUsageInfo(
      store,
      mockConfig as unknown as import('@vybestack/llxprt-code-core').Config,
    );

    expect(mockFetchCodexUsage).toHaveBeenCalledWith(
      'codex-token',
      'acct-empty',
      undefined,
    );
  });

  it('continues processing remaining buckets when one fetch fails', async () => {
    const tokenA = {
      access_token: 'codex-token-a',
      token_type: 'Bearer',
      expiry: futureExpiry(),
      account_id: 'acct-a',
    };
    const tokenB = {
      access_token: 'codex-token-b',
      token_type: 'Bearer',
      expiry: futureExpiry(),
      account_id: 'acct-b',
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['bucket-a', 'bucket-b']),
      getToken: vi
        .fn()
        .mockImplementation((_provider: string, bucket: string) => {
          if (bucket === 'bucket-a') return Promise.resolve(tokenA);
          if (bucket === 'bucket-b') return Promise.resolve(tokenB);
          return Promise.resolve(null);
        }),
    });
    mockFetchCodexUsage
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({ quota: 999 });

    const result = await getAllCodexUsageInfo(store);
    expect(result.size).toBe(1);
    expect(result.get('bucket-b')).toEqual({ quota: 999 });
  });
});

// ---------------------------------------------------------------------------
// getAllGeminiUsageInfo
// ---------------------------------------------------------------------------

describe('getAllGeminiUsageInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty map when no tokens exist', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(null),
    });

    const result = await getAllGeminiUsageInfo(store);
    expect(result.size).toBe(0);
  });

  it('falls back to ["default"] when listBuckets returns empty', async () => {
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue([]),
      getToken: vi.fn().mockResolvedValue(null),
    });

    await getAllGeminiUsageInfo(store);

    expect(store.getToken).toHaveBeenCalledWith('gemini', 'default');
  });

  it('skips expired tokens', async () => {
    const expiredToken: OAuthToken = {
      access_token: 'gemini-token',
      token_type: 'Bearer',
      expiry: pastExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(expiredToken),
    });

    const result = await getAllGeminiUsageInfo(store);
    expect(result.size).toBe(0);
    expect(mockFetchGeminiQuota).not.toHaveBeenCalled();
  });

  it('calls fetchGeminiQuota with the token access_token', async () => {
    const token: OAuthToken = {
      access_token: 'gemini-valid-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchGeminiQuota.mockResolvedValue({ remainingUnits: 42 });

    const result = await getAllGeminiUsageInfo(store);

    expect(mockFetchGeminiQuota).toHaveBeenCalledWith('gemini-valid-token');
    expect(result.size).toBe(1);
    expect(result.get('default')).toEqual({ remainingUnits: 42 });
  });

  it('collects quota for multiple valid buckets', async () => {
    const tokenA: OAuthToken = {
      access_token: 'gemini-token-a',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const tokenB: OAuthToken = {
      access_token: 'gemini-token-b',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['bucket-a', 'bucket-b']),
      getToken: vi
        .fn()
        .mockImplementation((_provider: string, bucket: string) => {
          if (bucket === 'bucket-a') return Promise.resolve(tokenA);
          if (bucket === 'bucket-b') return Promise.resolve(tokenB);
          return Promise.resolve(null);
        }),
    });
    mockFetchGeminiQuota
      .mockResolvedValueOnce({ remaining: 100 })
      .mockResolvedValueOnce({ remaining: 200 });

    const result = await getAllGeminiUsageInfo(store);

    expect(result.size).toBe(2);
    expect(result.get('bucket-a')).toEqual({ remaining: 100 });
    expect(result.get('bucket-b')).toEqual({ remaining: 200 });
  });

  it('continues processing remaining buckets when one fetch fails', async () => {
    const tokenA: OAuthToken = {
      access_token: 'gemini-token-a',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const tokenB: OAuthToken = {
      access_token: 'gemini-token-b',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['bucket-a', 'bucket-b']),
      getToken: vi
        .fn()
        .mockImplementation((_provider: string, bucket: string) => {
          if (bucket === 'bucket-a') return Promise.resolve(tokenA);
          if (bucket === 'bucket-b') return Promise.resolve(tokenB);
          return Promise.resolve(null);
        }),
    });
    mockFetchGeminiQuota
      .mockRejectedValueOnce(new Error('quota api down'))
      .mockResolvedValueOnce({ remaining: 50 });

    const result = await getAllGeminiUsageInfo(store);
    expect(result.size).toBe(1);
    expect(result.get('bucket-b')).toEqual({ remaining: 50 });
  });

  it('skips null quota results', async () => {
    const token: OAuthToken = {
      access_token: 'gemini-token',
      token_type: 'Bearer',
      expiry: futureExpiry(),
    };
    const store = makeTokenStore({
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getToken: vi.fn().mockResolvedValue(token),
    });
    mockFetchGeminiQuota.mockResolvedValue(null);

    const result = await getAllGeminiUsageInfo(store);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getHigherPriorityAuth
// ---------------------------------------------------------------------------

describe('getHigherPriorityAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsServiceRef.current = { get: vi.fn(() => false) };
    mockGetSettingsService.mockReturnValue(mockSettingsServiceRef.current);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.QWEN_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.QWEN_API_KEY;
  });

  it('returns null when settings is undefined', async () => {
    const result = await getHigherPriorityAuth('anthropic', undefined);
    expect(result).toBeNull();
  });

  it('returns null when authOnly is enabled', async () => {
    mockSettingsServiceRef.current.get = vi.fn(() => true);
    const settings = makeLoadedSettings();

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBeNull();
  });

  it('returns "API Key" when provider has API key in settings', async () => {
    const settings = makeLoadedSettings({
      providerApiKeys: { anthropic: 'sk-ant-key' },
    });

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBe('API Key');
  });

  it('returns "Keyfile" when provider has keyfile in settings', async () => {
    const settings = makeLoadedSettings({
      providerKeyfiles: { anthropic: '/path/to/keyfile.json' },
    });

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBe('Keyfile');
  });

  it('returns "Environment Variable" when env var is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-env-key';
    const settings = makeLoadedSettings();

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBe('Environment Variable');
  });

  it('uses uppercase provider name for env var check', async () => {
    process.env.QWEN_API_KEY = 'qwen-env-key';
    const settings = makeLoadedSettings();

    const result = await getHigherPriorityAuth('qwen', settings);
    expect(result).toBe('Environment Variable');
  });

  it('returns null when no higher priority auth exists', async () => {
    const settings = makeLoadedSettings();

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBeNull();
  });

  it('returns "OpenAI BaseURL Mismatch" for qwen when base URL is incompatible', async () => {
    const settings = makeLoadedSettings({
      providerBaseUrls: { openai: 'https://api.openai.com/v1' },
    });

    const result = await getHigherPriorityAuth('qwen', settings);
    expect(result).toBe('OpenAI BaseURL Mismatch');
  });

  it('returns null for qwen when base URL is Qwen-compatible', async () => {
    const settings = makeLoadedSettings({
      providerBaseUrls: { openai: 'https://dashscope.aliyuncs.com/v1' },
    });

    const result = await getHigherPriorityAuth('qwen', settings);
    expect(result).toBeNull();
  });

  it('returns null for qwen when no openai base URL is set', async () => {
    const settings = makeLoadedSettings({
      providerBaseUrls: {},
    });

    const result = await getHigherPriorityAuth('qwen', settings);
    expect(result).toBeNull();
  });

  it('does not check openai base URL mismatch for non-qwen providers', async () => {
    const settings = makeLoadedSettings({
      providerBaseUrls: { openai: 'https://api.openai.com/v1' },
    });

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBeNull();
  });

  it('API Key check takes priority over env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const settings = makeLoadedSettings({
      providerApiKeys: { anthropic: 'settings-key' },
    });

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBe('API Key');
  });

  it('Keyfile check takes priority over env var', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const settings = makeLoadedSettings({
      providerKeyfiles: { anthropic: '/keyfile.json' },
    });

    const result = await getHigherPriorityAuth('anthropic', settings);
    expect(result).toBe('Keyfile');
  });
});

// ---------------------------------------------------------------------------
// isQwenCompatibleUrl
// ---------------------------------------------------------------------------

describe('isQwenCompatibleUrl', () => {
  it('returns true for empty string (default endpoint is compatible)', () => {
    expect(isQwenCompatibleUrl('')).toBe(true);
  });

  it('returns true for dashscope.aliyuncs.com', () => {
    expect(
      isQwenCompatibleUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBe(true);
  });

  it('returns true for qwen.com', () => {
    expect(isQwenCompatibleUrl('https://api.qwen.com/v1')).toBe(true);
  });

  it('returns true for api.qwen.com', () => {
    expect(isQwenCompatibleUrl('https://api.qwen.com')).toBe(true);
  });

  it('returns false for openai.com URL', () => {
    expect(isQwenCompatibleUrl('https://api.openai.com/v1')).toBe(false);
  });

  it('returns false for azure openai URL', () => {
    expect(isQwenCompatibleUrl('https://myresource.openai.azure.com')).toBe(
      false,
    );
  });

  it('returns false for custom non-qwen URL', () => {
    expect(isQwenCompatibleUrl('https://proxy.example.com/v1')).toBe(false);
  });

  it('returns false for invalid URL format', () => {
    expect(isQwenCompatibleUrl('not-a-valid-url')).toBe(false);
  });

  it('returns false for localhost URL', () => {
    expect(isQwenCompatibleUrl('http://localhost:8080')).toBe(false);
  });

  it('handles subdomain of aliyuncs correctly', () => {
    expect(isQwenCompatibleUrl('https://dashscope-intl.aliyuncs.com/v1')).toBe(
      false,
    );
  });
});
