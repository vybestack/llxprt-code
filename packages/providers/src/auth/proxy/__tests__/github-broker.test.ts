/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for the GitHub broker (P08).
 *
 * These tests use REAL Unix domain sockets and the REAL gh binary. node:net
 * and the credential proxy server are never mocked. Only the infrastructure
 * boundary (TokenStore / ProviderKeyStorage) uses in-memory test doubles,
 * which is permitted by the mock-hygiene rules.
 *
 * The primary path (issue.view) is exercised against real public data in
 * vybestack/llxprt-code to prove argv construction and shaping actually work.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-001, REQ-002, REQ-003, REQ-004
 * @pseudocode 003-github-broker.md lines T1-T14
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  CredentialProxyServer,
  type CredentialProxyServerOptions,
} from '../credential-proxy-server.js';
import type {
  TokenStore,
  OAuthToken,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import { ProxySocketClient } from '@vybestack/llxprt-code-core';
import type { ProxyResponse } from '@vybestack/llxprt-code-auth';
import { encodeFrame, FrameDecoder } from '@vybestack/llxprt-code-auth';
import {
  createGitHubBrokerHandler,
  type GitHubBrokerHandler,
} from '../github-broker.js';
import {
  redactTokenShaped,
  mapGraphQLErrorType,
  classifyStderr,
  augmentSearchError,
} from '../github-broker-errors.js';
import {
  searchIssuesDescriptor,
  searchPrsDescriptor,
} from '../github-broker-search-ops.js';
import {
  issueListDescriptor,
  issueViewDescriptor,
} from '../github-broker-issue-ops.js';
import { prListDescriptor } from '../github-broker-pr-ops.js';
import {
  buildIssueViewArgv,
  shapeIssueView,
  validateIssueViewParams,
} from '../github-broker-ops.js';

const isWindows = process.platform === 'win32';

// Set RUN_GH_NETWORK_TESTS=1 to enable tests that hit the live GitHub API.
const RUN_NETWORK_TESTS = process.env.RUN_GH_NETWORK_TESTS === '1';

function requireUnknownArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array');
  }
}

function requireRecord(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object');
  }
}

const skipNetwork = !RUN_NETWORK_TESTS || isWindows;

// ─── In-Memory Test Doubles (infrastructure boundary) ────────────────────────

class InMemoryTokenStore implements TokenStore {
  protected tokens: Map<string, OAuthToken> = new Map();
  private locks: Set<string> = new Set();
  private bucketStats: Map<string, BucketStats> = new Map();

  private key(provider: string, bucket?: string): string {
    return bucket ? `${provider}:${bucket}` : provider;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.key(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.key(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const k of this.tokens.keys()) {
      providers.add(k.split(':')[0]);
    }
    return [...providers];
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const k of this.tokens.keys()) {
      const parts = k.split(':');
      if (parts[0] === provider && parts.length > 1) {
        buckets.push(parts[1]);
      }
    }
    return buckets;
  }

  async getBucketStats(
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    return this.bucketStats.get(this.key(provider, bucket)) ?? null;
  }

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = this.key(provider, options?.bucket);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(this.key(provider, bucket));
  }

  async acquireAuthLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = `${this.key(provider, options?.bucket)}:auth`;
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseAuthLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(`${this.key(provider, bucket)}:auth`);
  }
}

class InMemoryProviderKeyStorage {
  private keys: Map<string, string> = new Map();

  async saveKey(name: string, apiKey: string): Promise<void> {
    this.keys.set(name, apiKey.trim());
  }

  async getKey(name: string): Promise<string | null> {
    return this.keys.get(name) ?? null;
  }

  async deleteKey(name: string): Promise<boolean> {
    return this.keys.delete(name);
  }

  async listKeys(): Promise<string[]> {
    return [...this.keys.keys()];
  }

