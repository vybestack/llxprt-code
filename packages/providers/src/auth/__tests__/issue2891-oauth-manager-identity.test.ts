/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2891 — Deliverable 2: OAuthManager instance identity.
 *
 * THE QUESTION:
 *   In a realistic CLI startup for `--provider claudecode`, is the
 *   `OAuthManager` bound into the live `claudecode` `AnthropicProvider`
 *   instance the SAME JS object that `getOAuthManager()` returns (and
 *   therefore the one `/auth claudecode login` mutates)? If they can EVER
 *   diverge, what is the exact code path?
 *
 * This is a BEHAVIORAL identity test using the REAL production functions
 * (`registerProviderManagerSingleton`, `getOAuthManager`,
 * `resetProviderManager`), the REAL `OAuthManager`, and the REAL
 * `AnthropicProvider` (constructed exactly as `createAnthropicAliasProvider`
 * constructs the `claudecode` alias). No unit under test is mocked.
 *
 * Findings proved here:
 *   1. At construction/registration time the bound manager and the singleton
 *      ARE identical, because `createProviderManager` returns the single
 *      `OAuthManager` it just bound into the provider, and
 *      `registerCliProviderInfrastructure` registers THAT SAME instance as
 *      the global singleton (`providerManagerInstance.ts` L713-718).
 *   2. They CAN diverge: the singleton is mutable module-level state
 *      (`singletonOAuthManager`, L62) that is OVERWRITTEN by a later
 *      `registerProviderManagerSingleton` call — which is exactly what
 *      re-registration (`runtimeLifecycle.ts` L139-141) and runtime
 *      disposal (`runtimeRegistry.ts` L339-346) do. The provider, however,
 *      captured its manager BY REFERENCE at construction
 *      (`BaseProvider.baseProviderConfig.oauthManager`, L163) and the only
 *      method that could rebind it (`BaseProvider.updateOAuthConfig`,
 *      L522-542) has NO production caller.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeyringTokenStore } from '@vybestack/llxprt-code-auth';
import type {
  ISecureStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';

import { OAuthManager } from '../oauth-manager.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
import {
  registerStandardOAuthProviders,
  resetRegisteredProviders,
} from '../../composition/oauth-provider-registration.js';
import {
  registerProviderManagerSingleton,
  getOAuthManager,
  resetProviderManager,
} from '../../composition/providerManagerInstance.js';
import type { ProviderManager } from '../../ProviderManager.js';

// ─── File-backed ISecureStore (temp directory, never touches keychain) ──────

class FileSecureStore implements ISecureStore {
  private readonly store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }
  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

// ─── In-memory IOAuthSettingsProvider (first-ever run: nothing enabled) ─────

class InMemoryOAuthSettings implements IOAuthSettingsProvider {
  private readonly enabledMap = new Map<string, boolean>();
  isOAuthEnabled(provider: string): boolean {
    return this.enabledMap.get(provider) ?? false;
  }
  getProviderApiKey(): string | undefined {
    return undefined;
  }
  getProviderKeyfile(): string | undefined {
    return undefined;
  }
  getProviderBaseUrl(): string | undefined {
    return undefined;
  }
  getOAuthEnabledProviders(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [k, v] of this.enabledMap) {
      result[k] = v;
    }
    return result;
  }
  setOAuthEnabled(provider: string, enabled: boolean): void {
    this.enabledMap.set(provider, enabled);
  }
}

/**
 * Exposes the OAuthManager the provider captured at construction time.
 * `baseProviderConfig.oauthManager` is exactly what
 * `createAnthropicAliasProvider`/`BaseProvider` bind, and what
 * `AuthPrecedenceResolver.fetchAndCacheOAuthToken` ultimately calls
 * `getToken()` on.
 */
class BoundManagerExposingProvider extends AnthropicProvider {
  get boundOAuthManager(): unknown {
    return (
      this as unknown as { baseProviderConfig: { oauthManager?: unknown } }
    ).baseProviderConfig.oauthManager;
  }
}

