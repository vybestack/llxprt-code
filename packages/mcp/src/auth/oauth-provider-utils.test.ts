/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseTokenErrorResponse,
  parseTokenResponse,
} from './oauth-provider-utils.js';

describe('parseTokenResponse', () => {
  it('normalizes empty optional fields from JSON token responses', () => {
    const result = parseTokenResponse(
      JSON.stringify({
        access_token: 'access-token',
        token_type: '',
        expires_in: 3600,
        refresh_token: '',
        scope: '',
      }),
      'application/json',
      'Token exchange failed',
    );

    expect(result).toStrictEqual({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('normalizes empty optional fields from form-urlencoded token responses', () => {
    const result = parseTokenResponse(
      'access_token=access-token&token_type=&expires_in=3600&refresh_token=&scope=',
      'application/x-www-form-urlencoded',
      'Token exchange failed',
    );

    expect(result).toStrictEqual({
      access_token: 'access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('rejects JSON token responses with missing access tokens', () => {
    expect(() =>
      parseTokenResponse(
        JSON.stringify({
          access_token: '',
          token_type: 'Bearer',
        }),
        'application/json',
        'Token exchange failed',
      ),
    ).toThrow('Token exchange failed: no_access_token -');
  });
});

describe('parseTokenErrorResponse', () => {
  it('normalizes empty error descriptions', () => {
    expect(
      parseTokenErrorResponse(
        'error=invalid_request&error_description=',
        'Token exchange failed',
      ),
    ).toBe('Token exchange failed: invalid_request - No description');
  });
});
