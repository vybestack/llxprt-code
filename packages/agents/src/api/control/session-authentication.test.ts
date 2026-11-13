/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  OAuthManager,
  type OAuthToken,
} from '@vybestack/llxprt-code-providers/auth.js';
import { MemoryTokenStore } from '../__tests__/helpers/provider-auth-fixtures.js';
import { assembleSessionAuthentication } from './session-authentication.js';

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function track(promise: Promise<unknown>): { isSettled: () => boolean } {
  let settled = false;
  void promise.finally(() => {
    settled = true;
  });
  return { isSettled: () => settled };
}
describe('assembleSessionAuthentication', () => {
  it('keeps detached bucket operations bound to their own OAuth owner', async () => {
    const left = new OAuthManager(new MemoryTokenStore());
    const right = new OAuthManager(new MemoryTokenStore());
    try {
      const { setSessionBucket, getSessionBucket, clearSessionBucket } =
        assembleSessionAuthentication(left, () => {});
      right.setSessionBucket('codex', 'right');
      setSessionBucket('codex', 'left');
      expect(getSessionBucket('codex')).toBe('left');
      clearSessionBucket('codex');
      expect(getSessionBucket('codex')).toBeUndefined();
      expect(right.getSessionBucket('codex')).toBe('right');
    } finally {
      await Promise.all([left.dispose(), right.dispose()]);
    }
  });

  it('projects stored token metadata without exposing credentials', async () => {
    const tokens = new MemoryTokenStore();
    const oauth = new OAuthManager(tokens);
    try {
      await tokens.saveToken(
        'codex',
        {
          access_token: 'private-access',
          refresh_token: 'private-refresh',
          expiry: 1000,
          token_type: 'Bearer',
          scope: '',
        },
        'work',
      );
      const control = assembleSessionAuthentication(oauth, () => {});
      expect(
        await control.readStoredTokenSummary('codex', 'work'),
      ).toStrictEqual({
        expiry: 1000,
        hasRefreshToken: true,
      });
      expect(
        await control.readStoredTokenSummary('codex', 'missing'),
      ).toBeNull();
    } finally {
      await oauth.dispose();
    }
  });

  it('keeps detached interactive reads bound and exposes no fabricated dialog', async () => {
    const oauth = new OAuthManager(new MemoryTokenStore());
    try {
      const { getCodeRequest, getDialog, takeAuthOutcome } =
        assembleSessionAuthentication(oauth, () => {});
      expect(getCodeRequest()).toStrictEqual({
        needsCode: false,
        provider: undefined,
      });
      expect(getDialog()).toBeUndefined();
      expect(takeAuthOutcome()).toStrictEqual({
        complete: false,
        error: undefined,
      });
    } finally {
      await oauth.dispose();
    }
  });

  it('rejects OAuth status, logout, and bucket operations after disposal starts', async () => {
    const oauth = new OAuthManager(new MemoryTokenStore());
    await oauth.dispose();
    await expect(oauth.getAuthStatus()).rejects.toThrow(
      'OAuth manager is disposed',
    );
    await expect(oauth.logout('codex', 'work')).rejects.toThrow(
      'OAuth manager is disposed',
    );
    await expect(oauth.listBuckets('codex')).rejects.toThrow(
      'OAuth manager is disposed',
    );
    expect(() => oauth.getSessionBucket('codex')).toThrow(
      'OAuth manager is disposed',
    );
  });

  it('rejects stored token reads after OAuth disposal starts', async () => {
    const oauth = new OAuthManager(new MemoryTokenStore());
    const authentication = assembleSessionAuthentication(oauth, () => {});
    await oauth.dispose();
    await expect(
      authentication.readStoredTokenSummary('codex', 'work'),
    ).rejects.toThrow('OAuth manager is disposed');
  });

  it('joins a stored-token read accepted before OAuth disposal', async () => {
    const entered = gate();
    const release = gate();
    const tokens = new (class extends MemoryTokenStore {
      override async getToken(
        provider: string,
        bucket?: string,
      ): Promise<OAuthToken | null> {
        entered.release();
        await release.promise;
        return super.getToken(provider, bucket);
      }
    })();
    const oauth = new OAuthManager(tokens);
    const authentication = assembleSessionAuthentication(oauth, () => {});
    const read = authentication.readStoredTokenSummary('codex', 'work');
    await entered.promise;
    const disposing = oauth.dispose();
    const disposal = track(disposing);
    try {
      await Promise.resolve();
      expect(disposal.isSettled()).toBe(false);
      release.release();
      expect(await read).toBeNull();
      await disposing;
      expect(disposal.isSettled()).toBe(true);
    } finally {
      release.release();
      await disposing;
    }
  });
});