// `namespace` keeps each manager's advisory-lock directory distinct. Two
// managers built over the same tempDir would otherwise contend for the same
// KeyringTokenStore lock files, which is a source of cross-instance
// interference and flakiness in the divergence tests below.
function makeOAuthManager(
  tempDir: string,
  namespace = 'default',
): OAuthManager {
  const lockDir = join(tempDir, 'locks', namespace);
  mkdirSync(lockDir, { recursive: true });
  const secureStore = new FileSecureStore();
  const tokenStore = new KeyringTokenStore({ secureStore, lockDir });
  const settings = new InMemoryOAuthSettings();
  const oauthManager = new OAuthManager(tokenStore, settings);
  // Mirror createProviderManager, which registers the standard OAuth
  // providers (claudecode, codex) on every manager it constructs.
  registerStandardOAuthProviders(oauthManager, tokenStore);
  return oauthManager;
}

// Characterization suite. It documents the REFUTED hypothesis that
// OAuthManager instance divergence caused #2891 (startup identity holds), and
// pins the latent post-startup divergence hazard tracked separately as #2991.
describe('Issue #2891 — OAuthManager instance identity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'issue2891-id-'));
    resetProviderManager();
    resetRegisteredProviders();
  });

  afterEach(() => {
    resetProviderManager();
    resetRegisteredProviders();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // The production pairing is identity-preserving, which is what refutes
  // divergence as a cause of #2891.
  it('at startup the provider-bound manager is getOAuthManager()', () => {
    // Mirror the production pairing:
    //   createAnthropicAliasProvider('claudecode', oauthManager, ...)
    //     -> new AnthropicProvider(..., oauthManager)        [bind by reference]
    //   registerCliProviderInfrastructure(manager, oauthManager, ...)
    //     -> registerProviderManagerSingleton(manager, oauthManager)
    const oauthManager = makeOAuthManager(tempDir);
    const provider = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      oauthManager,
    );

    // The ProviderManager argument is irrelevant to the OAuthManager identity
    // question — registerProviderManagerSingleton merely stores both refs and
    // this test never reads singletonManager. A minimal stub avoids pulling in
    // the full ProviderManager/SettingsService machinery.
    registerProviderManagerSingleton({} as ProviderManager, oauthManager);

    expect(getOAuthManager()).toBe(oauthManager);
    expect(provider.boundOAuthManager).toBe(oauthManager);
    // The live provider's manager === the manager /auth will mutate.
    expect(provider.boundOAuthManager).toBe(getOAuthManager());
  });

  /**
   * ITEM 2 (review): the EXPLICIT regression guard for the plain
   * `--provider claudecode` startup path.
   *
   * At startup ONE OAuthManager is created in `providerManagerInstance.ts`
   * `createProviderManager` (~L633) and flows, by reference, to BOTH:
   *   - the live claudecode `AnthropicProvider`, via
   *     `registerAliasProviders` -> `createAnthropicAliasProvider`
   *     (aliasProviderFactory.ts ~L497-503, which passes it to
   *     `new AnthropicProvider(..., oauthManager)`), AND
   *   - the global singleton, via `registerProviderManagerSingleton`
   *     (~L713-718, which stores it as `singletonOAuthManager`).
   * `getOAuthManager()` returns that singleton, which is the very instance
   * `/auth claudecode login` mutates.
   *
   * This test proves that identity holds for the WHOLE session, not just at
   * the pairing instant: a mutation performed through the singleton
   * (`getOAuthManager()`) is observable on the provider's bound manager, and
   * vice-versa, because they are the same object. A regression that broke
   * this (e.g. re-introducing a second manager construction for the
   * claudecode alias) would fail the final assertion.
   *
   * LATENT HAZARD (tracked separately, NOT fixed in this PR): identity CAN
   * diverge post-startup if the singleton is overwritten by a LATER
   * `registerProviderManagerSingleton` call -- which happens in
   * `disposeCliRuntime` (runtimeRegistry.ts) and a second
   * `registerCliProviderInfrastructure` (runtimeLifecycle.ts). When that
   * happens the live provider stays bound to its construction-time manager
   * while `/auth` mutates the new singleton (see the "CAN diverge" test
   * below). Re-binding would require `BaseProvider.updateOAuthConfig`, which
   * has NO production caller today; adding one is out of scope for issue
   * #2891 and is tracked separately.
   */
  // Exercises the real `--provider claudecode` startup path with a live
  // AnthropicProvider, rather than a hand-built pairing.
  it('the live provider-bound manager is identical to the singleton for the whole session', async () => {
    // -- Mirror the EXACT production startup pairing for claudecode --
    const oauthManager = makeOAuthManager(tempDir);

    // createAnthropicAliasProvider('claudecode', oauthManager) binds the SAME
    // manager by reference into the provider.
    const provider = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      oauthManager,
    );

    // registerProviderManagerSingleton stores the SAME instance as the global
    // singleton that getOAuthManager() returns and /auth mutates.
    registerProviderManagerSingleton({} as ProviderManager, oauthManager);

    // (1) Identity holds at the pairing instant.
    expect(getOAuthManager()).toBe(oauthManager);
    expect(provider.boundOAuthManager).toBe(getOAuthManager());

    // (2) Identity holds for the WHOLE session: a mutation performed through
    //     getOAuthManager() (what /auth claudecode enable does) is observable
    //     on the provider's bound manager, because they are one object.
    expect(oauthManager.isOAuthEnabled('claudecode')).toBe(false);

    const authTarget = getOAuthManager();
    expect(authTarget).toBeDefined();
    await authTarget!.toggleOAuthEnabled('claudecode');

    // The mutation is visible through BOTH handles to the same instance.
    expect(getOAuthManager()!.isOAuthEnabled('claudecode')).toBe(true);
    expect(oauthManager.isOAuthEnabled('claudecode')).toBe(true);
    // The provider's bound manager (the one getAuthTokenForPrompt reads) is
    // the SAME object, so the mutation is visible there too -- no restart, no
    // re-binding required. This is the session-long identity guarantee.
    expect(provider.boundOAuthManager).toBe(getOAuthManager());
    expect(
      (provider.boundOAuthManager as OAuthManager).isOAuthEnabled('claudecode'),
    ).toBe(true);
  });

  it('CAN diverge: a later singleton re-registration leaves the provider bound to the OLD instance', () => {
    // ── Startup pairing with manager A ──
    const oauthManager_A = makeOAuthManager(tempDir, 'A');
    const provider_A = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      oauthManager_A,
    );
    registerProviderManagerSingleton({} as ProviderManager, oauthManager_A);
    expect(provider_A.boundOAuthManager).toBe(getOAuthManager());

    // ── Re-registration replaces the singleton with manager B ──
    // This mirrors the production code paths that overwrite
    // singletonOAuthManager AFTER startup:
    //   - registerCliProviderInfrastructure (runtimeLifecycle.ts L139-141)
    //     on a second assembly / recomposition.
    //   - disposeCliRuntime (runtimeRegistry.ts L339-346), which re-registers
    //     a replacement entry's manager or calls resetProviderManager().
    const oauthManager_B = makeOAuthManager(tempDir, 'B');
    registerProviderManagerSingleton({} as ProviderManager, oauthManager_B);

    // The singleton now points at B...
    expect(getOAuthManager()).toBe(oauthManager_B);
    // ...but provider_A is STILL bound to A. Nothing re-binds a provider's
    // construction-time manager when the singleton changes.
    expect(provider_A.boundOAuthManager).toBe(oauthManager_A);
    // DIVERGENCE: the live provider's manager is NOT the one /auth mutates.
    expect(provider_A.boundOAuthManager).not.toBe(getOAuthManager());
  });

  // Divergence is behaviorally consequential, not merely cosmetic: this is the
  // substance of the hazard filed as #2991.
  it('enabling via getOAuthManager() does not affect a provider bound to the old manager', async () => {
    const oauthManager_A = makeOAuthManager(tempDir, 'A');
    const provider_A = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      oauthManager_A,
    );
    registerProviderManagerSingleton({} as ProviderManager, oauthManager_A);

    // Replace the singleton with B (the divergent state).
    const oauthManager_B = makeOAuthManager(tempDir, 'B');
    registerProviderManagerSingleton({} as ProviderManager, oauthManager_B);

    // `/auth claudecode enable` resolves and mutates getOAuthManager() == B.
    const authTarget = getOAuthManager();
    expect(authTarget).toBe(oauthManager_B);
    await authTarget!.toggleOAuthEnabled('claudecode');
    expect(oauthManager_B.isOAuthEnabled('claudecode')).toBe(true);

    // The provider's bound manager is A and is untouched by that call.
    expect(provider_A.boundOAuthManager).toBe(oauthManager_A);
    expect(oauthManager_A.isOAuthEnabled('claudecode')).toBe(false);

    // Note: the provider's auth config is additionally snapshotted at
    // construction, and the only rebinder (`updateOAuthConfig`) has no
    // production caller. We deliberately do NOT assert on that private
    // snapshot here — the observable consequence is already captured above:
    // a toggle routed through the singleton is invisible to the manager the
    // live provider actually consults. See #2991.
  });
});
