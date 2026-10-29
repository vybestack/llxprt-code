/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { OAuthFetch } from '@vybestack/llxprt-code-auth/types.js';
import { OAuthUIBridge } from '@vybestack/llxprt-code-auth';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-auth';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition was never reached');
    await sleep(2);
  }
}

class MemoryTokenStore implements TokenStore {
  async getToken(): Promise<OAuthToken | null> {
    return null;
  }
  async saveToken(): Promise<void> {}
  async removeToken(): Promise<void> {}
  async listProviders(): Promise<string[]> {
    return [];
  }
  async listBuckets(): Promise<string[]> {
    return [];
  }
  async getBucketStats(): Promise<null> {
    return null;
  }
  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }
  async releaseRefreshLock(): Promise<void> {}
  async acquireAuthLock(): Promise<boolean> {
    return true;
  }
  async releaseAuthLock(): Promise<void> {}
}

function createProvider(): {
  ui: OAuthUIBridge;
  readonly provider: AnthropicOAuthProvider;
  readonly exchanges: string[];
} {
  const exchanges: string[] = [];
  const requestFetch: OAuthFetch = async (url) => {
    exchanges.push(String(url));
    return new Response(
      JSON.stringify({
        access_token: 'claude-access',
        refresh_token: 'claude-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };
  const provider = new AnthropicOAuthProvider(
    requestFetch,
    new MemoryTokenStore(),
    () => undefined,
    () => true,
  );
  const ui = new OAuthUIBridge();
  provider.bindUIPort(ui);
  return { provider, exchanges, ui };
}

describe('AnthropicOAuthProvider initiation honors cancellation', () => {
  it('rejects with the abort reason while waiting for the manual code, clears the dialog and starts the next attempt fresh', async () => {
    const { provider, exchanges, ui } = createProvider();
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const attempt = provider.initiateAuth(controller.signal).then(
      () => 'fulfilled' as const,
      (error: unknown) => error,
    );
    try {
      await waitUntil(() => ui.getCodeRequest().needsCode);

      controller.abort(reason);
      const outcome = await Promise.race([
        attempt,
        sleep(1000).then(() => 'still-pending' as const),
      ]);
      expect(outcome).toBe(reason);
      expect(ui.getCodeRequest().needsCode).toBe(false);
      expect(exchanges).toHaveLength(0);

      const next = provider.initiateAuth();
      await waitUntil(() => ui.getCodeRequest().needsCode);
      provider.submitAuthCode('manual-code#manual-state');
      const token = await next;
      expect(token.access_token).toBe('claude-access');
      expect(exchanges).toHaveLength(1);
    } finally {
      provider.cancelAuth();
      await attempt;
    }
  });

  it('rejects with the abort reason without starting an attempt when the signal is already aborted', async () => {
    const { provider, exchanges, ui } = createProvider();
    const reason = new Error('already gone');
    const controller = new AbortController();
    controller.abort(reason);

    const outcome = await Promise.race([
      provider.initiateAuth(controller.signal).then(
        () => 'fulfilled' as const,
        (error: unknown) => error,
      ),
      sleep(1000).then(() => 'still-pending' as const),
    ]);
    try {
      expect(outcome).toBe(reason);
      expect(ui.getCodeRequest().needsCode).toBe(false);
      expect(exchanges).toHaveLength(0);
    } finally {
      provider.cancelAuth();
    }
  });
});
