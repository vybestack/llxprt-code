/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06
 * @requirement:REQ-003,REQ-004,REQ-INT-002
 *
 * Locks the wiring invariant that buildMcpControlDeps' getRequiresAuth and
 * getOAuthStatus closures derive requiredness from ONE shared predicate, so a
 * server that requires OAuth can never simultaneously report oauthStatus
 * 'not-required'. Before the shared-predicate refactor the two closures
 * diverged (getRequiresAuth used `mcpServerRequiresOAuth.has(server)` while the
 * getOAuthStatus hint passed only `oauth.enabled === true`, relying on the
 * engine helper's internal `mcpServerRequiresOAuth.get(server) === true`
 * re-check). That asymmetry allowed the impossible
 * (requiresAuth:true, oauthStatus:'not-required') combination when the runtime
 * map held `server -> false`. This behavioral test drives that exact divergence
 * out and would fail if the closures are ever wired from two predicates again.
 *
 * The test is hermetic: it swaps an empty token store into MCPOAuthTokenStorage
 * (so the real getMcpServerOAuthStatus resolves a required-but-uncredentialed
 * server to 'none' rather than reaching the OS keychain) and restores the prior
 * store in teardown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { buildMcpControlDeps } from '../control/mcpControlWiring.js';
import type {
  Config,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  mcpServerRequiresOAuth,
  MCPOAuthTokenStorage,
} from '@vybestack/llxprt-code-core';

// ─── Empty token store ─────────────────────────────────────────────────────
//
// Minimal structural store with the methods MCPOAuthTokenStorage.setTokenStore
// requires. It holds nothing, so the real engine helper resolves any
// required-but-uncredentialed server to 'none' (never the keychain).
class EmptyTokenStorage {
  async getCredentials(): Promise<null> {
    return null;
  }
  async setCredentials(): Promise<void> {}
  async deleteCredentials(): Promise<void> {}
  async listServers(): Promise<string[]> {
    return [];
  }
  async getAllCredentials(): Promise<Map<string, unknown>> {
    return new Map();
  }
  async clearAll(): Promise<void> {}
}

// Minimal fake Config exposing the handful of methods the wiring closures read.
// The `unknown` cast is the established agents test idiom for a narrow Config
// seam (cf. fakeToolControlDeps / fakeHookControlDeps).
interface FakeConfigParts {
  readonly blocked?: ReadonlyArray<{ name: string; extensionName: string }>;
  readonly promptsByServer?: ReadonlyArray<{
    name: string;
    description?: string;
  }>;
  readonly resources?: ReadonlyArray<{
    serverName: string;
    name?: string;
    uri: string;
  }>;
}

function fakeConfig(
  servers: Record<string, MCPServerConfig> | undefined,
  extra: FakeConfigParts = {},
): Config {
  return {
    getMcpServers: () => servers,
    getBlockedMcpServers: () => extra.blocked,
    getPromptRegistry: () => ({
      getPromptsByServer: (_s: string) => extra.promptsByServer ?? [],
    }),
    getResourceRegistry: () => ({
      getAllResources: () => extra.resources ?? [],
    }),
  } as unknown as Config;
}

function serverWithOAuth(enabled: boolean): MCPServerConfig {
  return { oauth: { enabled } } as unknown as MCPServerConfig;
}

// A configured server entry that has NO oauth block at all (distinct from
// oauth:{enabled:false}); exercises the `?.oauth?.enabled` optional chain.
function serverWithoutOAuth(): MCPServerConfig {
  return {} as unknown as MCPServerConfig;
}

function buildDeps(
  servers: Record<string, MCPServerConfig> | undefined,
  extra: FakeConfigParts = {},
) {
  return buildMcpControlDeps({
    config: fakeConfig(servers, extra),
    isMcpAuthenticated: () => false,
    markAuthenticated: () => {},
    resolveClient: () => ({}) as unknown as AgentClientContract,
  });
}

