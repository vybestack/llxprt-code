/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-MCPOAUTHTRUTH.P05
 * @requirement:REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002
 *
 * BEHAVIORAL RED suite for the agents-layer MCP projection of the REAL persisted
 * OAuth status (the defect driven out by this plan: `mcpControl.auth`/
 * `authenticate`/`details` currently hardcode `requiresAuth:true` and report
 * `authenticated` from an in-session marker Set instead of the resolved persisted
 * quad-state). This phase writes ONLY the RED test; P06 will project the four new
 * fields (`oauthStatus`, `sessionAuthenticated`, corrected `authenticated`, real
 * `requiresAuth`) additively through the public surface.
 *
 * The control is constructed directly as `new McpControl(deps)` (mirrors the gold
 * seam `mcpOAuth.behavior.test.ts`). Orchestration order is observed via a shared
 * `callLog: string[]` array the injected closures push into — the SAME
 * no-mock-theater idiom. The deps builder returns a fully-typed superset of
 * `McpControlDeps` (compiles today AND once P06 adds the real optional fields),
 * so the control is constructed plainly with no type-defeating cast.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { McpControl } from '../control/mcpControl.js';
import type { McpControlDeps } from '../control/mcpControl.js';
import { getMcpServerOAuthStatus } from '@vybestack/llxprt-code-core';
import type {
  McpOAuthStatus,
  McpClientManager,
} from '@vybestack/llxprt-code-core';
import { mcpServerRequiresOAuth } from '@vybestack/llxprt-code-core';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-core';
import { fakeServerConfig } from './helpers/fakeMcpManager.js';

// ─── ProjectionDeps: superset of McpControlDeps + the two P06 closures ─────
//
// Adds the two NEW optional fields (`getOAuthStatus`, `getRequiresAuth`) that
// P06 will add to McpControlDeps. This is a structural superset, so a
// ProjectionDeps is assignable to McpControlDeps for `new McpControl(deps)`.
// The builder attaches the closures when provided, and OMITS the key entirely
// when the `omit*` flag is set (drives the undefined-safe path).

interface ProjectionDeps extends McpControlDeps {
  getOAuthStatus?: (server: string) => Promise<McpOAuthStatus>;
  getRequiresAuth?: (server: string) => boolean;
}

interface FakeManager {
  restartServer(name: string): Promise<void>;
  restart(): Promise<void>;
}

interface ProjectionDepsOptions {
  readonly manager?: FakeManager;
  readonly servers?: Record<string, ReturnType<typeof fakeServerConfig>>;
  readonly performOAuth?: 'resolve' | 'reject';
  readonly oauthStatusByServer?: Record<string, McpOAuthStatus>;
  readonly requiresAuthByServer?: Record<string, boolean>;
  readonly authenticated?: readonly string[];
  readonly omitOAuthStatus?: boolean;
  readonly omitRequiresAuth?: boolean;
  /**
   * When set, the builder wires `getOAuthStatus` to this closure INSTEAD of the
   * `oauthStatusByServer` map. Used by the PROP-C parity block to delegate to
   * the REAL `getMcpServerOAuthStatus` engine helper.
   */
  readonly getOAuthStatusReal?: (server: string) => Promise<McpOAuthStatus>;
}

function buildProjectionDeps(
  callLog: string[],
  opts: ProjectionDepsOptions = {},
): ProjectionDeps {
  const fakeManager: FakeManager | undefined = opts.manager;
  const managerAsCore = fakeManager as unknown as McpClientManager | undefined;

  const authSet = new Set<string>(opts.authenticated ?? []);

  let oauthStatusClosure: Pick<ProjectionDeps, 'getOAuthStatus'> = {};
  if (opts.omitOAuthStatus !== true) {
    if (opts.getOAuthStatusReal !== undefined) {
      oauthStatusClosure = { getOAuthStatus: opts.getOAuthStatusReal };
    } else {
      oauthStatusClosure = {
        getOAuthStatus: async (s: string): Promise<McpOAuthStatus> =>
          opts.oauthStatusByServer?.[s] ?? 'not-required',
      };
    }
  }

  const requiresAuthClosure =
    opts.omitRequiresAuth === true
      ? {}
      : {
          getRequiresAuth: (s: string): boolean =>
            opts.requiresAuthByServer?.[s] ?? false,
        };

  const deps: ProjectionDeps = {
    isMcpAuthenticated: (server: string) => authSet.has(server),
    markAuthenticated: (server: string) => {
      authSet.add(server);
    },
    getManager: () => managerAsCore,
    getToolRegistry: () => undefined,
    getServerConfigs: () => opts.servers,
    getBlockedServers: () => [],
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
    ...oauthStatusClosure,
    ...requiresAuthClosure,
  };
  return deps;
}

