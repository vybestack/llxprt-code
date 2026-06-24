/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// @plan:PLAN-20260622-COREAPIGAP.P11
// @requirement:REQ-005
//
// Behavioral suite for the masked auth-detail surface on AgentAuthControl
// (detailedStatus / getHigherPriorityAuth / listBucketStatuses). Drives a REAL
// OAuthManager over an in-memory TokenStore with a REAL registered provider —
// NO mock theater. The control is constructed directly over the live manager
// (the blessed direct-construction precedent shared with HookControl /
// McpControl), so the masked OAuth detail path is exercised through real
// delegation, not spies/stubs.
//
// `AuthControlDeps` carries `getOAuthManager` (see `makeDeps`), and `makeControl`
// instantiates `new AuthControl(deps)` directly with no cast — the masked
// detail methods delegate live to the real manager.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type {
  OAuthToken,
  OAuthProvider,
  TokenStore,
} from '@vybestack/llxprt-code-providers/auth.js';
import { AuthControl } from '../control/authControl.js';
import type { AuthControlDeps } from '../control/authControl.js';
import { createAgentAuthState } from '../control/authState.js';
import type { AuthStatus } from '../agent.js';

// ─── Hermetic in-memory TokenStore (mirrors the providers-package convention) ─

/**
 * Minimal in-memory TokenStore. Declared inline (NOT imported from the
 * providers __tests__ tree) so this behavior test depends only on the public
 * `@vybestack/llxprt-code-providers/auth.js` types + the control under test.
 */
class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  private toKey(provider: string, bucket?: string): string {
    return `${provider}:${bucket ?? 'default'}`;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.toKey(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.toKey(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.toKey(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const key of this.tokens.keys()) {
      providers.add(key.split(':')[0]);
    }
    return Array.from(providers);
  }

  async listBuckets(provider: string): Promise<string[]> {
    const prefix = `${provider}:`;
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        buckets.push(key.slice(prefix.length));
      }
    }
    return buckets;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROVIDER = 'myprov';

/** A real plain-object OAuthProvider so registerProvider + isOAuthEnabled hold. */
function makeRealProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: async (): Promise<OAuthToken> => ({
      access_token: 'init',
      refresh_token: 'init-refresh',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: '',
    }),
    getToken: async (): Promise<OAuthToken | null> => null,
    refreshToken: async (): Promise<OAuthToken | null> => null,
  };
}

/** Builds a real OAuthManager over a fresh MemoryTokenStore, provider enabled. */
async function makeManager(): Promise<{
  mgr: OAuthManager;
  store: MemoryTokenStore;
}> {
  const store = new MemoryTokenStore();
  const mgr = new OAuthManager(store);
  mgr.registerProvider(makeRealProvider(PROVIDER));
  // registerProvider does NOT enable OAuth by default; flip it on.
  await mgr.toggleOAuthEnabled(PROVIDER);
  return { mgr, store };
}

/** Builds a real AuthControlDeps over the live manager. */
function makeDeps(mgr: OAuthManager): AuthControlDeps {
  const authState = createAgentAuthState();
  return {
    authState,
    getCurrentProvider: () => PROVIDER,
    getKeyName: () => undefined,
    getStatus: (): AuthStatus => 'unauthenticated',
    onOAuthPrompt: undefined,
    setBaseUrl: async () => {},
    keysDeps: {
      authState,
      getKeyName: () => undefined,
      setKeyName: () => {},
      updateProviderApiKey: async () => {},
    },
    getOAuthManager: () => mgr,
  };
}

/** Builds the control directly over the real manager (direct-construction seam). */
function makeControl(mgr: OAuthManager): AuthControl {
  const deps = makeDeps(mgr);
  return new AuthControl(deps);
}

/** Deep-collects every object key reachable from a value (arrays + nested objs). */
function deepKeys(value: unknown): string[] {
  const keys: string[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) {
        visit(item);
      }
      return;
    }
    if (v !== null && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        keys.push(k);
        visit(obj[k]);
      }
    }
  };
  visit(value);
  return keys;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