  async hasKey(name: string): Promise<boolean> {
    return this.keys.has(name);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CAPABILITY_TOKEN = 'a'.repeat(64);

async function startAndConnect(
  serverInstance: CredentialProxyServer,
  capabilityToken?: string,
): Promise<ProxySocketClient> {
  const socketPath = await serverInstance.start();
  const c = new ProxySocketClient(socketPath, capabilityToken);
  await c.ensureConnected();
  return c;
}

/**
 * Builds server options with the GitHub broker wired in as an extraHandler.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-003
 * @pseudocode 003-github-broker.md lines 01-11
 */
function serverOptionsWithBroker(
  tokenStore: InMemoryTokenStore,
  keyStorage: InMemoryProviderKeyStorage,
  overrides: Partial<CredentialProxyServerOptions> = {},
): CredentialProxyServerOptions & { broker: GitHubBrokerHandler } {
  const broker = createGitHubBrokerHandler();
  return {
    tokenStore,
    providerKeyStorage:
      keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
    extraHandlers: { github: broker.handler },
    ...overrides,
    broker,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GitHub broker (P08)', () => {
  let tokenStore: InMemoryTokenStore;
  let keyStorage: InMemoryProviderKeyStorage;
  let server: CredentialProxyServer;
  let client: ProxySocketClient;

  beforeEach(() => {
    tokenStore = new InMemoryTokenStore();
    keyStorage = new InMemoryProviderKeyStorage();
  });

  afterEach(async () => {
    try {
      client.close();
    } catch {
      // client may not be initialized
    }
    try {
      await server.stop();
    } catch {
      // server may not be started
    }
  });

  describe.skipIf(skipNetwork)('live GitHub behavior', () => {
    // ─── T1: issue.view returns the shaped contract ─────────────────────────

    /**
     * issue.view against real public issue #135 in vybestack/llxprt-code
     * returns the shaped contract: number, title, state, author, labels[],
     * body, and comments[] when comments:true.
     *
     * @plan PLAN-20260731-GHBROKER.P08
     * @requirement REQ-004, REQ-013
     * @pseudocode 003-github-broker.md lines T1, 101-103
     */
    it('T1: issue.view returns the shaped contract (real gh)', async () => {
      const opts = serverOptionsWithBroker(tokenStore, keyStorage);
      server = new CredentialProxyServer(opts);
      client = await startAndConnect(server);

      const result = await client.request('github', {
        op: 'issue.view',
        number: 135,
        repo: 'vybestack/llxprt-code',
        comments: true,
      });

      expect(result.ok).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.number).toBe(135);
      expect(typeof data.title).toBe('string');
      expect(data.title).toContain('Git');
      expect(typeof data.state).toBe('string');
      expect(typeof data.author).toBe('string');
      expect(Array.isArray(data.labels)).toBe(true);
      expect(typeof data.body).toBe('string');
      expect(Array.isArray(data.comments)).toBe(true);
      requireUnknownArray(data.comments);
      const firstComment = data.comments[0];
      requireRecord(firstComment);
      expect(typeof firstComment.author).toBe('string');
      expect(typeof firstComment.createdAt).toBe('string');
      expect(typeof firstComment.body).toBe('string');
    }, 30000);

    // ─── T2: issue.view with repo targets another repository ──────────────────

    /**
     * issue.view with repo param targeting a different repository retrieves
     * that repo's issue. We verify the repo flag is passed through and the
     * response comes from the specified repo.
     *
     * @plan PLAN-20260731-GHBROKER.P08
     * @requirement REQ-009
     * @pseudocode 003-github-broker.md lines T2, 52-55
     */
    it('T2: issue.view with repo targets another repository (real gh)', async () => {
      const opts = serverOptionsWithBroker(tokenStore, keyStorage);
      server = new CredentialProxyServer(opts);
      client = await startAndConnect(server);

      // Use a well-known public repo with a stable issue number
      const result = await client.request('github', {
        op: 'issue.view',
        number: 1,
        repo: 'octocat/Hello-World',
        comments: false,
      });

      expect(result.ok).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.number).toBe(1);
    }, 30000);
  });

  // ─── T3: parameter beginning with '-' is rejected INVALID_PARAM ───────────

  /**
   * A parameter value beginning with '-' is rejected with INVALID_PARAM,
   * even under execFile, because a value like "--repo" in a positional
   * slot would be read by gh as a flag.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines T3, 26-28
   */
  it('T3: a parameter beginning with dash is rejected INVALID_PARAM', async () => {
    const opts = serverOptionsWithBroker(tokenStore, keyStorage);
    server = new CredentialProxyServer(opts);
    client = await startAndConnect(server);

    const result = await client.request('github', {
      op: 'issue.view',
      number: 135,
      repo: '--malicious',
      comments: false,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('INVALID_PARAM');
  });

  // ─── T4: unknown op → UNKNOWN_OP; unknown param → INVALID_PARAM ───────────

  /**
   * An unknown op yields UNKNOWN_OP and an unknown param yields
   * INVALID_PARAM. A typo must not silently produce a different query.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines T4, 30-31, 47
   */
  it('T4: unknown op → UNKNOWN_OP and unknown param → INVALID_PARAM', async () => {
    const opts = serverOptionsWithBroker(tokenStore, keyStorage);
    server = new CredentialProxyServer(opts);
    client = await startAndConnect(server);

    const unknownOp = await client.request('github', {
      op: 'issue.nonexistent',
      number: 135,
    });
    expect(unknownOp.ok).toBe(false);
    expect(unknownOp.code).toBe('UNKNOWN_OP');

    const unknownParam = await client.request('github', {
      op: 'issue.view',
      number: 135,
      bogusParam: true,
    });
    expect(unknownParam.ok).toBe(false);
    expect(unknownParam.code).toBe('INVALID_PARAM');
  });

  // ─── T5: constructing server with colliding extraHandler throws ───────────

  /**
   * Constructing the server with an extraHandler whose key collides with a
   * built-in op name (e.g. get_api_key) must THROW at construction time.
   * A silent override would be catastrophic.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-003
   * @pseudocode 003-github-broker.md lines T5, 01-06
   */
  it('T5: constructing server with colliding extraHandler throws', () => {
    expect(
      () =>
        new CredentialProxyServer({
          tokenStore,
          providerKeyStorage:
            keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
          extraHandlers: {
            get_api_key: async () => {},
          },
        }),
    ).toThrow(/collides with a built-in/i);
  });

  // ─── T6: GraphQL errors array maps to the right structured code ───────────

  /**
   * A GraphQL HTTP 200 response with a top-level errors[] array maps to the
   * right structured code based on the error type.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-004
   * @pseudocode 003-github-broker.md lines T6, 67-74
   */
  it('T6: GraphQL errors array maps to structured code', () => {
    expect(mapGraphQLErrorType('NOT_FOUND')).toBe('NOT_FOUND');
    expect(mapGraphQLErrorType('FORBIDDEN')).toBe('PERMISSION_DENIED');
    expect(mapGraphQLErrorType('RATE_LIMITED')).toBe('RATE_LIMITED');
    expect(mapGraphQLErrorType('UNKNOWN')).toBe('GITHUB_ERROR');
  });

  // ─── T7: GraphQL data+errors together surfaces as error ───────────────────

  /**
   * GraphQL responses containing BOTH data and errors must surface as an
   * error, never as partial data.
   *
   * This is tested at the shaping layer by feeding the shapeIssueView
   * function a raw JSON with both data and errors, expecting it to throw
   * a structured error rather than returning partial data.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-004
   * @pseudocode 003-github-broker.md lines T7, 75-76
   */
  it('T7: GraphQL data+errors together surfaces as error not partial data', () => {
    const rawWithBoth = {
      data: { node: { number: 42, title: 'fake' } },
      errors: [{ type: 'FORBIDDEN', message: 'Access denied to resource' }],
    };

    expect(() => shapeIssueView(rawWithBoth)).toThrow(
      /FORBIDDEN|PERMISSION_DENIED|error/i,
    );
  });

  // ─── T8: stderr carrying a token-shaped string is redacted ────────────────

  /**
   * Outbound messages are run through a redactor for token-shaped substrings.
   * This is belt-and-braces — the broker never holds a token — but stderr
   * comes from an external process we do not control.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-001
   * @pseudocode 003-github-broker.md lines T8, 90-95
   */
  it('T8: stderr carrying a token-shaped string is redacted', () => {
    const ghoToken = 'gho_abcdefghijklmnopqrstuvwx';
    const patToken = 'github_pat_abcdefghijklmnopqrst';
    const message = `some error ${ghoToken} and ${patToken} trailing text`;
    const redacted = redactTokenShaped(message);
    expect(redacted).not.toContain(ghoToken);
    expect(redacted).not.toContain(patToken);
    expect(redacted).toContain('[REDACTED]');
    // The surrounding text is preserved.
    expect(redacted).toContain('some error');
    expect(redacted).toContain('trailing text');
  });

  // ─── T9: broker import graph excludes credential storage ──────────────────

  /**
   * The broker module's import graph contains no credential-storage module.
   * The broker must not import providerKeyStorage, TokenStore, or anything
   * from the credential-storage layer.
   *
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-004
   * @pseudocode 003-github-broker.md lines T9, I2
   */
  it('T9: broker import graph excludes credential storage', async () => {
    const brokerPath = path.resolve(__dirname, '..', 'github-broker.ts');
    const moduleText = fs.readFileSync(brokerPath, 'utf-8');

    // The broker module must not import any credential-storage symbol.
    const forbidden = [
      'providerKeyStorage',
      'ProviderKeyStorage',
      'TokenStore',
      'credential-store',
      'credential-storage',
      'getKey',
      'saveKey',
    ];
    for (const term of forbidden) {
      // Allow the term in comments only (rare). Check import lines.
      const importLines = moduleText
        .split('\n')
        .filter((l) => l.trim().startsWith('import'));
      for (const line of importLines) {
        expect(line).not.toContain(term);
      }
    }

    // Also verify no import from the storage or auth proxy credential modules
    expect(moduleText).not.toMatch(
      /from\s+['"]@vybestack\/llxprt-code-storage['"]/,
    );
    expect(moduleText).not.toMatch(
      /from\s+['"][^'"]*credential-store-factory['"]/,
    );
  });

  describe.skipIf(isWindows)('non-Windows transport behavior', () => {
    // ─── T13: gh missing from PATH → HOST_GH_UNAVAILABLE ────────────────────

    /**
     * When gh is absent (ENOENT), the broker returns HOST_GH_UNAVAILABLE.
     * This is tested by using a PATH with no gh.
     *
     * @plan PLAN-20260731-GHBROKER.P08
     * @requirement REQ-004
     * @pseudocode 003-github-broker.md lines T13, 88
     */
    it('T13: gh missing from PATH → HOST_GH_UNAVAILABLE', async () => {
      const opts = serverOptionsWithBroker(tokenStore, keyStorage);
      server = new CredentialProxyServer(opts);
      client = await startAndConnect(server);

      // We need to trigger a gh invocation with an empty PATH. The broker
      // uses the process env PATH at call time, but we can't easily change
      // the server's env per-request. Instead, we verify the classifyStderr
      // and ENOENT path directly via the error translation module, which is
      // the code that produces HOST_GH_UNAVAILABLE.
      //
      // We also verify the full path by temporarily setting the env PATH to
      // a directory with no gh in the process that runs runGh.

      // Save and restore PATH. Use an empty temp dir so the spawn truly
      // fails to find gh.
      const origPath = process.env.PATH;
      const emptyDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'gh-broker-test-'),
      );
      process.env.PATH = emptyDir;
      let result: ProxyResponse;
      try {
        result = await client.request('github', {
          op: 'issue.view',
          number: 135,
          repo: 'vybestack/llxprt-code',
          comments: false,
        });
      } finally {
        process.env.PATH = origPath;
        try {
          fs.rmSync(emptyDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      }
      expect(result.ok).toBe(false);
      expect(result.code).toBe('HOST_GH_UNAVAILABLE');
    }, 30000);

    // ─── T14: capability-token auth still required ────────────────────────────

    /**
     * Capability-token authentication is still required to reach any github op.
     * Requests reach handlers only after the handshake gate, so an
     * unauthenticated connection must be rejected identically to today.
     *
     * @plan PLAN-20260731-GHBROKER.P08
     * @requirement REQ-015
     * @pseudocode 003-github-broker.md lines T14
     */
    it('T14: capability-token auth required for github op', async () => {
      const opts = serverOptionsWithBroker(tokenStore, keyStorage, {
        capabilityToken: CAPABILITY_TOKEN,
      });
      server = new CredentialProxyServer(opts);
      const socketPath = await server.start();

      // Connect WITHOUT the capability token — handshake must be rejected.
      const result = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const rawSocket = net.createConnection(socketPath);
          const decoder = new FrameDecoder();
          const timer = setTimeout(() => {
            rawSocket.destroy();
            reject(new Error('Timeout'));
          }, 5000);
          rawSocket.on('data', (chunk: Buffer) => {
            try {
              const frames = decoder.feed(chunk);
              for (const frame of frames) {
                clearTimeout(timer);
                rawSocket.destroy();
                resolve(frame);
                return;
              }
            } catch {
              clearTimeout(timer);
              rawSocket.destroy();
              resolve({ ok: false });
            }
          });
          rawSocket.on('close', () => {
            process.nextTick(() => {
              clearTimeout(timer);
              resolve({ ok: false });
            });
          });
          rawSocket.on('connect', () => {
            rawSocket.write(
              encodeFrame({
                v: 2,
                op: 'handshake',
                payload: { minVersion: 1, maxVersion: 2 },
              }),
            );
          });
          rawSocket.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
          });
        },
      );

      expect(result.ok).toBe(false);
      expect(result.code).toBe('UNAUTHORIZED');

      // Also verify a connection WITH the token CAN reach the github op
      // (but with invalid params so we don't need network). This proves the
      // handler is wired behind the gate.
      // Assign to the instance variable so afterEach closes it even when an
      // assertion below throws; a local would leak the socket on failure.
      const authedClient = new ProxySocketClient(socketPath, CAPABILITY_TOKEN);
      client = authedClient;
      await authedClient.ensureConnected();
      const githubResult = await authedClient.request('github', {
        op: 'issue.nonexistent',
        number: 1,
      });
      // The op is rejected (UNKNOWN_OP), NOT UNAUTHORIZED — proving the
      // handshake gate passed and the handler was reached.
      expect(githubResult.ok).toBe(false);
      expect(githubResult.code).toBe('UNKNOWN_OP');
      authedClient.close();
    });
  });
});