// ─── MockTokenStorage (parity block only) ──────────────────────────────────
//
// `TokenStorage` and `OAuthCredentials` are NOT on the core barrel, so we define
// a minimal structural mock implementing exactly what MCPOAuthTokenStorage
// .setTokenStore requires: the 6 async methods. The credential shape mirrors the
// real engine (`{ serverName, token: { accessToken, tokenType?, expiresAt? },
// updatedAt }`). Used ONLY by the PROP-C parity block; the deterministic
// T20–T27 / PROP-A / PROP-B / PROP-D tests never touch the real store.

interface MockCredential {
  serverName: string;
  token: { accessToken: string; tokenType?: string; expiresAt?: number };
  updatedAt: number;
}

class MockTokenStorage {
  private readonly tokens = new Map<string, MockCredential>();

  async getCredentials(serverName: string): Promise<MockCredential | null> {
    return this.tokens.get(serverName) ?? null;
  }

  async setCredentials(credentials: MockCredential): Promise<void> {
    this.tokens.set(credentials.serverName, {
      ...credentials,
      updatedAt: credentials.updatedAt,
    });
  }

  async deleteCredentials(serverName: string): Promise<void> {
    this.tokens.delete(serverName);
  }

  async listServers(): Promise<string[]> {
    return Array.from(this.tokens.keys());
  }

  async getAllCredentials(): Promise<Map<string, MockCredential>> {
    return new Map(this.tokens);
  }

  async clearAll(): Promise<void> {
    this.tokens.clear();
  }
}

async function seedToken(
  store: MockTokenStorage,
  serverName: string,
  expiresAt: number,
): Promise<void> {
  await store.setCredentials({
    serverName,
    token: {
      accessToken: 'a',
      tokenType: 'Bearer',
      expiresAt,
    },
    updatedAt: Date.now(),
  });
}

