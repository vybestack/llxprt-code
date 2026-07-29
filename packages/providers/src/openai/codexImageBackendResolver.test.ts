/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';

import { createCodexImageBackendResolver } from './codexImageBackendResolver.js';
import type { CodexImageBackendResolverDeps } from './codexImageBackendResolver.js';
import type { IProvider } from '../IProvider.js';

interface StubToken {
  access_token: string;
  account_id: string;
  expiry: number;
  token_type: string;
}

function makeStubProvider(baseUrl: string | undefined): IProvider {
  return {
    name: 'codex',
    getServerTools: () => [],
    invokeServerTool: () => Promise.resolve(undefined),
    generateChatCompletion: (() =>
      undefined) as unknown as IProvider['generateChatCompletion'],
    baseProviderConfig: baseUrl ? { baseURL: baseUrl } : undefined,
  } as unknown as IProvider;
}

function makeStubOAuthManager(
  token: StubToken | null,
): NonNullable<CodexImageBackendResolverDeps['oauthManager']> {
  return {
    getToken: () => Promise.resolve(token?.access_token ?? null),
    isAuthenticated: () => Promise.resolve(token !== null),
    getOAuthToken: () => Promise.resolve(token),
  } as unknown as NonNullable<CodexImageBackendResolverDeps['oauthManager']>;
}

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const NON_CODEX_BASE_URL = 'https://api.openai.com/v1';
const VALID_TOKEN: StubToken = {
  access_token: 'test-access-token',
  account_id: 'test-account-id',
  expiry: Math.floor(Date.now() / 1000) + 3600,
  token_type: 'Bearer',
};

describe('createCodexImageBackendResolver', () => {
  it('returns null when there is no active provider', () => {
    const resolve = createCodexImageBackendResolver({
      oauthManager: makeStubOAuthManager(VALID_TOKEN),
      getActiveProvider: () => undefined,
    });
    expect(resolve()).toBeNull();
  });

  it('returns null when the active provider is not Codex (non-Codex base URL)', () => {
    const resolve = createCodexImageBackendResolver({
      oauthManager: makeStubOAuthManager(VALID_TOKEN),
      getActiveProvider: () => makeStubProvider(NON_CODEX_BASE_URL),
    });
    expect(resolve()).toBeNull();
  });

  it('returns null when there is no OAuth manager', () => {
    const resolve = createCodexImageBackendResolver({
      oauthManager: undefined,
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
    });
    expect(resolve()).toBeNull();
  });

  it('returns a backend with name "codex" when provider is Codex and OAuth is available', () => {
    const resolve = createCodexImageBackendResolver({
      oauthManager: makeStubOAuthManager(VALID_TOKEN),
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
    });
    const backend = resolve();
    expect(backend).not.toBeNull();
    expect(backend?.name).toBe('codex');
  });

  it('returns a backend whose generate() resolves the access token from the OAuth manager', async () => {
    const oauthManager = makeStubOAuthManager(VALID_TOKEN);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] })),
    });

    const resolve = createCodexImageBackendResolver({
      oauthManager,
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const resolved = resolve();
    expect(resolved).not.toBeNull();
    const backend = resolved as NonNullable<typeof resolved>;

    const signal = new AbortController().signal;
    await backend.generate({ prompt: 'a cat' }, signal);

    const call = mockFetch.mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-access-token');
  });

  it('returns a backend whose generate() resolves the account_id from the OAuth token', async () => {
    const oauthManager = makeStubOAuthManager(VALID_TOKEN);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] })),
    });

    const resolve = createCodexImageBackendResolver({
      oauthManager,
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const resolved = resolve();
    expect(resolved).not.toBeNull();
    const backend = resolved as NonNullable<typeof resolved>;

    const signal = new AbortController().signal;
    await backend.generate({ prompt: 'a cat' }, signal);

    const call = mockFetch.mock.calls[0];
    const headers = (call[1] as RequestInit).headers as Record<string, string>;
    expect(headers['ChatGPT-Account-ID']).toBe('test-account-id');
  });

  it('throws a clear error when the OAuth manager returns no token', async () => {
    const oauthManager = makeStubOAuthManager(null);
    const mockFetch = vi.fn();
    const resolve = createCodexImageBackendResolver({
      oauthManager,
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const resolved = resolve();
    expect(resolved).not.toBeNull();
    const backend = resolved as NonNullable<typeof resolved>;

    const signal = new AbortController().signal;
    await expect(backend.generate({ prompt: 'a cat' }, signal)).rejects.toThrow(
      /OAuth authentication/i,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws a clear error when the token lacks account_id', async () => {
    const tokenWithoutAccountId: StubToken = {
      access_token: 'token-without-account',
      account_id: '',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    };
    const oauthManager = makeStubOAuthManager(tokenWithoutAccountId);
    const mockFetch = vi.fn();
    const resolve = createCodexImageBackendResolver({
      oauthManager,
      getActiveProvider: () => makeStubProvider(CODEX_BASE_URL),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const resolved = resolve();
    expect(resolved).not.toBeNull();
    const backend = resolved as NonNullable<typeof resolved>;

    const signal = new AbortController().signal;
    await expect(backend.generate({ prompt: 'a cat' }, signal)).rejects.toThrow(
      /account_id/i,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
