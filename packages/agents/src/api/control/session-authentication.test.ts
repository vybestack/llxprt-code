/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { MemoryTokenStore } from '../__tests__/helpers/provider-auth-fixtures.js';
import { assembleSessionAuthentication } from './session-authentication.js';

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
});
