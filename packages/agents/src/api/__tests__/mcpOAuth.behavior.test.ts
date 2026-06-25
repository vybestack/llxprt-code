/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P13
 * @requirement:REQ-006
 *
 * BEHAVIORAL RED suite for the EXTENDED AgentMcpControl surface: real OAuth
 * `authenticate(server)`, `refresh(server?)` setTools parity, and deep
 * `details(opts?)`. The control is constructed directly as `new McpControl(deps)`
 * (mirrors mcp-discovery.spec.ts / helpers/fakeMcpManager.ts). The orchestration
 * order is observed via a shared `callLog: string[]` array that the injected
 * dependency closures push into — this is the SAME no-mock-theater idiom
 * helpers/fakeMcpManager.ts already uses (restartedServers()). There are NO
 * spy/stub/call assertions.
 *
 * Behavior under test (GREEN): authenticate orchestrates performOAuth →
 * restartServer → refreshClientTools; refresh gains refreshClientTools parity
 * on BOTH the named-server and restart-all paths; details projects
 * prompts/resources to named-field-only public types. The deps builder returns
 * a fully-typed `McpControlDeps`, so the control is constructed plainly as
 * `new McpControl(deps)` with no type-defeating cast at the call site.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { McpControl } from '../control/mcpControl.js';
import type {
  McpControlDeps,
  McpToolRegistryView,
  McpPromptRegistryView,
  McpResourceRegistryView,
} from '../control/mcpControl.js';
import type {
  McpClientManager,
  McpOAuthStatus,
} from '@vybestack/llxprt-code-core';
import { fakeServerConfig } from './helpers/fakeMcpManager.js';

// ─── Observable-ordering deps builder (the no-mock-theater seam) ────────────
//
// Builds an McpControlDeps-shaped object closing over a shared callLog. Every
// capability is a real closure that records into callLog; assertions are on the
// ORDER/CONTENT of callLog and on returned status fields — NEVER spy calls.

interface FakeManager {
  restartServer(name: string): Promise<void>;
  restart(): Promise<void>;
}

function buildOrderingDeps(
  callLog: string[],
  opts: {
    readonly manager?: FakeManager;
    readonly servers?: Record<string, ReturnType<typeof fakeServerConfig>>;
    readonly performOAuth?: 'resolve' | 'reject';
    readonly blocked?: ReadonlyArray<{ name: string; extensionName: string }>;
    readonly prompts?: Record<
      string,
      ReadonlyArray<{ name: string; description?: string }>
    >;
    readonly resources?: ReadonlyArray<{
      serverName: string;
      name?: string;
      uri: string;
    }>;
    readonly tools?: Record<
      string,
      ReadonlyArray<{
        name: string;
        description?: string;
        serverName?: string;
        enabled?: boolean;
      }>
    >;
    readonly authenticated?: readonly string[];
    readonly omitMarkAuthenticated?: boolean;
    /**
     * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004
     * Per-server resolved OAuth quad-state. Defaults to 'not-required'
     * (undefined-safe, matching the production wiring's absent-closure path).
     */
    readonly oauthStatusByServer?: Record<string, McpOAuthStatus>;
    /**
     * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003
     * Per-server real requiresAuth. Defaults to false (undefined-safe).
     */
    readonly requiresAuthByServer?: Record<string, boolean>;
  } = {},
): McpControlDeps {
  const fakeManager: FakeManager | undefined = opts.manager;
  const managerAsCore = fakeManager as unknown as McpClientManager | undefined;

  // Real per-agent auth marker: the SAME set is read by isMcpAuthenticated and
  // written by markAuthenticated, mirroring agentImpl's authState.mcpAuth wiring.
  // No spies/mocks — reconciliation is observed through real Set membership.
  const authSet = new Set<string>(opts.authenticated ?? []);

  const { tools, prompts, resources } = opts;
  const toolRegistry: McpToolRegistryView | undefined =
    tools === undefined
      ? undefined
      : {
          getAllTools: () =>
            Object.values(tools)
              .flat()
              .map((t) => ({
                name: t.name,
                ...(t.description !== undefined
                  ? { description: t.description }
                  : {}),
                ...(t.serverName !== undefined
                  ? { serverName: t.serverName }
                  : {}),
              })),
          getEnabledTools: () =>
            Object.values(tools)
              .flat()
              .filter((t) => t.enabled !== false)
              .map((t) => ({ name: t.name })),
        };
  const promptRegistry: McpPromptRegistryView | undefined =
    prompts === undefined
      ? undefined
      : {
          getPromptsByServer: (server: string) => prompts[server] ?? [],
        };
  const resourceRegistry: McpResourceRegistryView | undefined =
    resources === undefined
      ? undefined
      : {
          getAllResources: () => resources,
        };

  return {
    isMcpAuthenticated: (server: string) => authSet.has(server),
    ...(opts.omitMarkAuthenticated === true
      ? {}
      : {
          markAuthenticated: (server: string) => {
            authSet.add(server);
          },
        }),
    getManager: () => managerAsCore,
    getToolRegistry: () => toolRegistry,
    getServerConfigs: () => opts.servers,
    getBlockedServers: () => opts.blocked ?? [],
    getPromptRegistry: () => promptRegistry,
    getResourceRegistry: () => resourceRegistry,
    refreshClientTools: async () => {
      callLog.push('setTools');
    },
    performOAuth:
      opts.performOAuth === 'reject'
        ? async (server: string) => {
            callLog.push('oauth:' + server);
            throw new Error('oauth boom');
          }
        : async (server: string) => {
            callLog.push('oauth:' + server);
          },
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 real persisted quad-state projection
    getOAuthStatus: async (s: string): Promise<McpOAuthStatus> =>
      opts.oauthStatusByServer?.[s] ?? 'not-required',
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003 real per-server requiresAuth
    getRequiresAuth: (s: string): boolean =>
      opts.requiresAuthByServer?.[s] ?? false,
  };
}