describe('REQ-005 auth detail — masked OAuth metadata (P11 RED)', () => {
  it('T13 detailedStatus: oauth-enabled + seeded non-expired token returns masked detail with seeded expiry (REQ-005.1)', async () => {
    const { mgr, store } = await makeManager();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    await store.saveToken(PROVIDER, {
      access_token: 'SECRET-do-not-leak',
      refresh_token: 'REFRESH-do-not-leak',
      expiry,
      token_type: 'Bearer',
      scope: '',
    });
    const control = makeControl(mgr);

    const detail = await control.detailedStatus(PROVIDER);

    expect(detail.provider).toBe(PROVIDER);
    expect(detail.authenticated).toBe(true);
    expect(detail.oauthEnabled).toBe(true);
    expect(detail.expiry).toBe(expiry);
    const keys = deepKeys(detail);
    expect(keys).not.toContain('access_token');
    expect(keys).not.toContain('refresh_token');
  });

  it('T13b detailedStatus edge: enabled-but-no-token is unauthenticated; oauth-disabled reports oauthEnabled false (REQ-005.1)', async () => {
    const { mgr } = await makeManager();
    const control = makeControl(mgr);

    // (a) OAuth enabled, no stored token → authenticated false, no expiry.
    const noToken = await control.detailedStatus(PROVIDER);
    expect(noToken.authenticated).toBe(false);
    expect(noToken.oauthEnabled).toBe(true);
    expect(noToken.expiry).toBeUndefined();

    // (b) OAuth disabled for a provider → oauthEnabled false.
    await mgr.toggleOAuthEnabled(PROVIDER);
    const disabled = await control.detailedStatus(PROVIDER);
    expect(disabled.oauthEnabled).toBe(false);
    expect(disabled.authenticated).toBe(false);
    expect(disabled.expiry).toBeUndefined();
  });

  it('T13c listBucketStatuses: two buckets (default + session) project to exactly the four public fields (REQ-005.3)', async () => {
    const { mgr, store } = await makeManager();
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    // Seed the default bucket.
    await store.saveToken(
      PROVIDER,
      {
        access_token: 'SECRET-do-not-leak',
        refresh_token: 'REFRESH-do-not-leak',
        expiry,
        token_type: 'Bearer',
        scope: '',
      },
      'default',
    );
    // Seed a second named bucket.
    await store.saveToken(
      PROVIDER,
      {
        access_token: 'SECRET-bucket-do-not-leak',
        refresh_token: 'REFRESH-bucket-do-not-leak',
        expiry,
        token_type: 'Bearer',
        scope: '',
      },
      'work',
    );
    // Mark the 'work' bucket as the session bucket.
    mgr.setSessionBucket(PROVIDER, 'work');
    const control = makeControl(mgr);

    const buckets = await control.listBucketStatuses(PROVIDER);

    expect(buckets).toHaveLength(2);
    const allowed = new Set([
      'bucket',
      'authenticated',
      'expiry',
      'isSessionBucket',
    ]);
    const sessionBucket = buckets.find((b) => b.bucket === 'work');
    expect(sessionBucket).toBeDefined();
    expect(sessionBucket?.isSessionBucket).toBe(true);
    expect(sessionBucket?.authenticated).toBe(true);
    expect(sessionBucket?.expiry).toBe(expiry);
    for (const b of buckets) {
      const keys = Object.keys(b).sort();
      // Each element exposes exactly the four public fields — no secrets.
      expect(keys).toStrictEqual(Array.from(allowed).sort());
    }
    // Belt-and-suspenders: no secret key anywhere in the projection.
    const allKeys = deepKeys(buckets);
    expect(allKeys).not.toContain('access_token');
    expect(allKeys).not.toContain('refresh_token');
  });

  it('T13d getHigherPriorityAuth: with no higher-priority method configured returns null (string-or-null contract) (REQ-005.2)', async () => {
    const { mgr } = await makeManager();
    const control = makeControl(mgr);

    const result = await control.getHigherPriorityAuth(PROVIDER);

    // No api-key / env precedence configured over a fresh manager → null.
    expect(result).toBeNull();
  });

  // ─── Property: no secret leak across generated tokens ─────────────────────
  it('PROP no-secret-leak: for generated tokens, detailedStatus deep keys contain neither access_token nor refresh_token and expiry round-trips (REQ-005.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        fc.integer({ min: 1, max: 100000 }),
        async (accessTok, refreshTok, expiresIn) => {
          const { mgr, store } = await makeManager();
          const expiry = Math.floor(Date.now() / 1000) + expiresIn;
          await store.saveToken(PROVIDER, {
            access_token: accessTok,
            refresh_token: refreshTok,
            expiry,
            token_type: 'Bearer',
            scope: '',
          });
          const control = makeControl(mgr);

          const detail = await control.detailedStatus(PROVIDER);

          const keys = deepKeys(detail);
          expect(keys).not.toContain('access_token');
          expect(keys).not.toContain('refresh_token');
          // Authenticated path must round-trip the seeded expiry exactly.
          expect(detail.authenticated).toBe(true);
          expect(detail.expiry).toBe(expiry);
        },
      ),
    );
  });

  // ─── Property: expiry gating behind authenticated ─────────────────────────
  it('PROP expiry-gating: detailedStatus only carries a defined expiry when authenticated is true (REQ-005.1)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (seedToken) => {
        const { mgr, store } = await makeManager();
        if (seedToken) {
          await store.saveToken(PROVIDER, {
            access_token: 'SECRET-do-not-leak',
            refresh_token: 'REFRESH-do-not-leak',
            expiry: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'Bearer',
            scope: '',
          });
        }
        const control = makeControl(mgr);

        const detail = await control.detailedStatus(PROVIDER);

        // Gating invariant, asserted without branching: expiry is defined
        // exactly when authenticated is true (a seeded non-expired token).
        expect(detail.expiry !== undefined).toBe(detail.authenticated);
        // And authenticated tracks whether a token was seeded.
        expect(detail.authenticated).toBe(seedToken);
      }),
    );
  });
});
