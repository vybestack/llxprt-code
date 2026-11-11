/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3991: a successful Codex refresh response that omits `id_token`
 * must keep the stored account identity and persist the rotated refresh
 * token, so the next request carries the new access token with the same
 * ChatGPT account.
 *
 * Real graph: network-injected CodexDeviceFlow -> CodexOAuthProvider ->
 * OAuthManager -> KeyringTokenStore (in-memory secure store). No network.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  KeyringTokenStore,
  type CodexOAuthToken,
  type OAuthToken,
} from '@vybestack/llxprt-code-auth';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import { OAuthManager } from '../oauth-manager.js';

interface Harness {
  readonly manager: OAuthManager;
  readonly store: KeyringTokenStore;
  readonly refreshRequests: string[];
}

const roots: string[] = [];
const managers: OAuthManager[] = [];

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(claims)}.signature`;
}

function accountIdToken(accountId: string): string {
  return jwt({ 'https://api.openai.com/auth': { account_id: accountId } });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function expiredStoredToken(
  accountId: string | undefined,
): OAuthToken | CodexOAuthToken {
  const base = {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    token_type: 'Bearer' as const,
    expiry: nowSeconds() - 600,
  };
  return accountId === undefined
    ? base
    : { ...base, account_id: accountId, id_token: accountIdToken(accountId) };
}

async function harness(refreshBody: Record<string, unknown>): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'codex-refresh-no-id-token-'));
  roots.push(root);
  const lockDir = join(root, 'locks');
  mkdirSync(lockDir, { recursive: true });
  const values = new Map<string, string>();
  const store = new KeyringTokenStore({
    lockDir,
    secureStore: {
      async get(key): Promise<string | null> {
        return values.get(key) ?? null;
      },
      async set(key, value): Promise<void> {
        values.set(key, value);
      },
      async delete(key): Promise<boolean> {
        return values.delete(key);
      },
      async list(): Promise<string[]> {
        return [...values.keys()];
      },
      async has(key): Promise<boolean> {
        return values.has(key);
      },
    },
  });
  const refreshRequests: string[] = [];
  const manager = new OAuthManager(store);
  managers.push(manager);
  manager.registerProvider(
    new CodexOAuthProvider(async (_input, init) => {
      refreshRequests.push(String(init?.body));
      return new Response(JSON.stringify(refreshBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }, store),
  );
  await manager.toggleOAuthEnabled('codex');
  return { manager, store, refreshRequests };
}

function pair(token: OAuthToken | null): {
  access: string | undefined;
  account: unknown;
} {
  return {
    access: token?.access_token,
    account:
      token !== null && 'account_id' in token ? token.account_id : undefined,
  };
}

describe('Codex refresh response without id_token (#3991)', () => {
  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.dispose()));
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('persists the rotated refresh token and preserved account, and the next read uses the new pair', async () => {
    const h = await harness({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    await h.store.saveToken('codex', expiredStoredToken('acct-original'));

    const refreshed = await h.manager.getOAuthToken('codex');
    const next = await h.manager.getOAuthToken('codex');
    const persisted: OAuthToken | null = await h.store.getToken('codex');

    expect({
      refreshed: pair(refreshed),
      next: pair(next),
      persisted: pair(persisted),
      persistedRefresh: persisted?.refresh_token,
      refreshCalls: h.refreshRequests.length,
    }).toStrictEqual({
      refreshed: { access: 'new-access', account: 'acct-original' },
      next: { access: 'new-access', account: 'acct-original' },
      persisted: { access: 'new-access', account: 'acct-original' },
      persistedRefresh: 'new-refresh',
      refreshCalls: 1,
    });
  });

  it('uses the changed account when the refresh response provides a valid id_token', async () => {
    const h = await harness({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: accountIdToken('acct-changed'),
    });
    await h.store.saveToken('codex', expiredStoredToken('acct-original'));

    const refreshed = await h.manager.getOAuthToken('codex');

    expect(pair(refreshed)).toStrictEqual({
      access: 'new-access',
      account: 'acct-changed',
    });
  });

  it('fails closed when the response has no id_token and the stored token has no account', async () => {
    const h = await harness({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    const stored = expiredStoredToken(undefined);
    await h.store.saveToken('codex', stored);

    const refreshed = await h.manager.getOAuthToken('codex');
    const persisted = await h.store.getToken('codex');

    expect({
      refreshedAccess: refreshed?.access_token,
      persistedAccess: persisted?.access_token,
      persistedRefresh: persisted?.refresh_token,
    }).toStrictEqual({
      refreshedAccess: undefined,
      persistedAccess: 'old-access',
      persistedRefresh: 'old-refresh',
    });
  });

  it('fails closed when the response has no id_token and the stored account is blank', async () => {
    const h = await harness({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    const blankAccount: CodexOAuthToken = {
      access_token: 'old-access',
      refresh_token: 'old-refresh',
      token_type: 'Bearer',
      expiry: nowSeconds() - 600,
      account_id: '   ',
    };
    await h.store.saveToken('codex', blankAccount);

    const refreshed = await h.manager.getOAuthToken('codex');
    const persisted = await h.store.getToken('codex');

    expect({
      refreshedAccess: refreshed?.access_token,
      persistedAccess: persisted?.access_token,
      persistedRefresh: persisted?.refresh_token,
    }).toStrictEqual({
      refreshedAccess: undefined,
      persistedAccess: 'old-access',
      persistedRefresh: 'old-refresh',
    });
  });

  it('fails closed without overwriting the stored token when a provided id_token is malformed', async () => {
    const h = await harness({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: 'not-a-jwt',
    });
    await h.store.saveToken('codex', expiredStoredToken('acct-original'));

    const refreshed = await h.manager.getOAuthToken('codex');
    const persisted: CodexOAuthToken | OAuthToken | null =
      await h.store.getToken('codex');

    expect({
      refreshedAccess: refreshed?.access_token,
      persistedAccess: persisted?.access_token,
      persistedRefresh: persisted?.refresh_token,
    }).toStrictEqual({
      refreshedAccess: undefined,
      persistedAccess: 'old-access',
      persistedRefresh: 'old-refresh',
    });
  });
});
