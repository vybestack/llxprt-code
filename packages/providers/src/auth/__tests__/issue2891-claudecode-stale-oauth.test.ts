/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2891 reproduction: in-session stale OAuth state.
 *
 * Scenario (from the bug report):
 *   1. First prompt with claudecode NOT enabled → API Error (no auth).
 *   2. `/auth claudecode enable` then prompt again → SAME error (lazy
 *      browser flow never fires).
 *   3. `/auth claudecode login` → "Successfully authenticated" (token IS
 *      persisted to disk).
 *   4. Prompt again WITHOUT restarting → SAME error.
 *   5. Exit and restart → WORKS.
 *
 * This test replays that exact sequence in a single process using the REAL
 * object graph (real OAuthManager, ProviderRegistry, TokenAccessCoordinator,
 * AuthFlowOrchestrator, KeyringTokenStore, AnthropicProvider, and
 * AnthropicOAuthProvider) backed by a temp directory.  The ONLY boundary
 * stubbed is `AnthropicOAuthProvider.initiateAuth()` — the outermost
 * HTTP/browser exchange.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KeyringTokenStore } from '@vybestack/llxprt-code-auth';
import type {
  OAuthToken,
  ISecureStore,
  IOAuthSettingsProvider,
} from '@vybestack/llxprt-code-auth';

