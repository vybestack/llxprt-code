/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { CodexOAuthProvider } from './codex-oauth-provider.js';
import type { OAuthProvider } from './types.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './__tests__/behavioral/test-utils.js';

describe('profile refresh cancellation', () => {
  it('forwards profile refresh cancellation through the real Codex HTTP deadline', async () => {
    const owner = new AbortController();
    const cancellation = new Error('Profile retired');
    let reached = (): void => {};
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = (): void => {};
    let transportSignal: AbortSignal | null | undefined;
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => {
        transportSignal = init?.signal;
        const signal = transportSignal;
        reached();
        return new Promise<Response>((resolve, reject) => {
          const onAbort = (): void => reject(signal?.reason);
          signal?.addEventListener('abort', onAbort, { once: true });
          release = () => {
            signal?.removeEventListener('abort', onAbort);
            resolve(
              Response.json({
                access_token: 'rotated',
                refresh_token: 'rotated-refresh',
                token_type: 'Bearer',
                expires_in: 120,
              }),
            );
          };
        });
      },
    );
    const provider: OAuthProvider = new CodexOAuthProvider(
      new MemoryTokenStore(),
    );
    const result = provider
      .refreshToken(makeExpiredToken('expired-codex'), owner.signal)
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      await entered;
      owner.abort(cancellation);
      expect(transportSignal?.aborted).toBe(true);
      expect(await result).toStrictEqual({ error: cancellation });
    } finally {
      release();
      await result;
      transport.mockRestore();
    }
  }, 30000);
});
