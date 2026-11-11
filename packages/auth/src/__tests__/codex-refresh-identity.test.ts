/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { CodexDeviceFlow } from '../flows/codex-device-flow.js';
import type { OAuthFetch } from '../types.js';

function idToken(accountId: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({
    'https://api.openai.com/auth': { account_id: accountId },
  })}.signature`;
}

function flowReturning(body: Record<string, unknown>): CodexDeviceFlow {
  const fetchTokens: OAuthFetch = async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  return new CodexDeviceFlow(fetchTokens);
}

const baseResponse = {
  access_token: 'new-access',
  refresh_token: 'new-refresh',
  token_type: 'Bearer',
  expires_in: 3600,
};

describe('CodexDeviceFlow.refreshToken identity handling (#3991)', () => {
  it('returns the rotated tokens with no account when the response has no id_token', async () => {
    const token = await flowReturning(baseResponse).refreshToken('old-refresh');

    expect({
      access: token.access_token,
      refresh: token.refresh_token,
      account: token.account_id,
      idToken: token.id_token,
    }).toStrictEqual({
      access: 'new-access',
      refresh: 'new-refresh',
      account: undefined,
      idToken: undefined,
    });
  });

  it('keeps the presented refresh token when the response does not rotate it', async () => {
    const token = await flowReturning({
      access_token: 'new-access',
      token_type: 'Bearer',
      expires_in: 3600,
    }).refreshToken('old-refresh');

    expect(token.refresh_token).toBe('old-refresh');
  });

  it('returns the account from a provided id_token', async () => {
    const token = await flowReturning({
      ...baseResponse,
      id_token: idToken('acct-changed'),
    }).refreshToken('old-refresh');

    expect(token.account_id).toBe('acct-changed');
  });

  it('rejects a provided id_token that carries no account', async () => {
    await expect(
      flowReturning({ ...baseResponse, id_token: 'not-a-jwt' }).refreshToken(
        'old-refresh',
      ),
    ).rejects.toThrow(Error);
  });

  it('keeps the code exchange strict: a response without id_token is rejected', async () => {
    const flow = flowReturning(baseResponse);
    const url = new URL(
      flow.buildAuthorizationUrl('http://127.0.0.1:1455/callback', 'state-1'),
    );

    await expect(
      flow.exchangeCodeForToken(
        'code',
        'http://127.0.0.1:1455/callback',
        url.searchParams.get('state') ?? 'state-1',
      ),
    ).rejects.toThrow(Error);
  });
});
