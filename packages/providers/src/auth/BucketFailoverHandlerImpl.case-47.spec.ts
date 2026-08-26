/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager } from './oauth-manager.js';
import {
  makeToken,
  MemoryTokenStore,
} from './BucketFailoverHandlerImpl.test-helpers.js';

interface LateEagerTokenReadState {
  calls: number;
  readonly firstReadGate: Promise<void>;
  readonly tokenStore: MemoryTokenStore;
}

async function readTokenAfterFirstGate(
  state: LateEagerTokenReadState,
  bucket: string | undefined,
): Promise<Awaited<ReturnType<MemoryTokenStore['getToken']>>> {
  state.calls += 1;
  if (state.calls === 1) {
    await state.firstReadGate;
    return null;
  }
  return state.tokenStore.getToken('anthropic', bucket);
}

function resolveForegroundAuthBucket(bucket: string | undefined): string {
  return bucket ?? 'default';
}

describe('BucketFailoverHandlerImpl #47', () => {
  it('re-checks late-started eager auth before pass-3 foreground reauth', async () => {
    // Arrange
    const tokenStore = new MemoryTokenStore();

    let releaseFirstGetOAuthToken: (() => void) | undefined;
    const firstGetOAuthTokenGate = new Promise<void>((resolve) => {
      releaseFirstGetOAuthToken = resolve;
    });

    let releaseEagerAuth: (() => void) | undefined;
    const eagerAuthGate = new Promise<void>((resolve) => {
      releaseEagerAuth = resolve;
    });

    const tokenReadState: LateEagerTokenReadState = {
      calls: 0,
      firstReadGate: firstGetOAuthTokenGate,
      tokenStore,
    };
    const oauthManager = {
      getOAuthToken: vi.fn((_provider: string, bucket?: string) =>
        readTokenAfterFirstGate(tokenReadState, bucket),
      ),
      getTokenStore: vi.fn(() => tokenStore),
      setSessionBucket: vi.fn(),
      getSessionBucket: vi.fn(() => 'bucket-b'),
      authenticate: vi.fn(async (_provider: string, bucket?: string) => {
        await tokenStore.saveToken(
          'anthropic',
          makeToken('pass3-token'),
          resolveForegroundAuthBucket(bucket),
        );
      }),
      authenticateMultipleBuckets: vi.fn(async () => {
        await eagerAuthGate;
        await tokenStore.saveToken(
          'anthropic',
          makeToken('late-eager-token'),
          'bucket-a',
        );
      }),
    };

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager as unknown as OAuthManager,
    );

    const failoverPromise = handler.tryFailover({ triggeringStatus: 401 });

    // Start eager auth after pass-3 started, while first token check is blocked.
    const ensurePromise = handler.ensureBucketsAuthenticated();

    // Allow first check to complete with null so pass-3 executes late in-flight re-check.
    releaseFirstGetOAuthToken?.();

    // Keep eager auth in-flight until pass-3 reaches late guard.
    await Promise.resolve();
    releaseEagerAuth?.();
    await ensurePromise;

    await expect(failoverPromise).resolves.toBe(true);
    expect(tokenReadState.calls).toBe(2);
    expect(oauthManager.authenticate).not.toHaveBeenCalled();
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });
});