// ─── Pure-function unit tests (no server needed) ─────────────────────────────

/**
 * Unit tests for the pure functions: buildArgv, shapeIssueView,
 * validateIssueViewParams, classifyStderr. These test the pure logic
 * without I/O.
 *
 * @plan PLAN-20260731-GHBROKER.P08
 * @requirement REQ-002, REQ-004
 * @pseudocode 003-github-broker.md lines 13-31, 46-50, 67-95, 101-103
 */
describe('GitHub broker pure functions (P08)', () => {
  // ─── buildIssueViewArgv ───────────────────────────────────────────────────

  /**
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines 46-50, 52-55
   */
  describe('buildIssueViewArgv', () => {
    it('builds argv with issue subcommand, view, json fields, and number', () => {
      const argv = buildIssueViewArgv({ number: 135 }, false);
      expect(argv[0]).toBe('issue');
      expect(argv[1]).toBe('view');
      expect(argv).toContain('135');
      expect(argv).toContain('--json');
    });

    it('includes comments field when comments=true', () => {
      const argv = buildIssueViewArgv({ number: 135 }, true);
      const jsonIdx = argv.indexOf('--json');
      const fieldsValue = argv[jsonIdx + 1];
      expect(fieldsValue).toContain('comments');
      // The comments field list must also carry the assignment state the
      // shaped contract now exposes (issue 3407), not just comments.
      expect(fieldsValue).toContain('assignees');
      expect(fieldsValue).toContain('milestone');
    });

    it('omits comments field when comments=false', () => {
      const argv = buildIssueViewArgv({ number: 135 }, false);
      const jsonIdx = argv.indexOf('--json');
      const fieldsValue = argv[jsonIdx + 1];
      expect(fieldsValue).not.toContain('comments');
      // Even without comments the required view fields must still carry
      // assignees and milestone (issue 3407); the comments flag is only meant
      // to add the comments field.
      expect(fieldsValue).toContain('assignees');
      expect(fieldsValue).toContain('milestone');
    });

    it('appends --repo when repo is provided', () => {
      const argv = buildIssueViewArgv(
        { number: 135, repo: 'vybestack/llxprt-code' },
        false,
      );
      const repoIdx = argv.indexOf('--repo');
      expect(repoIdx).toBeGreaterThan(-1);
      expect(argv[repoIdx + 1]).toBe('vybestack/llxprt-code');
    });

    it('omits --repo when repo is not provided', () => {
      const argv = buildIssueViewArgv({ number: 135 }, false);
      expect(argv).not.toContain('--repo');
    });
  });

  // ─── validateIssueViewParams ──────────────────────────────────────────────

  /**
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-002
   * @pseudocode 003-github-broker.md lines 13-31
   */
  describe('validateIssueViewParams', () => {
    it('accepts valid number and comments', () => {
      const result = validateIssueViewParams({
        number: 135,
        comments: true,
      });
      expect(result).toBeNull();
    });

    it('rejects missing number', () => {
      const result = validateIssueViewParams({ comments: true });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects non-integer number', () => {
      const result = validateIssueViewParams({ number: 1.5 });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects zero number', () => {
      const result = validateIssueViewParams({ number: 0 });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects negative number', () => {
      const result = validateIssueViewParams({ number: -5 });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('accepts valid repo', () => {
      const result = validateIssueViewParams({
        number: 135,
        repo: 'vybestack/llxprt-code',
      });
      expect(result).toBeNull();
    });

    it('rejects repo with invalid format (no slash)', () => {
      const result = validateIssueViewParams({
        number: 135,
        repo: 'invalidrepo',
      });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects repo beginning with dash', () => {
      const result = validateIssueViewParams({
        number: 135,
        repo: '--malicious',
      });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects unknown parameter', () => {
      const result = validateIssueViewParams({
        number: 135,
        bogusParam: 'x',
      });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects string param value beginning with dash', () => {
      // Simulate a string param (body is not in issue.view, but we test the
      // generic dash-rejection via the repo param)
      const result = validateIssueViewParams({
        number: 135,
        repo: '-foo/bar',
      });
      expect(result?.code).toBe('INVALID_PARAM');
    });
  });

  // ─── shapeIssueView ───────────────────────────────────────────────────────

  /**
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-013
   * @pseudocode 003-github-broker.md lines 101-103
   */
  describe('shapeIssueView', () => {
    it('shapes a minimal raw gh JSON into the contract', () => {
      const raw = {
        number: 42,
        title: 'Test Issue',
        state: 'OPEN',
        author: { login: 'testuser' },
        labels: [{ name: 'bug' }],
        assignees: [],
        milestone: null,
        body: 'This is a test body',
        comments: [
          {
            author: { login: 'commenter1' },
            createdAt: '2026-01-01T00:00:00Z',
            body: 'First comment',
          },
        ],
      };
      const shaped = shapeIssueView(raw);
      expect(shaped.number).toBe(42);
      expect(shaped.title).toBe('Test Issue');
      // gh reports OPEN here but `open` from search; the shaped contract
      // normalises to the lower-case form the `state` parameter accepts, so
      // the same issue compares equal across operations (issue 3407).
      expect(shaped.state).toBe('open');
      expect(shaped.author).toBe('testuser');
      expect(shaped.labels).toStrictEqual(['bug']);
      expect(shaped.assignees).toStrictEqual([]);
      expect(shaped.milestone).toBeNull();
      expect(shaped.body).toBe('This is a test body');
      expect(Array.isArray(shaped.comments)).toBe(true);
      const c = shaped.comments[0];
      expect(c.author).toBe('commenter1');
      expect(c.createdAt).toBe('2026-01-01T00:00:00Z');
      expect(c.body).toBe('First comment');
    });

    it('excludes comments when comments array is absent', () => {
      const description = [
        'Line one of the milestone body.',
        '',
        'Line two of the milestone body continued.',
        '',
        'Conclusion paragraph.',
      ].join('\n');
      const raw = {
        number: 42,
        title: 'Test',
        state: 'OPEN',
        author: { login: 'user' },
        labels: [],
        assignees: [
          {
            id: 'MDQ6VXNlcjQyMDI5',
            login: 'acoliver',
            name: 'Andrew C. Oliver',
            databaseId: 0,
          },
        ],
        milestone: {
          number: 13,
          title: '0.12.0',
          description,
          dueOn: '2026-08-31T00:00:00Z',
        },
        body: 'body',
      };
      const shaped = shapeIssueView(raw);
      expect(shaped.comments).toBeNull();
      // The realistic assignee object is reduced to a login.
      expect(shaped.assignees).toStrictEqual(['acoliver']);
      expect(shaped.milestone).toBe('0.12.0');
      // The milestone description must be reduced to the title alone; its
      // multi-paragraph text must not appear anywhere in the shaped object.
      expect(JSON.stringify(shaped)).not.toContain(description);
    });

    it('handles missing labels gracefully', () => {
      const raw = {
        number: 42,
        title: 'Test',
        state: 'OPEN',
        author: { login: 'user' },
        body: 'body',
      };
      const shaped = shapeIssueView(raw);
      expect(shaped.labels).toStrictEqual([]);
    });

    it('handles author as a string (defensive for external data)', () => {
      const raw = {
        number: 42,
        title: 'Test',
        state: 'OPEN',
        author: 'plainuser',
        labels: [],
        body: 'body',
      };
      const shaped = shapeIssueView(raw);
      expect(shaped.author).toBe('plainuser');
    });
  });

  // ─── classifyStderr ───────────────────────────────────────────────────────

  /**
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-004
   * @pseudocode 003-github-broker.md lines 78-86
   */
  describe('classifyStderr', () => {
    it('classifies rate limit', () => {
      expect(classifyStderr('HTTP 403: API rate limit exceeded')).toBe(
        'RATE_LIMITED',
      );
    });

    it('classifies not found', () => {
      expect(classifyStderr('Could not resolve to a node')).toBe('NOT_FOUND');
      expect(classifyStderr('issue not found')).toBe('NOT_FOUND');
    });

    it('classifies auth required', () => {
      expect(classifyStderr('please run gh auth login')).toBe(
        'HOST_AUTH_REQUIRED',
      );
      expect(classifyStderr('authentication required')).toBe(
        'HOST_AUTH_REQUIRED',
      );
    });

    it('classifies permission denied (HTTP 403)', () => {
      expect(classifyStderr('HTTP 403: Forbidden')).toBe('PERMISSION_DENIED');
    });

    it('classifies unknown as GITHUB_ERROR', () => {
      expect(classifyStderr('some random error')).toBe('GITHUB_ERROR');
    });
  });

  // ─── augmentSearchError ───────────────────────────────────────────────────

  /**
   * gh's search failure text blames missing resources or permissions, which
   * sends a caller down a permissions rabbit hole when the real cause is a
   * `repo:` term or a pre-quoted qualifier value. The github tool is the only
   * sanctioned GitHub interface inside the sandbox (no gh binary, no token),
   * so the error itself has to close the self-correction loop.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-3
   * @issue 3407
   */
  describe('augmentSearchError', () => {
    // The failure exactly as reported in issue 3407.
    const reported = {
      code: 'GITHUB_ERROR' as const,
      message:
        'Invalid search query "( repo:\\"alibaba/open-code-review author:acoliver\\" ) type:issue".\nThe listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.',
    };

    it('appends concrete guidance to the reported search failure', () => {
      const augmented = augmentSearchError(reported);
      expect(augmented.message).toContain(reported.message);
      expect(augmented.message).toContain('repo parameter');
      expect(augmented.message.length).toBeGreaterThan(reported.message.length);
      // The classification is unchanged; only the guidance is added.
      expect(augmented.code).toBe('GITHUB_ERROR');
    });

    it('is idempotent, so a re-augmented error is not annotated twice', () => {
      const once = augmentSearchError(reported);
      const twice = augmentSearchError(once);
      expect(twice.message).toBe(once.message);
    });

    /**
     * GitHub throttles the search endpoint separately from everything else,
     * and says only "wait a few minutes". Two evaluated models fired parallel
     * searches, got 403s, and could not tell that non-search operations were
     * still usable; one burned roughly eight of nineteen calls on it.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-3
     * @issue 3407
     */
    it('tells a throttled search that only search is affected', () => {
      const throttled = {
        code: 'RATE_LIMITED' as const,
        message:
          'HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
      };
      const augmented = augmentSearchError(throttled);
      expect(augmented.message).toContain(throttled.message);
      expect(augmented.message).toContain('issue.list');
      expect(augmented.code).toBe('RATE_LIMITED');
      // Throttling guidance must not be confused with query-syntax guidance.
      expect(augmented.message).not.toContain('repo parameter');
      // ...and it must not stack on a retry of the same error.
      expect(augmentSearchError(augmented).message).toBe(augmented.message);
    });

    it('leaves an unrelated failure completely untouched', () => {
      const notFound = {
        code: 'NOT_FOUND' as const,
        message: 'Could not resolve to a node',
      };
      expect(augmentSearchError(notFound)).toStrictEqual(notFound);
    });

    /**
     * The list ops reach the throttled search endpoint too, to count a page
     * that did not fit, so a 403 raised there needs the same guidance. One
     * evaluated model was blocked on pr.list and found the remediation text
     * only on a different operation.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-3
     * @issue 3407
     */
    it('every op that can reach the search endpoint gives guided failures', () => {
      expect(searchIssuesDescriptor.augmentError).toBeDefined();
      expect(searchPrsDescriptor.augmentError).toBeDefined();
      expect(issueListDescriptor.augmentError).toBeDefined();
      expect(prListDescriptor.augmentError).toBeDefined();
      // issue.view never touches it, so it gets no search guidance.
      expect(issueViewDescriptor.augmentError).toBeUndefined();
    });

    /**
     * The remedy is counter-intuitive and was stated backwards at first: a
     * SMALLER limit truncates more often and therefore causes more count
     * requests against the throttled endpoint, not fewer.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-3
     * @issue 3407
     */
    it('tells a throttled caller to raise the limit, not lower it', () => {
      const throttled = {
        code: 'RATE_LIMITED' as const,
        message: 'HTTP 403: You have exceeded a secondary rate limit.',
      };
      const message = augmentSearchError(throttled).message;
      expect(message).toContain('RAISING');
      expect(message).not.toContain('a smaller "limit" avoids it');
    });
  });

  // ─── redactTokenShaped ────────────────────────────────────────────────────

  /**
   * @plan PLAN-20260731-GHBROKER.P08
   * @requirement REQ-001
   * @pseudocode 003-github-broker.md lines 90-95
   */
  describe('redactTokenShaped', () => {
    it('redacts gho_ tokens', () => {
      const result = redactTokenShaped('error: gho_ABCDEFGHIJKLMNOPQRSTUVWX');
      expect(result).not.toContain('gho_');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts github_pat_ tokens', () => {
      const result = redactTokenShaped(
        'error: github_pat_ABCDEFGHIJKLMNOPQRST',
      );
      expect(result).not.toContain('github_pat_');
      expect(result).toContain('[REDACTED]');
    });

    it('redacts ghp_ tokens', () => {
      const result = redactTokenShaped('error: ghp_ABCDEFGHIJKLMNOPQRSTUVWX');
      expect(result).not.toContain('ghp_');
    });

    it('redacts ghs_ tokens', () => {
      const result = redactTokenShaped('error: ghs_ABCDEFGHIJKLMNOPQRSTUVWX');
      expect(result).not.toContain('ghs_');
    });

    it('preserves non-token text', () => {
      const result = redactTokenShaped('a normal error message');
      expect(result).toBe('a normal error message');
    });

    it('handles strings with no tokens', () => {
      const result = redactTokenShaped('no secrets here');
      expect(result).toBe('no secrets here');
    });
  });
});
