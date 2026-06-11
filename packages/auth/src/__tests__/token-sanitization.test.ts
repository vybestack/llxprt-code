/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250214-CREDPROXY.P07
 */

import { describe, it, expect } from 'vitest';
import { sanitizeTokenForProxy } from '../token-sanitization.js';
import { type OAuthToken } from '../types.js';

describe('sanitizeTokenForProxy', () => {
  const fullToken: OAuthToken & Record<string, unknown> = {
    access_token: 'at-123',
    refresh_token: 'rt-secret',
    expiry: 1700000000,
    token_type: 'Bearer',
    scope: 'openid profile',
  };

  /**
   * @requirement R10.1
   * @scenario Strip refresh_token from token with all standard fields
   */
  it('strips refresh_token from a complete token', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect('refresh_token' in result).toBe(false);
  });

  /**
   * @requirement R10.1
   * @scenario Preserves access_token in sanitized output
   */
  it('preserves access_token', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect(result.access_token).toBe('at-123');
  });

  /**
   * @requirement R10.1
   * @scenario Preserves expiry in sanitized output
   */
  it('preserves expiry', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect(result.expiry).toBe(1700000000);
  });

  /**
   * @requirement R10.1
   * @scenario Preserves token_type in sanitized output
   */
  it('preserves token_type', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect(result.token_type).toBe('Bearer');
  });

  /**
   * @requirement R10.1
   * @scenario Preserves scope when present
   */
  it('preserves scope when present', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect(result.scope).toBe('openid profile');
  });

  /**
   * @requirement R10.2
   * @scenario Preserves provider-specific fields like account_id and id_token
   */
  it('preserves provider-specific fields (account_id, id_token)', () => {
    const tokenWithExtras: OAuthToken & Record<string, unknown> = {
      ...fullToken,
      account_id: 'acct-42',
      id_token: 'jwt-xyz',
    };
    const result = sanitizeTokenForProxy(tokenWithExtras);
    expect(result.account_id).toBe('acct-42');
    expect(result.id_token).toBe('jwt-xyz');
    expect('refresh_token' in result).toBe(false);
  });

  /**
   * @requirement R10.1
   * @scenario Handles token with no refresh_token — returns same fields
   */
  it('handles token with no refresh_token (returns same fields)', () => {
    const tokenNoRefresh: OAuthToken = {
      access_token: 'at-456',
      expiry: 1700001000,
      token_type: 'Bearer',
    };
    const result = sanitizeTokenForProxy(tokenNoRefresh);
    expect(result.access_token).toBe('at-456');
    expect(result.expiry).toBe(1700001000);
    expect(result.token_type).toBe('Bearer');
    expect('refresh_token' in result).toBe(false);
  });

  /**
   * @requirement R10.1
   * @scenario Handles token with empty string refresh_token — removes it
   */
  it('handles token with empty string refresh_token (removes it)', () => {
    const tokenEmptyRefresh: OAuthToken = {
      ...fullToken,
      refresh_token: '',
    };
    const result = sanitizeTokenForProxy(tokenEmptyRefresh);
    expect('refresh_token' in result).toBe(false);
  });

  /**
   * @requirement R10.3
   * @scenario Returns a new object — does not mutate input
   */
  it('returns new object — does not mutate input', () => {
    const original: OAuthToken = { ...fullToken };
    const result = sanitizeTokenForProxy(original);
    expect(result).not.toBe(original);
    expect(original.refresh_token).toBe('rt-secret');
  });

  /**
   * @requirement R10.1
   * @scenario Handles minimal token (only required fields)
   */
  it('handles minimal token (only required fields)', () => {
    const minimal: OAuthToken = {
      access_token: 'at-min',
      expiry: 1700002000,
      token_type: 'Bearer',
    };
    const result = sanitizeTokenForProxy(minimal);
    expect(result.access_token).toBe('at-min');
    expect(result.expiry).toBe(1700002000);
    expect(result.token_type).toBe('Bearer');
    expect('refresh_token' in result).toBe(false);
  });

  /**
   * @requirement R10.1
   * @scenario Result does NOT have refresh_token key at all (not just undefined)
   */
  it('result does NOT have refresh_token key (checked via in operator)', () => {
    const result = sanitizeTokenForProxy(fullToken);
    expect('refresh_token' in result).toBe(false);
    expect(Object.keys(result)).not.toContain('refresh_token');
  });

  /**
   * @requirement R10.2
   * @scenario Preserves resource_url provider-specific field
   */
  it('preserves resource_url when present', () => {
    const tokenWithResource: OAuthToken = {
      ...fullToken,
      resource_url: 'https://api.example.com',
    };
    const result = sanitizeTokenForProxy(tokenWithResource);
    expect(result.resource_url).toBe('https://api.example.com');
    expect('refresh_token' in result).toBe(false);
  });
});
