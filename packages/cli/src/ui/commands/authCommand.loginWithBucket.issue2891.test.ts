/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2891 — ITEM 1: behavioral coverage for symptom (b) through the REAL
 * `/auth claudecode login` command path.
 *
 * Why this file exists separately from
 * packages/providers/.../issue2891-claudecode-stale-oauth.test.ts:
 *   That test drives login by calling `oauthManager.authenticate('claudecode')`
 *   DIRECTLY. It therefore bypasses `AuthCommandExecutor.loginWithBucket`
 *   (packages/cli/.../authCommand.ts), which is the ONLY place fix #3
 *   (`this.clearProviderCache(provider)` + `invalidateProviderRuntimeCache`)
 *   lives. A test that never reaches that code path would pass on unpatched
 *   code and proves nothing about symptom (b).
 *
 * This test instead drives the REAL command entry point
 * (`executor.execute(ctx, 'claudecode login')` → `loginWithBucket`), so the
 * cache-invalidation step fix #3 added actually executes as part of the login
 * flow, and asserts the USER-VISIBLE outcome on the SAME live provider
 * instance: no token before login, the freshly persisted token after — with no
 * restart and no reconstructed object graph.
 *
 * HONEST SCOPE NOTE — this is a CHARACTERIZATION / regression guard, not a
 * bug reproduction. It was verified to pass BOTH with and without fix #3
 * (mutation-checked by reverting authCommand.ts and re-running). That is the
 * expected result and is itself the finding: symptom (b) does NOT reproduce in
 * the real object graph, because a failed lookup is never negatively cached, so
 * there is no stale empty entry for login to flush. The value of this test is
 * that it locks in the "login → next prompt sees the token without a restart"
 * property end-to-end through the real command path, so a future change that
 * DOES introduce credential caching cannot silently reintroduce #2891(b).
 *
 * The ONLY boundary stubbed is `AnthropicOAuthProvider.initiateAuth` (the
 * outermost HTTP/browser exchange). Everything else — OAuthManager,
 * KeyringTokenStore, ProviderRegistry, TokenAccessCoordinator,
 * AuthFlowOrchestrator, AnthropicProvider, AuthCommandExecutor — is the real
 * production code.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KeyringTokenStore,
  ensureRuntimeState,
  storeRuntimeScopedToken,
  runtimeScopedStates,
} from '@vybestack/llxprt-code-auth';
import type {
  OAuthToken,
  ISecureStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';
import { AnthropicProvider } from '@vybestack/llxprt-code-providers';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import {
  registerStandardOAuthProviders,
  resetRegisteredProviders,
} from '@vybestack/llxprt-code-providers/composition/oauth-provider-registration.js';

import { AuthCommandExecutor } from './authCommand.js';
import type { CommandContext } from './types.js';

// ─── In-memory ISecureStore (never touches the filesystem or keychain) ──────

class InMemorySecureStore implements ISecureStore {
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

// ─── Exposes BaseProvider.getAuthTokenForPrompt() for direct assertion ──────

class TestableAnthropicProvider extends AnthropicProvider {
  async testGetAuthTokenForPrompt(): Promise<string> {
    return this.getAuthTokenForPrompt();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeValidToken(): OAuthToken {
  const expiry = Math.floor(Date.now() / 1000) + 86400; // 24h future
  return {
    access_token: 'sk-ant-oat-test-2891-valid',
    refresh_token: 'refresh-2891',
    expiry,
    token_type: 'Bearer',
    scope: 'user:inference',
  };
}

interface ObjectGraph {
  tempDir: string;
  tokenStore: KeyringTokenStore;
  settings: InMemoryOAuthSettings;
  oauthManager: OAuthManager;
  anthropicProvider: TestableAnthropicProvider;
}

function buildObjectGraph(tempDir: string): ObjectGraph {
  const lockDir = join(tempDir, 'locks');
  mkdirSync(lockDir, { recursive: true });

  const secureStore = new InMemorySecureStore();
  const tokenStore = new KeyringTokenStore({ secureStore, lockDir });
  const settings = new InMemoryOAuthSettings();
  const oauthManager = new OAuthManager(tokenStore, settings);

  registerStandardOAuthProviders(oauthManager, tokenStore);

  // Construct the AnthropicProvider with the SAME OAuthManager instance, the
  // way createAnthropicAliasProvider binds the `claudecode` alias.
  const anthropicProvider = new TestableAnthropicProvider(
    undefined, // apiKey — none
    undefined, // baseURL — none (default api.anthropic.com)
    undefined, // IProviderConfig — none
    oauthManager,
  );

  return { tempDir, tokenStore, settings, oauthManager, anthropicProvider };
}

// `execute()` never reads `context` on the login path; it only parses args.
// A minimal context avoids pulling in the full UI/runtime construction.
/**
 * Fetch a registered OAuth provider, failing loudly when absent. Lives at
 * module scope so the narrowing guard is not a conditional inside a test body.
 */
function requireOAuthProvider(oauthManager: OAuthManager, name: string) {
  const provider = oauthManager.getProvider(name);
  if (!provider) {
    throw new Error(`OAuth provider '${name}' is not registered`);
  }
  return provider;
}

function makeCommandContext(): CommandContext {
  return {
    services: {
      config: null,
      settings: {} as never,
      git: undefined,
      logger: {} as never,
    },
    ui: {} as never,
    session: {} as never,
  } as unknown as CommandContext;
}

function requireTempDir(dir: string | undefined): string {
  if (dir === undefined) {
    throw new Error('Expected beforeEach to create a temp directory');
  }
  return dir;
}

/**
 * Seed the REAL runtime-scoped auth cache with a live token entry.
 *
 * `ensureRuntimeState` only reads `runtimeId` and assigns `metadata`; the
 * `settingsService` member of `IProviderRuntimeContext` is never touched on
 * this path, so a minimal stand-in avoids constructing the settings stack.
 */
function seedRuntimeCacheEntry(
  runtimeId: string,
  providerId: string,
  token: string,
): void {
  const state = ensureRuntimeState({
    runtimeId,
    settingsService: {} as never,
  });
  storeRuntimeScopedToken(state, providerId, 'default', token);
}

/** Provider ids that still hold a LIVE (non-invalidated) cache entry. */
function cachedProviderIds(runtimeId: string): string[] {
  const state = runtimeScopedStates.get(runtimeId);
  if (!state) {
    return [];
  }
  return [...state.entries.values()].map((entry) => entry.providerId).sort();
}

// ─── Test ───────────────────────────────────────────────────────────────────

describe('Issue #2891 (b) (characterization) — /auth claudecode login makes the token visible WITHOUT restart, through the REAL command path', () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'issue2891-loginpath-'));
    resetRegisteredProviders();
  });

  afterEach(() => {
    // Guard against `beforeEach` having thrown before `tempDir` was assigned;
    // an unguarded rmSync would raise a TypeError that masks the real failure.
    if (tempDir === undefined) {
      return;
    }
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('the SAME live AnthropicProvider yields no token before login and the persisted token after login (driven via AuthCommandExecutor.execute)', async () => {
    const graph = buildObjectGraph(requireTempDir(tempDir));
    const { oauthManager, anthropicProvider, tokenStore } = graph;

    // The real executor that owns the `/auth claudecode login` command.
    const executor = new AuthCommandExecutor(oauthManager);

    // Stub ONLY the outermost browser boundary. The flag gates whether a login
    // attempt resolves a token or rejects (mirrors the user not having
    // completed the flow yet).
    const oauthProvider = requireOAuthProvider(oauthManager, 'claudecode');

    let initiateAuthShouldSucceed = false;
    const validToken = makeValidToken();
    oauthProvider.initiateAuth = async (): Promise<OAuthToken> => {
      if (!initiateAuthShouldSucceed) {
        throw new Error('test: browser flow not triggered / not completed');
      }
      return validToken;
    };

    // Mirror `/auth claudecode enable` so the provider's OAuth resolution path
    // is active (the reporter had already enabled OAuth before login).
    await oauthManager.toggleOAuthEnabled('claudecode');
    expect(oauthManager.isOAuthEnabled('claudecode')).toBe(true);

    // ─── BEFORE login: OAuth enabled, no persisted token → no auth ───────
    const storedBefore = await tokenStore.getToken('claudecode', undefined);
    expect(storedBefore).toBeNull();

    const tokenBeforeLogin =
      await anthropicProvider.testGetAuthTokenForPrompt();
    expect(tokenBeforeLogin).toBe('');

    // ─── Drive login through the REAL `/auth claudecode login` path ──────
    // This routes through execute() → loginWithBucket(), which is the ONLY
    // place fix #3 (clearProviderCache + invalidateProviderRuntimeCache) lives.
    initiateAuthShouldSucceed = true;
    const loginResult = await executor.execute(
      makeCommandContext(),
      'claudecode login',
    );
    initiateAuthShouldSucceed = false; // reset; guard against re-trigger

    // The command reports success to the user.
    expect(loginResult).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Successfully authenticated claudecode',
    });

    // The token REALLY landed in the store.
    const storedAfter = await tokenStore.getToken('claudecode', undefined);
    expect(storedAfter).not.toBeNull();
    expect(storedAfter?.access_token).toBe(validToken.access_token);

    // ─── AFTER login, SAME live provider instance, NO restart ───────────
    const tokenAfterLogin = await anthropicProvider.testGetAuthTokenForPrompt();
    expect(tokenAfterLogin).toBe(validToken.access_token);
  });
});

