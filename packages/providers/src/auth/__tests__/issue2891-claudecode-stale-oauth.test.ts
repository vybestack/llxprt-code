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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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

/**
 * A graph plus a controllable stub of the ONLY mocked boundary,
 * `AnthropicOAuthProvider.initiateAuth` (the browser flow).
 *
 * `initiateAuthCalls` is deliberately observed: whether the browser window
 * opens is itself the user-visible behavior #2891 is about ("never launches
 * lazy browser OAuth"). It is always asserted alongside an outcome assertion
 * (token value or token-store contents), never as the sole signal.
 */
interface Harness extends ObjectGraph {
  readonly validToken: OAuthToken;
  initiateAuthCalls: () => number;
  setBrowserFlowSucceeds: (succeeds: boolean) => void;
}

function buildHarness(tempDir: string): Harness {
  const graph = buildObjectGraph(tempDir);
  const oauthProvider = requireOAuthProvider(graph.oauthManager, 'claudecode');

  let succeeds = false;
  let calls = 0;
  const validToken = makeValidToken();

  oauthProvider.initiateAuth = async (): Promise<OAuthToken> => {
    calls++;
    if (!succeeds) {
      throw new Error('test: browser flow not triggered yet');
    }
    return validToken;
  };

  return {
    ...graph,
    validToken,
    initiateAuthCalls: () => calls,
    setBrowserFlowSucceeds: (value: boolean) => {
      succeeds = value;
    },
  };
}

/**
 * Drive the harness through the pre-login phases the reporter described:
 * a first prompt with OAuth off, `/auth claudecode enable`, then a second
 * prompt where the lazy flow is attempted and fails.
 */
async function reachEnabledButUnauthenticated(harness: Harness): Promise<void> {
  const tokenA = await harness.anthropicProvider.testGetAuthTokenForPrompt();
  expect(tokenA).toBe('');

  await harness.oauthManager.toggleOAuthEnabled('claudecode');
  expect(harness.oauthManager.isOAuthEnabled('claudecode')).toBe(true);
}

/** Perform the explicit `/auth claudecode login`, leaving the flow re-armed. */
async function performExplicitLogin(harness: Harness): Promise<void> {
  harness.setBrowserFlowSucceeds(true);
  await harness.oauthManager.authenticate('claudecode');
  // Re-arm the failure so any LATER browser attempt is unmistakable.
  harness.setBrowserFlowSucceeds(false);
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

  it('yields no token before OAuth is enabled', async () => {
    const harness = buildHarness(tempDir);

    expect(await harness.anthropicProvider.testGetAuthTokenForPrompt()).toBe(
      '',
    );
    expect(
      await harness.tokenStore.getToken('claudecode', undefined),
    ).toBeNull();
  });

  it('attempts the lazy browser flow — and persists nothing — when enabled but unauthenticated', async () => {
    const harness = buildHarness(tempDir);
    await reachEnabledButUnauthenticated(harness);

    const callsBefore = harness.initiateAuthCalls();
    const token = await harness.anthropicProvider.testGetAuthTokenForPrompt();

    // Outcome: still no usable credential for the prompt...
    expect(token).toBe('');
    // ...and the failed attempt persisted nothing (no negative entry either).
    expect(
      await harness.tokenStore.getToken('claudecode', undefined),
    ).toBeNull();
    // ...and the browser flow WAS attempted rather than silently skipped,
    // which is the user-visible symptom #2891 reports as missing.
    expect(harness.initiateAuthCalls()).toBeGreaterThan(callsBefore);
  });

  it('persists the token to the store on an explicit /auth claudecode login', async () => {
    const harness = buildHarness(tempDir);
    await reachEnabledButUnauthenticated(harness);
    await performExplicitLogin(harness);

    const stored = await harness.tokenStore.getToken('claudecode', undefined);
    expect(stored).not.toBeNull();
    expect(stored?.access_token).toBe(harness.validToken.access_token);
  });

  it('serves the freshly persisted token in the SAME session, without a restart and without re-opening the browser', async () => {
    const harness = buildHarness(tempDir);
    await reachEnabledButUnauthenticated(harness);
    await performExplicitLogin(harness);

    const callsBefore = harness.initiateAuthCalls();
    const token = await harness.anthropicProvider.testGetAuthTokenForPrompt();

    // The reporter says THIS read still fails. It does not: the persisted
    // token is served directly, and no new browser flow is triggered.
    //
    // Scope note: this pins the OBSERVABLE behavior only. It does not inspect
    // resolver cache internals, so it does not by itself prove the absence of
    // negative caching — that conclusion comes from reading
    // `fetchAndCacheOAuthToken` / `storeRuntimeScopedToken` and is recorded in
    // project-plans/issue2891/findings.md. What this case does establish is
    // that no "flush the stale empty cache" step is needed for the in-session
    // read to succeed, so the fix for #2891 is the lazy-OAuth gating in
    // providerSwitch.ts. This assertion therefore holds both before and after
    // the fix: it is a lock-in of correct behavior, not a guard on the fix.
    expect(token).toBe(harness.validToken.access_token);
    expect(harness.initiateAuthCalls()).toBe(callsBefore);
  });

  it('serves the persisted token after a simulated process restart', async () => {
    const harness = buildHarness(tempDir);
    await reachEnabledButUnauthenticated(harness);
    await performExplicitLogin(harness);

    // A fresh object graph over the SAME ISecureStore instance — exactly like
    // a real restart re-reading the OS keychain, with no hand-copying.
    const restartDir = join(tempDir, 'restart');
    mkdirSync(restartDir, { recursive: true });
    const restartGraph = buildObjectGraph(restartDir, harness.secureStore);

    // Persisted settings reflect that the user previously enabled OAuth.
    // Set it EXACTLY ONCE; calling toggleOAuthEnabled here would flip the
    // persisted true back to false.
    restartGraph.settings.setOAuthEnabled('claudecode', true);
    expect(restartGraph.oauthManager.isOAuthEnabled('claudecode')).toBe(true);

    // Sanity: the token is genuinely visible through the shared store.
    const persisted = await restartGraph.tokenStore.getToken(
      'claudecode',
      undefined,
    );
    expect(persisted?.access_token).toBe(harness.validToken.access_token);

    // Any browser attempt after a restart would be a defect, so make one loud.
    requireOAuthProvider(restartGraph.oauthManager, 'claudecode').initiateAuth =
      async () => {
        throw new Error('test: should not be needed after restart');
      };

    expect(
      await restartGraph.anthropicProvider.testGetAuthTokenForPrompt(),
    ).toBe(harness.validToken.access_token);
  });
});