describe('agent.mcp projection of real persisted OAuth status @plan:PLAN-20260622-MCPOAUTHTRUTH.P05 @requirement:REQ-002,REQ-003,REQ-004,REQ-INT-001,REQ-INT-002', () => {
  afterEach(() => {
    mcpServerRequiresOAuth.clear();
  });

  it('T20 auth("s") with oauthStatus=authenticated, requiresAuth=true, session=false projects the corrected quad @requirement:REQ-002 @scenario:auth-authenticated', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      oauthStatusByServer: { s: 'authenticated' },
      requiresAuthByServer: { s: true },
      authenticated: [],
    });
    const control = new McpControl(deps);
    const status = await control.auth('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: true,
      requiresAuth: true,
      oauthStatus: 'authenticated',
      sessionAuthenticated: false,
    });
  });

  it('T21 auth("s") with oauthStatus=expired, requiresAuth=true, session=false projects authenticated:false @requirement:REQ-002 @scenario:auth-expired', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      oauthStatusByServer: { s: 'expired' },
      requiresAuthByServer: { s: true },
      authenticated: [],
    });
    const control = new McpControl(deps);
    const status = await control.auth('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: false,
      requiresAuth: true,
      oauthStatus: 'expired',
      sessionAuthenticated: false,
    });
  });

  it('T22 auth("s") with oauthStatus=none, session=true is INDEPENDENT: authenticated:false, sessionAuthenticated:true @requirement:REQ-INT-002 @scenario:auth-none-session-true', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      oauthStatusByServer: { s: 'none' },
      requiresAuthByServer: { s: true },
      authenticated: ['s'],
    });
    const control = new McpControl(deps);
    const status = await control.auth('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: false,
      requiresAuth: true,
      oauthStatus: 'none',
      sessionAuthenticated: true,
    });
  });

  it('T23 auth("s") with oauthStatus=not-required, requiresAuth=false, session=false projects requiresAuth:false @requirement:REQ-003 @scenario:auth-not-required', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      oauthStatusByServer: { s: 'not-required' },
      requiresAuthByServer: { s: false },
      authenticated: [],
    });
    const control = new McpControl(deps);
    const status = await control.auth('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: false,
    });
  });

  it('T24 auth("s") with BOTH closures omitted + session=true is undefined-safe: authenticated:false, requiresAuth:false, oauthStatus:not-required, sessionAuthenticated:true @requirement:REQ-003 @scenario:auth-undefined-safe', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      omitOAuthStatus: true,
      omitRequiresAuth: true,
      authenticated: ['s'],
    });
    const control = new McpControl(deps);
    const status = await control.auth('s');
    expect(status).toStrictEqual({
      server: 's',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: true,
    });
  });

  it('T25 details() over alpha=authenticated/beta=expired projects the 4 fields per server; no Promise leaks into oauthStatus @requirement:REQ-004 @scenario:details-projection', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      oauthStatusByServer: { alpha: 'authenticated', beta: 'expired' },
      requiresAuthByServer: { alpha: true, beta: true },
      authenticated: ['beta'],
      servers: {
        alpha: fakeServerConfig({}),
        beta: fakeServerConfig({}),
      },
    });
    const control = new McpControl(deps);
    const detail = await control.details();
    const alpha = detail.servers.find((s) => s.name === 'alpha');
    const beta = detail.servers.find((s) => s.name === 'beta');
    expect(alpha).toStrictEqual({
      name: 'alpha',
      authenticated: true,
      requiresAuth: true,
      oauthStatus: 'authenticated',
      sessionAuthenticated: false,
      tools: [],
    });
    expect(beta).toStrictEqual({
      name: 'beta',
      authenticated: false,
      requiresAuth: true,
      oauthStatus: 'expired',
      sessionAuthenticated: true,
      tools: [],
    });
    for (const srv of detail.servers) {
      expect(typeof srv.oauthStatus).toBe('string');
    }
  });

  it('T25b details() with BOTH closures omitted is undefined-safe per server: requiresAuth:false, oauthStatus:not-required, authenticated:false, sessionAuthenticated from the marker @requirement:REQ-003,REQ-004 @scenario:details-undefined-safe', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
      omitOAuthStatus: true,
      omitRequiresAuth: true,
      authenticated: ['gamma'],
      servers: {
        gamma: fakeServerConfig({}),
        delta: fakeServerConfig({}),
      },
    });
    const control = new McpControl(deps);
    const detail = await control.details();
    const gamma = detail.servers.find((s) => s.name === 'gamma');
    const delta = detail.servers.find((s) => s.name === 'delta');
    expect(gamma).toStrictEqual({
      name: 'gamma',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: true,
      tools: [],
    });
    expect(delta).toStrictEqual({
      name: 'delta',
      authenticated: false,
      requiresAuth: false,
      oauthStatus: 'not-required',
      sessionAuthenticated: false,
      tools: [],
    });
  });

  it('T26 authenticate("s") happy path re-reads real status post-handshake and preserves orchestration order @requirement:REQ-002 @scenario:authenticate-rereads-real', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
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

  it('T27 authenticate("nope") not in configs with oauthStatus=none projects real status and performs no handshake @requirement:REQ-002 @scenario:authenticate-unknown-real', async () => {
    const callLog: string[] = [];
    const deps = buildProjectionDeps(callLog, {
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

  it('PROP-A for any oauthStatus in the 4 states x session in {true,false}: authenticated===(status==="authenticated"), oauthStatus===status, sessionAuthenticated===session @requirement:REQ-INT-002 @scenario:prop-derive-independent', async () => {
    const statusArb = fc.constantFrom(
      'authenticated',
      'expired',
      'none',
      'not-required',
    );
    const sessionArb = fc.boolean();
    await fc.assert(
      fc.asyncProperty(statusArb, sessionArb, async (oauthStatus, session) => {
        const callLog: string[] = [];
        const deps = buildProjectionDeps(callLog, {
          oauthStatusByServer: { srv: oauthStatus },
          requiresAuthByServer: { srv: true },
          authenticated: session ? ['srv'] : [],
        });
        const control = new McpControl(deps);
        const result = await control.auth('srv');
        expect(result.oauthStatus).toBe(oauthStatus);
        expect(result.sessionAuthenticated).toBe(session);
        expect(result.authenticated).toBe(oauthStatus === 'authenticated');
      }),
    );
  });

  it('PROP-B for any requiresAuth in {true,false}: auth(srv).requiresAuth===r (real pass-through, never hardcoded) @requirement:REQ-003 @scenario:prop-requires', async () => {
    const requiresArb = fc.boolean();
    await fc.assert(
      fc.asyncProperty(requiresArb, async (r) => {
        const callLog: string[] = [];
        const deps = buildProjectionDeps(callLog, {
          oauthStatusByServer: { srv: 'none' },
          requiresAuthByServer: { srv: r },
          authenticated: [],
        });
        const control = new McpControl(deps);
        const result = await control.auth('srv');
        expect(result.requiresAuth).toBe(r);
      }),
    );
  });

  it('PROP-C engine<->agents parity: seeding the REAL token store drives the projection to match getMcpServerOAuthStatus across all 4 states @requirement:REQ-INT-001 @scenario:prop-engine-agents-parity', async () => {
    const store = new MockTokenStorage();
    MCPOAuthTokenStorage.setTokenStore(
      store as unknown as Parameters<
        typeof MCPOAuthTokenStorage.setTokenStore
      >[0],
    );

    const now = Date.now();
    // authenticated: non-expired token (well beyond the 5min buffer).
    await seedToken(store, 'srv-valid', now + 60 * 60 * 1000);
    // expired: token within the expiry buffer.
    await seedToken(store, 'srv-expired', now + 60_000);

    type CaseSpec = {
      label: string;
      server: string;
      opts: { requiresOAuth: boolean };
    };
    const cases: CaseSpec[] = [
      {
        label: 'authenticated',
        server: 'srv-valid',
        opts: { requiresOAuth: true },
      },
      {
        label: 'expired',
        server: 'srv-expired',
        opts: { requiresOAuth: true },
      },
      { label: 'none', server: 'srv-nocreds', opts: { requiresOAuth: true } },
      {
        label: 'not-required',
        server: 'srv-valid',
        opts: { requiresOAuth: false },
      },
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...cases),
        fc.boolean(),
        async (spec, session) => {
          const callLog: string[] = [];
          const deps = buildProjectionDeps(callLog, {
            getOAuthStatusReal: (s: string) =>
              getMcpServerOAuthStatus(s, spec.opts),
            requiresAuthByServer: { [spec.server]: spec.opts.requiresOAuth },
            authenticated: session ? [spec.server] : [],
          });
          const control = new McpControl(deps);
          const result = await control.auth(spec.server);
          const expected = await getMcpServerOAuthStatus(
            spec.server,
            spec.opts,
          );
          expect(result.oauthStatus).toBe(expected);
          expect(result.authenticated).toBe(expected === 'authenticated');
        },
      ),
    );
  });

  it('PROP-D for a generated 1..4-server config map with per-server statuses: details().servers length === key count and every srv.oauthStatus === seeded status for srv.name @requirement:REQ-INT-001 @scenario:prop-details-parity', async () => {
    const nameArb = fc.string({ minLength: 1, maxLength: 10 }).filter((k) => {
      const protoNames = new Set(Object.getOwnPropertyNames(Object.prototype));
      return k.length > 0 && !protoNames.has(k);
    });
    const statusArb = fc.constantFrom(
      'authenticated',
      'expired',
      'none',
      'not-required',
    );
    const configArb = fc
      .uniqueArray(fc.tuple(nameArb, statusArb), {
        minLength: 1,
        maxLength: 4,
        selector: ([name]) => name,
      })
      .map((entries) => {
        const servers: Record<string, ReturnType<typeof fakeServerConfig>> = {};
        const oauthStatusByServer: Record<string, McpOAuthStatus> = {};
        for (const [name, status] of entries) {
          servers[name] = fakeServerConfig({});
          oauthStatusByServer[name] = status;
        }
        return { servers, oauthStatusByServer };
      });
    await fc.assert(
      fc.asyncProperty(configArb, async ({ servers, oauthStatusByServer }) => {
        const callLog: string[] = [];
        const requiresAuthByServer: Record<string, boolean> = {};
        for (const name of Object.keys(servers)) {
          requiresAuthByServer[name] = true;
        }
        const deps = buildProjectionDeps(callLog, {
          oauthStatusByServer,
          requiresAuthByServer,
          servers,
          authenticated: [],
        });
        const control = new McpControl(deps);
        const detail = await control.details();
        const keys = Object.keys(servers);
        expect(detail.servers).toHaveLength(keys.length);
        for (const srv of detail.servers) {
          expect(srv.oauthStatus).toBe(oauthStatusByServer[srv.name]);
          expect(typeof srv.oauthStatus).toBe('string');
        }
      }),
    );
  });
});