/**
 * Issue #2891 — FIX 3 mutation guard.
 *
 * Unlike the characterization test above, this block FAILS when the fix is
 * reverted. `loginWithBucket` (packages/cli/.../authCommand.ts) calls
 * `invalidateProviderRuntimeCache(provider)` after a successful login; deleting
 * that line leaves the pre-existing claudecode entry live and these assertions
 * fail.
 *
 * The invalidation is observed through its REAL effect on the runtime-scoped
 * auth cache (`runtimeScopedStates`) rather than by spying on the function, so
 * the test constrains behaviour rather than call bookkeeping.
 */
describe('Issue #2891 FIX 3 — a successful login invalidates the runtime credential cache for THAT provider only', () => {
  const runtimeId = 'issue2891-login-invalidation-runtime';
  let tempDir: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'issue2891-invalidation-'));
    resetRegisteredProviders();
    runtimeScopedStates.delete(runtimeId);
  });

  afterEach(() => {
    runtimeScopedStates.delete(runtimeId);
    if (tempDir === undefined) {
      return;
    }
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  /**
   * Builds the real object graph plus an executor whose browser boundary is
   * controlled by the returned `setLoginSucceeds` switch.
   */
  function setUp() {
    const graph = buildObjectGraph(requireTempDir(tempDir));
    const executor = new AuthCommandExecutor(graph.oauthManager);
    const oauthProvider = requireOAuthProvider(
      graph.oauthManager,
      'claudecode',
    );

    let loginSucceeds = true;
    oauthProvider.initiateAuth = async (): Promise<OAuthToken> => {
      if (!loginSucceeds) {
        throw new Error('test: browser flow cancelled');
      }
      return makeValidToken();
    };

    // A previously cached token for claudecode, plus an unrelated provider that
    // must survive untouched.
    seedRuntimeCacheEntry(runtimeId, 'claudecode', 'stale-claudecode-token');
    seedRuntimeCacheEntry(runtimeId, 'codex', 'unrelated-codex-token');
    expect(cachedProviderIds(runtimeId)).toStrictEqual(['claudecode', 'codex']);

    return {
      executor,
      setLoginSucceeds: (value: boolean) => {
        loginSucceeds = value;
      },
    };
  }

  it('drops the stale claudecode entry and leaves other providers cached', async () => {
    const { executor } = setUp();

    const result = await executor.execute(
      makeCommandContext(),
      'claudecode login',
    );

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content: 'Successfully authenticated claudecode',
    });

    // Reverting `invalidateProviderRuntimeCache(provider)` leaves 'claudecode'
    // in this list, failing the assertion.
    expect(cachedProviderIds(runtimeId)).toStrictEqual(['codex']);
  });

  it('leaves the cache untouched when the login FAILS', async () => {
    const { executor, setLoginSucceeds } = setUp();
    setLoginSucceeds(false);

    const result = await executor.execute(
      makeCommandContext(),
      'claudecode login',
    );

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Authentication failed for claudecode: test: browser flow cancelled',
    });

    // Invalidation lives after the success path, so a failed login must not
    // discard credentials that are still valid.
    expect(cachedProviderIds(runtimeId)).toStrictEqual(['claudecode', 'codex']);
  });
});
