/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P07
 */

import { describe, it, expect } from 'vitest';
import {
  mergeRefreshedToken,
  type OAuthTokenWithExtras,
} from '../token-merge.js';

describe('mergeRefreshedToken', () => {
  const currentToken: OAuthTokenWithExtras = {
    access_token: 'old-at',
    refresh_token: 'old-rt',
    expiry: 1700000000,
    token_type: 'Bearer',
    scope: 'openid',
    account_id: 'acct-1',
  };

  /**
   * @requirement R12.1
   * @scenario access_token always uses new value
   */
  it('access_token always uses new value', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.access_token).toBe('new-at');
  });

  /**
   * @requirement R12.1
   * @scenario expiry always uses new value
   */
  it('expiry always uses new value', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700099000,
    });
    expect(result.expiry).toBe(1700099000);
  });

  /**
   * @requirement R12.2
   * @scenario refresh_token uses new if provided and non-empty
   */
  it('refresh_token: uses new if provided and non-empty', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
      refresh_token: 'new-rt',
    });
    expect(result.refresh_token).toBe('new-rt');
  });

  /**
   * @requirement R12.2
   * @scenario refresh_token preserves existing when new is undefined
   */
  it('refresh_token: preserves existing when new is undefined', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.refresh_token).toBe('old-rt');
  });

  /**
   * @requirement R12.2
   * @scenario refresh_token preserves existing when new is empty string
   */
  it('refresh_token: preserves existing when new is empty string', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
      refresh_token: '',
    });
    expect(result.refresh_token).toBe('old-rt');
  });

  /**
   * @requirement R12.3
   * @scenario scope uses new if provided
   */
  it('scope: uses new if provided', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
      scope: 'openid email',
    });
    expect(result.scope).toBe('openid email');
  });

  /**
   * @requirement R12.3
   * @scenario scope keeps existing when new is undefined
   */
  it('scope: keeps existing when new is undefined', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.scope).toBe('openid');
  });

  /**
   * @requirement R12.4
   * @scenario token_type uses new if provided
   */
  it('token_type: uses new if provided', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
      token_type: 'bearer',
    });
    expect(result.token_type).toBe('bearer');
  });

  /**
   * @requirement R12.4
   * @scenario token_type keeps existing when new is undefined
   */
  it('token_type: keeps existing when new is undefined', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.token_type).toBe('Bearer');
  });

  /**
   * @requirement R12.3
   * @scenario resource_url preserved when new doesn't have it
   */
  it('resource_url: preserved when new does not have it', () => {
    const tokenWithResource: OAuthTokenWithExtras = {
      ...currentToken,
      resource_url: 'https://api.qwen.example.com',
    };
    const result = mergeRefreshedToken(tokenWithResource, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.resource_url).toBe('https://api.qwen.example.com');
  });

  /**
   * @requirement R12.5
   * @scenario Provider-specific field (account_id) preserved from current
   */
  it('provider-specific field (account_id) preserved from current', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
    });
    expect(result.account_id).toBe('acct-1');
  });

  /**
   * @requirement R12.5
   * @scenario Provider-specific field from new overwrites current
   */
  it('provider-specific field from new overwrites current', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'new-at',
      expiry: 1700001000,
      account_id: 'acct-2',
    });
    expect(result.account_id).toBe('acct-2');
  });

  /**
   * @requirement R12.1
   * @scenario Does not mutate input objects
   */
  it('does not mutate input objects', () => {
    const currentCopy: OAuthTokenWithExtras = { ...currentToken };
    const newToken: Partial<OAuthTokenWithExtras> = {
      access_token: 'new-at',
      expiry: 1700001000,
      refresh_token: 'new-rt',
    };
    const newCopy = { ...newToken };

    mergeRefreshedToken(currentCopy, newToken);

    expect(currentCopy).toEqual(currentToken);
    expect(newToken).toEqual(newCopy);
  });

  /**
   * @requirement R12.1
   * @scenario Handles new token with only access_token and expiry
   */
  it('handles new token with only access_token and expiry', () => {
    const result = mergeRefreshedToken(currentToken, {
      access_token: 'minimal-at',
      expiry: 1700005000,
    });
    expect(result.access_token).toBe('minimal-at');
    expect(result.expiry).toBe(1700005000);
    expect(result.refresh_token).toBe('old-rt');
    expect(result.token_type).toBe('Bearer');
    expect(result.scope).toBe('openid');
    expect(result.account_id).toBe('acct-1');
  });
});