describe('agent.mcp OAuth + refresh parity + details @plan:PLAN-20260622-COREAPIGAP.P13 @requirement:REQ-006', () => {
  it('T14 authenticate("s") orchestrates performOAuth -> restartServer -> refreshClientTools and returns authenticated:true @requirement:REQ-006 @scenario:authenticate-success', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      oauthStatusByServer: { s: 'authenticated' },
      requiresAuthByServer: { s: true },
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);
    const status = await control.authenticate('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: true,
      requiresAuth: true,
      oauthStatus: 'authenticated',
      sessionAuthenticated: true,
    });
    expect(callLog).toStrictEqual(['oauth:s', 'restart:s', 'setTools']);
  });

  it('T14b authenticate("nope") (not in configs) returns authenticated:false and performs NO oauth/restart/setTools @requirement:REQ-006 @scenario:authenticate-unknown', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      oauthStatusByServer: { nope: 'none' },
      requiresAuthByServer: { nope: true },
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);
    const status = await control.authenticate('nope');
    expect(status).toStrictEqual({
      server: 'nope',
      authenticated: false,
      requiresAuth: true,
      oauthStatus: 'none',
      sessionAuthenticated: false,
    });
    expect(callLog).toStrictEqual([]);
  });

  it('T14c performOAuth rejects -> authenticate("s") rejects; restart and setTools are NEVER invoked @requirement:REQ-006 @scenario:authenticate-propagation', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      performOAuth: 'reject',
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);
    await expect(control.authenticate('s')).rejects.toThrow('oauth boom');
    expect(callLog).toContain('oauth:s');
    expect(callLog).not.toContain('restart:s');
    expect(callLog).not.toContain('setTools');
  });

  it('T14d authenticate("s") reconciles the auth marker: a prior auth("s") reads sessionAuthenticated:false, then after authenticate the SAME auth("s") and details() read sessionAuthenticated:true @requirement:REQ-006 @scenario:authenticate-reconciles', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      oauthStatusByServer: { s: 'authenticated' },
      requiresAuthByServer: { s: true },
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);

    // BEFORE: the per-agent marker is empty, so the in-session signal is false.
    // authenticated stays true (real persisted oauthStatus is 'authenticated').
    const before = await control.auth('s');
    expect(before.authenticated).toBe(true);
    expect(before.sessionAuthenticated).toBe(false);

    // The real OAuth flow succeeds.
    const status = await control.authenticate('s');
    expect(status.sessionAuthenticated).toBe(true);

    // AFTER: auth() and details() now agree with authenticate()'s result —
    // the in-session marker is reconciled. authenticated is derived from the
    // real oauthStatus (not the marker) so it stays true throughout.
    const after = await control.auth('s');
    expect(after.sessionAuthenticated).toBe(true);
    const detail = await control.details();
    const sDetail = detail.servers.find((d) => d.name === 's');
    expect(sDetail?.sessionAuthenticated).toBe(true);
  });

  it('T14e authenticate("s") is undefined-safe when markAuthenticated is absent: still resolves the real status and does NOT throw @requirement:REQ-006 @scenario:authenticate-mark-undefined-safe', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      oauthStatusByServer: { s: 'authenticated' },
      requiresAuthByServer: { s: true },
      omitMarkAuthenticated: true,
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);
    const status = await control.authenticate('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: true,
      requiresAuth: true,
      oauthStatus: 'authenticated',
      sessionAuthenticated: false,
    });
    // No marker writer wired -> sessionAuthenticated stays false. authenticated
    // is derived from the real oauthStatus (not the marker) so it stays true.
    const after = await control.auth('s');
    expect(after.authenticated).toBe(true);
    expect(after.sessionAuthenticated).toBe(false);
  });

  it('T14f authenticate("nope") (unknown server, no oauth) does NOT mark it authenticated: a later auth("nope") stays sessionAuthenticated:false @requirement:REQ-006 @scenario:authenticate-unknown-no-mark', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        s: fakeServerConfig({ oauth: { enabled: true }, httpUrl: 'https://x' }),
      },
    });
    const control = new McpControl(deps);
    const status = await control.authenticate('nope');
    expect(status.authenticated).toBe(false);
    expect(status.sessionAuthenticated).toBe(false);
    const after = await control.auth('nope');
    expect(after.authenticated).toBe(false);
    expect(after.sessionAuthenticated).toBe(false);
  });

  it('PROP for any server name present in configs, authenticate(name) makes the SAME name read sessionAuthenticated:true via auth() afterwards (reconciliation) @requirement:REQ-006 @scenario:prop-authenticate-reconciles', async () => {
    const nameArb = fc.constantFrom('srv-a', 'srv-b', 'srv-c', 'srv-d');
    const oauthStatusByServer: Record<string, McpOAuthStatus> = {
      'srv-a': 'authenticated',
      'srv-b': 'authenticated',
      'srv-c': 'authenticated',
      'srv-d': 'authenticated',
    };
    await fc.assert(
      fc.asyncProperty(nameArb, async (name) => {
        const callLog: string[] = [];
        const servers: Record<string, ReturnType<typeof fakeServerConfig>> = {
          'srv-a': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://a',
          }),
          'srv-b': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://b',
          }),
          'srv-c': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://c',
          }),
          'srv-d': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://d',
          }),
        };
        const deps = buildOrderingDeps(callLog, {
          oauthStatusByServer,
          requiresAuthByServer: {
            'srv-a': true,
            'srv-b': true,
            'srv-c': true,
            'srv-d': true,
          },
          manager: {
            restartServer: async (n: string) => {
              callLog.push('restart:' + n);
            },
            restart: async () => {
              callLog.push('restart-all');
            },
          },
          servers,
        });
        const control = new McpControl(deps);

        // BEFORE: marker empty → sessionAuthenticated false. authenticated is
        // derived from the real oauthStatus (true), INDEPENDENT of the marker.
        const before = await control.auth(name);
        expect(before.sessionAuthenticated).toBe(false);

        await control.authenticate(name);

        // AFTER: the in-session marker is reconciled → sessionAuthenticated true.
        const after = await control.auth(name);
        expect(after.sessionAuthenticated).toBe(true);
      }),
    );
  });

  it('T15 refresh("s") records restart:s -> setTools; refresh() records restart-all -> setTools @requirement:REQ-006 @scenario:refresh-parity', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      manager: {
        restartServer: async (n: string) => {
          callLog.push('restart:' + n);
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
    });
    const control = new McpControl(deps);
    await control.refresh('s');
    expect(callLog).toStrictEqual(['restart:s', 'setTools']);
    callLog.length = 0;
    await control.refresh();
    expect(callLog).toStrictEqual(['restart-all', 'setTools']);
  });

  it('T16 getManager() === undefined -> refresh() resolves and callLog is empty (setTools NOT called) @requirement:REQ-006 @scenario:refresh-undefined-safe', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, { manager: undefined });
    const control = new McpControl(deps);
    await control.refresh();
    expect(callLog).toStrictEqual([]);
  });

  it('PROP refresh parity: for any generated server name, refresh(name) records [restart:name, setTools] @requirement:REQ-006 @scenario:prop-refresh-parity', async () => {
    const nameArb = fc.string({ minLength: 1, maxLength: 20 }).filter((n) => {
      const protoNames = new Set(Object.getOwnPropertyNames(Object.prototype));
      return !protoNames.has(n);
    });
    await fc.assert(
      fc.asyncProperty(nameArb, async (name) => {
        const callLog: string[] = [];
        const deps = buildOrderingDeps(callLog, {
          manager: {
            restartServer: async (n: string) => {
              callLog.push('restart:' + n);
            },
            restart: async () => {
              callLog.push('restart-all');
            },
          },
        });
        const control = new McpControl(deps);
        await control.refresh(name);
        expect(callLog).toStrictEqual(['restart:' + name, 'setTools']);
      }),
    );
  });

  it('Td1 details() with 2 servers yields servers length 2 each with tools defined, prompts/resources undefined, and blockedServers mirroring getBlockedServers @requirement:REQ-006 @scenario:details-projection', async () => {
    const callLog: string[] = [];
    const blocked = [{ name: 'evil', extensionName: 'bad-ext' }];
    const deps = buildOrderingDeps(callLog, {
      oauthStatusByServer: { alpha: 'authenticated', beta: 'none' },
      requiresAuthByServer: { alpha: true, beta: true },
      manager: {
        restartServer: async () => {
          callLog.push('restart');
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        alpha: fakeServerConfig({}),
        beta: fakeServerConfig({}),
      },
      tools: {
        alpha: [{ name: 'a_tool', serverName: 'alpha', enabled: true }],
        beta: [{ name: 'b_tool', serverName: 'beta', enabled: true }],
      },
      blocked,
      authenticated: ['alpha'],
    });
    const control = new McpControl(deps);
    const detail = await control.details();
    expect(detail.servers).toHaveLength(2);
    for (const srv of detail.servers) {
      expect(srv.tools).toBeDefined();
      expect(srv.prompts).toBeUndefined();
      expect(srv.resources).toBeUndefined();
    }
    expect(detail.blockedServers).toStrictEqual(blocked);
    const alpha = detail.servers.find((s) => s.name === 'alpha');
    expect(alpha?.authenticated).toBe(true);
    expect(alpha?.sessionAuthenticated).toBe(true);
    const beta = detail.servers.find((s) => s.name === 'beta');
    expect(beta?.authenticated).toBe(false);
    expect(beta?.sessionAuthenticated).toBe(false);
  });

  it('Td2 details({includePrompts:true}) projects named-field prompts; details({includeResources:true}) filters resources by serverName @requirement:REQ-006 @scenario:details-prompts-resources', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      manager: {
        restartServer: async () => {
          callLog.push('restart');
        },
        restart: async () => {
          callLog.push('restart-all');
        },
      },
      servers: {
        alpha: fakeServerConfig({}),
      },
      prompts: {
        alpha: [{ name: 'p1', description: 'desc1' }, { name: 'p2' }],
      },
      resources: [
        { serverName: 'alpha', name: 'r1', uri: 'file:///r1' },
        { serverName: 'beta', name: 'r2', uri: 'file:///r2' },
      ],
    });
    const control = new McpControl(deps);
    const withPrompts = await control.details({ includePrompts: true });
    const alphaP = withPrompts.servers[0];
    // p1 carries a description; p2 has none — the projection must OMIT the
    // `description` key entirely when undefined (conditional spread), not emit
    // `description: undefined`.
    expect(alphaP.prompts).toStrictEqual([
      { name: 'p1', description: 'desc1' },
      { name: 'p2' },
    ]);
    expect(alphaP.resources).toBeUndefined();

    const withResources = await control.details({ includeResources: true });
    const alphaR = withResources.servers[0];
    expect(alphaR.resources).toStrictEqual([{ name: 'r1', uri: 'file:///r1' }]);
    expect(alphaR.prompts).toBeUndefined();
  });

  it('Td3 getServerConfigs() === undefined -> details().servers is [] @requirement:REQ-006 @scenario:details-undefined-safe', async () => {
    const callLog: string[] = [];
    const deps = buildOrderingDeps(callLog, {
      manager: undefined,
      servers: undefined,
    });
    const control = new McpControl(deps);
    const detail = await control.details();
    expect(detail.servers).toStrictEqual([]);
  });

  it('PROP for generated names NOT in a fixed config set, authenticate(name) returns authenticated:false and callLog stays [] (performOAuth never runs) @requirement:REQ-006 @scenario:prop-unknown', async () => {
    const fixedConfig = {
      known: fakeServerConfig({
        oauth: { enabled: true },
        httpUrl: 'https://x',
      }),
    };
    const protoNames = new Set(Object.getOwnPropertyNames(Object.prototype));
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1 })
          .filter((n) => n !== 'known' && !protoNames.has(n)),
        async (name) => {
          const callLog: string[] = [];
          const deps = buildOrderingDeps(callLog, {
            manager: {
              restartServer: async (n: string) => {
                callLog.push('restart:' + n);
              },
              restart: async () => {
                callLog.push('restart-all');
              },
            },
            servers: fixedConfig,
          });
          const control = new McpControl(deps);
          const status = await control.authenticate(name);
          expect(status.authenticated).toBe(false);
          expect(callLog).toStrictEqual([]);
        },
      ),
    );
  });

  it('PROP for generated server names present in configs, authenticate(name) records [oauth:name, restart:name, setTools] and returns authenticated:true @requirement:REQ-006 @scenario:prop-known', async () => {
    const nameArb = fc.constantFrom('srv-a', 'srv-b', 'srv-c', 'srv-d');
    const oauthStatusByServer: Record<string, McpOAuthStatus> = {
      'srv-a': 'authenticated',
      'srv-b': 'authenticated',
      'srv-c': 'authenticated',
      'srv-d': 'authenticated',
    };
    await fc.assert(
      fc.asyncProperty(nameArb, async (name) => {
        const callLog: string[] = [];
        const servers: Record<string, ReturnType<typeof fakeServerConfig>> = {
          'srv-a': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://a',
          }),
          'srv-b': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://b',
          }),
          'srv-c': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://c',
          }),
          'srv-d': fakeServerConfig({
            oauth: { enabled: true },
            httpUrl: 'https://d',
          }),
        };
        const deps = buildOrderingDeps(callLog, {
          oauthStatusByServer,
          requiresAuthByServer: {
            'srv-a': true,
            'srv-b': true,
            'srv-c': true,
            'srv-d': true,
          },
          manager: {
            restartServer: async (n: string) => {
              callLog.push('restart:' + n);
            },
            restart: async () => {
              callLog.push('restart-all');
            },
          },
          servers,
        });
        const control = new McpControl(deps);
        const status = await control.authenticate(name);
        expect(status.authenticated).toBe(true);
        expect(callLog).toStrictEqual([
          'oauth:' + name,
          'restart:' + name,
          'setTools',
        ]);
      }),
    );
  });

  it('PROP for a generated config map (1..4 servers), details().servers length equals the number of config keys and every server.name is a config key @requirement:REQ-006 @scenario:prop-details', async () => {
    const configArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }).filter((k) => k.length > 0),
      fc.constant(fakeServerConfig({})),
      { minKeys: 1, maxKeys: 4 },
    );
    await fc.assert(
      fc.asyncProperty(configArb, async (servers) => {
        const callLog: string[] = [];
        const deps = buildOrderingDeps(callLog, {
          manager: {
            restartServer: async () => {
              callLog.push('restart');
            },
            restart: async () => {
              callLog.push('restart-all');
            },
          },
          servers,
        });
        const control = new McpControl(deps);
        const detail = await control.details();
        const keys = Object.keys(servers);
        expect(detail.servers).toHaveLength(keys.length);
        for (const srv of detail.servers) {
          expect(keys).toContain(srv.name);
        }
      }),
    );
  });
});