describe('buildMcpControlDeps requires-OAuth consistency @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004,REQ-INT-002', () => {
  let savedStore: ReturnType<typeof MCPOAuthTokenStorage.getTokenStore>;

  beforeEach(() => {
    savedStore = MCPOAuthTokenStorage.getTokenStore();
    MCPOAuthTokenStorage.setTokenStore(
      new EmptyTokenStorage() as unknown as Parameters<
        typeof MCPOAuthTokenStorage.setTokenStore
      >[0],
    );
  });

  afterEach(() => {
    MCPOAuthTokenStorage.setTokenStore(savedStore);
    mcpServerRequiresOAuth.clear();
  });

  // E1: an oauth-enabled config server requires auth and must not report
  // 'not-required' (empty store → 'none').
  it('reports requiresAuth:true and a non-not-required status for an oauth-enabled config server', async () => {
    const deps = buildDeps({ db: serverWithOAuth(true) });

    expect(deps.getRequiresAuth?.('db')).toBe(true);
    expect(await deps.getOAuthStatus?.('db')).not.toBe('not-required');
  });

  // E2: a server that neither has oauth.enabled nor is in the runtime map does
  // not require auth and resolves to 'not-required'.
  it('reports requiresAuth:false and oauthStatus:not-required for an unconfigured server', async () => {
    const deps = buildDeps({ db: serverWithOAuth(false) });

    expect(deps.getRequiresAuth?.('other')).toBe(false);
    expect(await deps.getOAuthStatus?.('other')).toBe('not-required');
  });

  // E3: a configured server that exists but carries NO oauth block at all must
  // not require auth — locks the `?.oauth?.enabled` optional chain (a mutant
  // that drops the `?.` before `.enabled` would throw on the missing oauth and
  // is killed here because the predicate must stay total and return false).
  it('reports requiresAuth:false for a configured server that has no oauth block', async () => {
    const deps = buildDeps({ db: serverWithoutOAuth() });

    expect(deps.getRequiresAuth?.('db')).toBe(false);
    expect(await deps.getOAuthStatus?.('db')).toBe('not-required');
  });

  // PROP-1: the consistency invariant across arbitrary config + runtime-map
  // states — getRequiresAuth(s) === true implies getOAuthStatus(s) is never
  // 'not-required', and === false implies exactly 'not-required'. This fails on
  // the pre-fix divergent closures (config absent + map holding `s -> false`
  // yields requiresAuth:true but oauthStatus:'not-required').
  it('keeps getRequiresAuth and getOAuthStatus consistent for any config/map state (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1 }),
        // oauth.enabled: true | false | (no config entry)
        fc.option(fc.boolean(), { nil: undefined }),
        // runtime map: true | false | (key absent)
        fc.option(fc.boolean(), { nil: undefined }),
        async (server, configEnabled, mapValue) => {
          mcpServerRequiresOAuth.clear();
          if (mapValue !== undefined) {
            mcpServerRequiresOAuth.set(server, mapValue);
          }
          const servers =
            configEnabled === undefined
              ? undefined
              : { [server]: serverWithOAuth(configEnabled) };
          const deps = buildDeps(servers);

          const requires = deps.getRequiresAuth?.(server);
          const status = await deps.getOAuthStatus?.(server);

          // Biconditional invariant: auth is required iff the status is not
          // 'not-required'. A single unconditional assertion captures both
          // directions (true => never 'not-required'; false => exactly it).
          expect(status !== 'not-required').toBe(requires === true);
        },
      ),
    );
  });

  // PROP-2: the exact pre-fix adversarial subspace — for ANY server name, a
  // runtime map entry of `name -> false` with no oauth config still requires
  // auth (via .has) AND resolves through the shared predicate to 'none', never
  // 'not-required'. Directly locks the .has()/.get()===true asymmetry closed.
  it('treats a map entry of false as still-required and never not-required for any name (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (server) => {
        mcpServerRequiresOAuth.clear();
        mcpServerRequiresOAuth.set(server, false);
        const deps = buildDeps(undefined);

        expect(deps.getRequiresAuth?.(server)).toBe(true);
        const status = await deps.getOAuthStatus?.(server);
        expect(status).not.toBe('not-required');
        expect(status).toBe('none');
      }),
    );
  });
});

// Locks the Config-backed discovery passthrough closures the wiring assembles.
// These assert OBSERVABLE forwarded output (the value the closure returns for a
// given Config input) — never call-spying — so a mutant that empties a closure
// body, drops the `?? []` undefined guard, or swaps the forwarded value is
// observed through the returned data.
describe('buildMcpControlDeps discovery passthrough closures @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006', () => {
  // getBlockedServers forwards Config.getBlockedMcpServers() verbatim.
  it('forwards the configured blocked servers list', () => {
    const blocked = [{ name: 'srv', extensionName: 'ext' }];
    const deps = buildDeps(undefined, { blocked });

    expect(deps.getBlockedServers?.()).toStrictEqual(blocked);
  });

  // getBlockedServers must be undefined-safe: when Config returns undefined the
  // `?? []` guard yields an empty array (locks the LogicalOperator survivor that
  // swaps `??` for `&&`, which would forward undefined instead).
  it('returns an empty array when Config has no blocked servers', () => {
    const deps = buildDeps(undefined, { blocked: undefined });

    expect(deps.getBlockedServers?.()).toStrictEqual([]);
  });

  // getPromptRegistry forwards the per-server prompt view from Config.
  it('forwards prompts grouped by server from the prompt registry', () => {
    const prompts = [{ name: 'p1', description: 'd1' }];
    const deps = buildDeps(undefined, { promptsByServer: prompts });

    const view = deps.getPromptRegistry?.();
    expect(view?.getPromptsByServer('srv')).toStrictEqual(prompts);
  });

  // getResourceRegistry forwards all resources from Config.
  it('forwards all resources from the resource registry', () => {
    const resources = [{ serverName: 'srv', name: 'r1', uri: 'mcp://r1' }];
    const deps = buildDeps(undefined, { resources });

    const view = deps.getResourceRegistry?.();
    expect(view?.getAllResources()).toStrictEqual(resources);
  });
});
