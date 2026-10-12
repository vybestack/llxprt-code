/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import fc from 'fast-check';
import { buildMcpControlDeps } from '../control/mcpControlWiring.js';
import type {
  Config,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  MCPDiscoveryState,
  MCPServerStatus,
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
  async getAllCredentials(): Promise<Map<string, never>> {
    return new Map<string, never>();
  }
  async clearAll(): Promise<void> {}
}

// Minimal fake Config exposing the handful of methods the wiring closures read.
// The `unknown` cast is the established agents test idiom for a narrow Config
// seam (cf. fakeToolControlDeps / fakeHookControlDeps).
interface FakeConfigParts {
  readonly required?: ReadonlyMap<string, boolean>;
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
    readServerSettings: () => ({
      mcpServers: servers ?? {},
      settingsMcpServers: servers ?? {},
      blockedMcpServers: [...(extra.blocked ?? [])],
    }),
    toolSelection: {
      getTool: () => undefined,
      getAllTools: () => [],
      getEnabledTools: () => [],
      getAllToolNames: () => [],
      getFunctionDeclarations: () => [],
      getFunctionDeclarationsFiltered: () => [],
    },
    listPrompts: (server) =>
      (extra.promptsByServer ?? []).map((prompt) => ({
        ...prompt,
        serverName: server,
        invoke: async () => ({ messages: [] }),
      })),
    listResources: () =>
      (extra.resources ?? []).map((resource) => ({
        ...resource,
        name: resource.name ?? resource.uri,
        discoveredAt: 1,
      })),
    readOAuthCredentials: () => new EmptyTokenStorage().getCredentials(),
    performOAuth: async () => {
      throw new Error('OAuth not configured for status test');
    },
    getMcpRuntimeStatus: () => ({
      servers: servers ?? {},
      discoveryFailures: new Map(),
      discoveryState: MCPDiscoveryState.COMPLETED,
      serverStates: new Map(
        [...(extra.required ?? [])].map(([name, requiresOAuth]) => [
          name,
          { status: MCPServerStatus.DISCONNECTED, requiresOAuth },
        ]),
      ),
    }),
    refreshMcpServers: async () => {},
    reloadMcpServers: async () => {},
    isMcpAuthenticated: () => false,
    markAuthenticated: () => {},
    resolveClient: () => ({}) as unknown as AgentClientContract,
  });
}

describe('buildMcpControlDeps requires-OAuth consistency @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004,REQ-INT-002', () => {
  it('isolates same-name same-URL owners with explicit auth observations and storage', async () => {
    const servers: Record<string, MCPServerConfig> = {
      same: { url: 'http://same.invalid/mcp', type: 'http' },
    };
    const a = buildDeps(servers, { required: new Map([['same', true]]) });
    const b = buildDeps(servers, { required: new Map([['same', false]]) });
    expect(await a.getOAuthStatus?.('same')).toBe('none');
    expect(b.getRequiresAuth?.('same')).toBe(false);
    expect(await b.getOAuthStatus?.('same')).toBe('not-required');
    expect(a.getRequiresAuth?.('same')).toBe(true);
  });

  // E1: an oauth-enabled config server requires auth and must not report
  // 'not-required' (empty store → 'none').
  it('reports requiresAuth:true and a non-not-required status for an oauth-enabled config server', async () => {
    const deps = buildDeps({ db: serverWithOAuth(true) });

    expect(deps.getRequiresAuth?.('db')).toBe(true);
    expect(await deps.getOAuthStatus?.('db')).not.toBe('not-required');
  });

  // E2: a server that neither has oauth.enabled nor is in the owner state does
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

  // PROP-1: the consistency invariant across arbitrary config + owner-state
  // states — getRequiresAuth(s) === true implies getOAuthStatus(s) is never
  // 'not-required', and === false implies exactly 'not-required'. This fails on
  // the pre-fix divergent closures (config absent + map holding `s -> false`
  // yields requiresAuth:true but oauthStatus:'not-required').
  it('keeps getRequiresAuth and getOAuthStatus consistent for any config/owner state (property)', async () => {
    const {
      keepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStatePropertyProperty,
      observations,
    } =
      await observeKeepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStateProperty();
    await fc.assert(
      keepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStatePropertyProperty,
    );
    expect(
      observations.map(({ status }) => status !== 'not-required'),
    ).toStrictEqual(observations.map(({ requires }) => requires === true));
  });

  const observeKeepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStateProperty =
    async () => {
      const observations: Array<{
        requires: boolean | undefined;
        status: string | undefined;
      }> = [];
      const keepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStatePropertyProperty =
        fc.asyncProperty(
          fc.string({ minLength: 1 }),
          // oauth.enabled: true | false | (no config entry)
          fc.option(fc.boolean(), { nil: undefined }),
          // owner state: true | false | (key absent)
          fc.option(fc.boolean(), { nil: undefined }),
          async (server, configEnabled, mapValue) => {
            const servers =
              configEnabled === undefined
                ? undefined
                : { [server]: serverWithOAuth(configEnabled) };
            const deps = buildDeps(servers, {
              required: new Map(
                mapValue === undefined ? [] : [[server, mapValue]],
              ),
            });

            const requires = deps.getRequiresAuth?.(server);
            const status = await deps.getOAuthStatus?.(server);
            observations.push({ requires, status });

            // Biconditional invariant: auth is required iff the status is not
            // 'not-required'.
            return (status !== 'not-required') === (requires === true);
          },
        );
      return {
        keepsGetRequiresAuthAndGetOAuthStatusConsistentForAnyConfigMapStatePropertyProperty,
        observations,
      };
    };

  it('respects an explicit false owner requirement for any name (property)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (server) => {
        const deps = buildDeps(undefined, {
          required: new Map([[server, false]]),
        });

        expect(deps.getRequiresAuth?.(server)).toBe(false);
        const status = await deps.getOAuthStatus?.(server);
        expect(status).toBe('not-required');
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

    expect(
      deps
        .listPrompts?.('srv')
        .map(({ name, description }) => ({ name, description })),
    ).toStrictEqual(prompts);
  });

  // getResourceRegistry forwards all resources from Config.
  it('forwards all resources from the resource registry', () => {
    const resources = [{ serverName: 'srv', name: 'r1', uri: 'mcp://r1' }];
    const deps = buildDeps(undefined, { resources });

    expect(
      deps
        .listResources?.()
        .map(({ serverName, name, uri }) => ({ serverName, name, uri })),
    ).toStrictEqual(resources);
  });
});