import { OAuthManager } from '../oauth-manager.js';
import {
  registerStandardOAuthProviders,
  resetRegisteredProviders,
} from '../../composition/oauth-provider-registration.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';

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
  private readonly apiKeys = new Map<string, string>();
  private readonly keyfiles = new Map<string, string>();
  private readonly baseUrls = new Map<string, string>();

  isOAuthEnabled(provider: string): boolean {
    return this.enabledMap.get(provider) ?? false;
  }
  getProviderApiKey(provider: string): string | undefined {
    return this.apiKeys.get(provider);
  }
  getProviderKeyfile(provider: string): string | undefined {
    return this.keyfiles.get(provider);
  }
  getProviderBaseUrl(provider: string): string | undefined {
    return this.baseUrls.get(provider);
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

// ─── Minimal test subclass that only exposes the existing protected method ──

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

interface ObjectGraph {
  tempDir: string;
  secureStore: FileSecureStore;
  tokenStore: KeyringTokenStore;
  settings: InMemoryOAuthSettings;
  oauthManager: OAuthManager;
  anthropicProvider: TestableAnthropicProvider;
}

/**
 * Build a fresh object graph backed by real auth components.
 *
 * When `sharedSecureStore` is provided (the restart/replay case), the new
 * graph reads and writes through the SAME ISecureStore instance as the
 * original graph. This mirrors a real process restart that re-reads the
 * persisted OS keychain — the token written before the restart is visible
 * without any hand-copying.
 */
function buildObjectGraph(
  tempDir: string,
  sharedSecureStore?: FileSecureStore,
): ObjectGraph {
  const lockDir = join(tempDir, 'locks');
  mkdirSync(lockDir, { recursive: true });

  const secureStore = sharedSecureStore ?? new FileSecureStore();
  const tokenStore = new KeyringTokenStore({
    secureStore,
    lockDir,
  });

  // Mirror a first-ever run: nothing enabled.
  const settings = new InMemoryOAuthSettings();

  const oauthManager = new OAuthManager(tokenStore, settings);

  // Register the REAL AnthropicOAuthProvider (and Codex).
  registerStandardOAuthProviders(oauthManager, tokenStore);

  // Build the REAL AnthropicProvider with the SAME OAuthManager instance,
  // the way createAnthropicAliasProvider does.
  const anthropicProvider = new TestableAnthropicProvider(
    undefined, // apiKey — none
    undefined, // baseURL — none (default api.anthropic.com)
    undefined, // IProviderConfig — none
    oauthManager,
  );

  return {
    tempDir,
    secureStore,
    tokenStore,
    settings,
    oauthManager,
    anthropicProvider,
  };
}

// ─── Test ───────────────────────────────────────────────────────────────────

describe('Issue #2891 — in-session stale OAuth state', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'issue2891-'));
    resetRegisteredProviders();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves the freshly persisted token in the same session AND after a simulated restart', async () => {
    const graph = buildObjectGraph(tempDir);
    const { oauthManager, anthropicProvider, tokenStore } = graph;

    // --- Stub ONLY the outermost boundary: AnthropicOAuthProvider.initiateAuth
    const oauthProvider = requireOAuthProvider(oauthManager, 'claudecode');

    // Phase 0: initially, initiateAuth is NOT available (simulates the lazy
    // browser flow never opening). We flip the flag to success only when the
    // user explicitly runs `/auth claudecode login`.
    let initiateAuthShouldSucceed = false;
    // Counting invocations lets each phase assert DIRECTLY whether the lazy
    // browser flow was attempted, instead of inferring it from a thrown error.
    let initiateAuthCalls = 0;
    const validToken = makeValidToken();
    oauthProvider.initiateAuth = async (): Promise<OAuthToken> => {
      initiateAuthCalls++;
      if (!initiateAuthShouldSucceed) {
        throw new Error('test: browser flow not triggered yet');
      }
      return validToken;
    };

    // ─── Phase A: First prompt (OAuth NOT enabled) ───────────────────────
    const tokenA = await anthropicProvider.testGetAuthTokenForPrompt();
    expect(tokenA).toBe(''); // Expected: no auth available

    // ─── Phase B: `/auth claudecode enable` ──────────────────────────────
    await oauthManager.toggleOAuthEnabled('claudecode');
    expect(oauthManager.isOAuthEnabled('claudecode')).toBe(true);

    // ─── Phase C: Second prompt (OAuth enabled, no token, lazy flow fails)
    const callsBeforeC = initiateAuthCalls;
    const tokenC = await anthropicProvider.testGetAuthTokenForPrompt();
    expect(tokenC).toBe(''); // Expected: lazy flow fails, no token
    // The lazy flow WAS attempted here (and threw), rather than being skipped.
    expect(initiateAuthCalls).toBeGreaterThan(callsBeforeC);

    // Verify no token was saved during the failed lazy flow.
    const storedBefore = await tokenStore.getToken('claudecode', undefined);
    expect(storedBefore).toBeNull();

    // ─── Phase D: `/auth claudecode login` (explicit login) ─────────────
    initiateAuthShouldSucceed = true;
    await oauthManager.authenticate('claudecode');
    initiateAuthShouldSucceed = false; // reset to guard against re-trigger

    // Verify the token REALLY landed in the store.
    const storedAfter = await tokenStore.getToken('claudecode', undefined);
    expect(storedAfter).not.toBeNull();
    expect(storedAfter?.access_token).toBe(validToken.access_token);

    // ─── Phase E: Third prompt WITHOUT restart ──────────────────────────
    // This is the phase the bug report says fails. It does NOT fail here,
    // and that negative result is the point of this test — see the closing
    // assertion and the file header.
    const callsBeforeE = initiateAuthCalls;
    const tokenE = await anthropicProvider.testGetAuthTokenForPrompt();

    // The persisted token is served directly: no browser flow is re-triggered.
    expect(initiateAuthCalls).toBe(callsBeforeE);

    // ─── Phase F: Fresh object graph over the SAME persisted credential
    // storage (simulates a process restart).
    //
    // The restart graph shares the SAME ISecureStore instance as the
    // original graph, so the token persisted in Phase D is visible to it
    // without any hand-copying — exactly like a real restart re-reading
    // the OS keychain.
    const restartDir = join(tempDir, 'restart');
    mkdirSync(restartDir, { recursive: true });
    const restartGraph = buildObjectGraph(restartDir, graph.secureStore);

    // The persisted settings reflect that the user previously enabled OAuth
    // for claudecode. Enable it EXACTLY ONCE. Do NOT also call
    // toggleOAuthEnabled — that would flip the persisted-true back to false
    // (the original harness bug that made Phase F wrongly resolve to '').
    restartGraph.settings.setOAuthEnabled('claudecode', true);
    expect(restartGraph.oauthManager.isOAuthEnabled('claudecode')).toBe(true);

    // Sanity: the token is genuinely visible through the shared store — no
    // hand-copy happened.
    const persistedToken = await restartGraph.tokenStore.getToken(
      'claudecode',
      undefined,
    );
    expect(persistedToken?.access_token).toBe(validToken.access_token);

    // Re-stub the boundary so a lazy flow is never attempted post-restart.
    const restartProvider = requireOAuthProvider(
      restartGraph.oauthManager,
      'claudecode',
    );
    restartProvider.initiateAuth = async () => {
      throw new Error('test: should not be needed after restart');
    };

    const tokenF =
      await restartGraph.anthropicProvider.testGetAuthTokenForPrompt();

    // The restart should work.
    expect(tokenF).toBe(validToken.access_token);

    // The decisive characterization result: the same-session read (Phase E)
    // resolves the persisted token just like the post-restart read (Phase F).
    //
    // This is what REFUTES the "stale empty credential cache" hypothesis from
    // the issue thread. There is no negative caching to flush:
    // `fetchAndCacheOAuthToken` returns null WITHOUT storing, and
    // `storeRuntimeScopedToken` only ever stores real tokens. So the fix for
    // #2891 is the lazy-OAuth gating in providerSwitch.ts, NOT a cache flush.
    //
    // Consequently this assertion holds both before and after the fix; it is a
    // lock-in of correct behavior, not a guard on the fix.
    expect(tokenE).toBe(validToken.access_token);
  });
});
