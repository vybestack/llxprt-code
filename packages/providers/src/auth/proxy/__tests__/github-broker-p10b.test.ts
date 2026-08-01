/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 tests (part B) for the GitHub broker: search.issues, search.prs,
 * run.list, label.list, cross-cutting dash/limit validation, and
 * end-to-end network tests against real gh and real public data.
 *
 * Split from github-broker-p10.test.ts to stay under the 800-line lint cap.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 101-126
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

import { createGitHubBrokerHandler } from '../github-broker.js';
import {
  buildSearchIssuesArgv,
  shapeSearchResults,
  validateSearchIssuesParams,
  buildSearchPrsArgv,
  validateSearchPrsParams,
  buildRunListArgv,
  shapeRunList,
  validateRunListParams,
  buildLabelListArgv,
  shapeLabelList,
  validateLabelListParams,
  validateIssueListParams,
  validatePrListParams,
  validateIssueViewParams,
  validatePrViewParams,
  validatePrDiffParams,
  validatePrChecksParams,
  validatePrReviewsParams,
} from '../github-broker-ops.js';
import { MAX_LIMIT } from '../github-broker-validation.js';

const isWindows = process.platform === 'win32';
const RUN_NETWORK_TESTS = process.env.RUN_GH_NETWORK_TESTS === '1';
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
    for (const k of this.tokens.keys()) providers.add(k.split(':')[0]);
    return [...providers];
  }
  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const k of this.tokens.keys()) {
      const parts = k.split(':');
      if (parts[0] === provider && parts.length > 1) buckets.push(parts[1]);
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

function serverOptionsWithBroker(
  tokenStore: InMemoryTokenStore,
  keyStorage: InMemoryProviderKeyStorage,
  overrides: Partial<CredentialProxyServerOptions> = {},
): CredentialProxyServerOptions {
  const broker = createGitHubBrokerHandler();
  return {
    tokenStore,
    providerKeyStorage:
      keyStorage as unknown as CredentialProxyServerOptions['providerKeyStorage'],
    extraHandlers: { github: broker.handler },
    ...overrides,
  };
}

// ─── search pure-function tests ──────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
describe('search pure functions (P10)', () => {
  describe('buildSearchIssuesArgv', () => {
    it('builds argv with search issues subcommand', () => {
      const argv = buildSearchIssuesArgv({ query: 'is:open label:bug' });
      expect(argv[0]).toBe('search');
      expect(argv[1]).toBe('issues');
      expect(argv[2]).toBe('is:open label:bug');
    });

    it('includes --json without body', () => {
      const argv = buildSearchIssuesArgv({ query: 'test' });
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).not.toContain('body');
    });

    it('defaults limit to 30', () => {
      const argv = buildSearchIssuesArgv({ query: 'test' });
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('30');
    });

    it('appends --repo when provided', () => {
      const argv = buildSearchIssuesArgv({ query: 'test', repo: 'o/r' });
      expect(argv).toContain('--repo');
    });
  });

  describe('buildSearchPrsArgv', () => {
    it('builds argv with search prs subcommand', () => {
      const argv = buildSearchPrsArgv({ query: 'is:pr is:open' });
      expect(argv[0]).toBe('search');
      expect(argv[1]).toBe('prs');
      expect(argv[2]).toBe('is:pr is:open');
    });
  });

  describe('validateSearchIssuesParams', () => {
    it('rejects limit above 100', () => {
      expect(validateSearchIssuesParams({ query: 'x', limit: 101 })?.code).toBe(
        'INVALID_PARAM',
      );
    });

    it('rejects dash-prefixed query', () => {
      expect(validateSearchIssuesParams({ query: '--malicious' })?.code).toBe(
        'INVALID_PARAM',
      );
    });

    it('rejects dash-prefixed repo', () => {
      expect(
        validateSearchIssuesParams({ query: 'x', repo: '-a/b' })?.code,
      ).toBe('INVALID_PARAM');
    });
  });

  describe('validateSearchPrsParams', () => {
    it('rejects dash-prefixed query', () => {
      expect(validateSearchPrsParams({ query: '--bad' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapeSearchResults', () => {
    it('shapes results with repository field, excluding body', () => {
      const raw = [
        {
          number: 1,
          title: 'Result',
          state: 'open',
          repository: { nameWithOwner: 'o/repo' },
          updatedAt: '2026-01-01T00:00:00Z',
          body: 'should not appear',
        },
      ];
      const shaped = shapeSearchResults(raw);
      expect(shaped[0].number).toBe(1);
      expect(shaped[0].repository).toBe('o/repo');
      expect(shaped[0]).not.toHaveProperty('body');
    });

    it('extracts repository as string when given directly', () => {
      const raw = [{ repository: 'string/repo' }];
      const shaped = shapeSearchResults(raw);
      expect(shaped[0].repository).toBe('string/repo');
    });
  });
});

// ─── run.list pure-function tests ────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55
 */
describe('run.list pure functions (P10)', () => {
  describe('buildRunListArgv', () => {
    it('builds argv with run list and json fields', () => {
      const argv = buildRunListArgv({});
      expect(argv[0]).toBe('run');
      expect(argv[1]).toBe('list');
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).toContain('databaseId');
      expect(argv[jsonIdx + 1]).toContain('status');
      expect(argv[jsonIdx + 1]).toContain('conclusion');
    });

    it('includes --branch when provided', () => {
      const argv = buildRunListArgv({ branch: 'feature' });
      const idx = argv.indexOf('--branch');
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe('feature');
    });

    it('defaults limit to 30', () => {
      const argv = buildRunListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('30');
    });

    it('appends --repo when provided', () => {
      const argv = buildRunListArgv({ repo: 'o/r' });
      expect(argv).toContain('--repo');
    });
  });

  describe('validateRunListParams', () => {
    it('rejects dash-prefixed branch', () => {
      expect(validateRunListParams({ branch: '--bad' })?.code).toBe(
        'INVALID_PARAM',
      );
    });

    it('rejects dash-prefixed repo', () => {
      expect(validateRunListParams({ repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapeRunList', () => {
    it('shapes workflow run items', () => {
      const raw = [
        {
          databaseId: 12345,
          name: 'CI',
          status: 'completed',
          conclusion: 'success',
          headBranch: 'main',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ];
      const shaped = shapeRunList(raw);
      expect(shaped[0].databaseId).toBe(12345);
      expect(shaped[0].name).toBe('CI');
      expect(shaped[0].status).toBe('completed');
      expect(shaped[0].conclusion).toBe('success');
    });
  });
});

// ─── label.list pure-function tests ──────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55
 */
describe('label.list pure functions (P10)', () => {
  describe('buildLabelListArgv', () => {
    it('builds argv with label list and json fields', () => {
      const argv = buildLabelListArgv({});
      expect(argv[0]).toBe('label');
      expect(argv[1]).toBe('list');
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).toContain('name');
      expect(argv[jsonIdx + 1]).toContain('color');
      expect(argv[jsonIdx + 1]).toContain('description');
    });

    it('defaults limit to 30', () => {
      const argv = buildLabelListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('30');
    });

    it('appends --repo when provided', () => {
      const argv = buildLabelListArgv({ repo: 'o/r' });
      expect(argv).toContain('--repo');
    });
  });

  describe('validateLabelListParams', () => {
    it('rejects dash-prefixed repo', () => {
      expect(validateLabelListParams({ repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapeLabelList', () => {
    it('shapes label items', () => {
      const raw = [
        { name: 'bug', color: 'd73a4a', description: 'Something is broken' },
      ];
      const shaped = shapeLabelList(raw);
      expect(shaped[0].name).toBe('bug');
      expect(shaped[0].color).toBe('d73a4a');
      expect(shaped[0].description).toBe('Something is broken');
    });
  });
});

// ─── Cross-cutting: dash-prefixed value rejection on every op ───────────────

/**
 * Every op must reject a dash-prefixed value for the repo parameter.
 * This is the flag-injection defense from pseudocode line 26.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 26-28
 */
describe('dash-prefixed value rejection on every op (P10)', () => {
  const cases: Array<{
    name: string;
    validator: (p: Record<string, unknown>) => { code: string } | null;
    baseParams: Record<string, unknown>;
  }> = [
    {
      name: 'issue.view',
      validator: (p) => validateIssueViewParams(p),
      baseParams: { number: 1 },
    },
    {
      name: 'issue.list',
      validator: (p) => validateIssueListParams(p),
      baseParams: {},
    },
    {
      name: 'pr.list',
      validator: (p) => validatePrListParams(p),
      baseParams: {},
    },
    {
      name: 'pr.view',
      validator: (p) => validatePrViewParams(p),
      baseParams: { number: 1 },
    },
    {
      name: 'pr.diff',
      validator: (p) => validatePrDiffParams(p),
      baseParams: { number: 1 },
    },
    {
      name: 'pr.checks',
      validator: (p) => validatePrChecksParams(p),
      baseParams: { number: 1 },
    },
    {
      name: 'pr.reviews',
      validator: (p) => validatePrReviewsParams(p),
      baseParams: { number: 1 },
    },
    {
      name: 'search.issues',
      validator: (p) => validateSearchIssuesParams(p),
      baseParams: { query: 'test' },
    },
    {
      name: 'search.prs',
      validator: (p) => validateSearchPrsParams(p),
      baseParams: { query: 'test' },
    },
    {
      name: 'run.list',
      validator: (p) => validateRunListParams(p),
      baseParams: {},
    },
    {
      name: 'label.list',
      validator: (p) => validateLabelListParams(p),
      baseParams: {},
    },
  ];

  for (const { name, validator, baseParams } of cases) {
    it(`${name} rejects dash-prefixed repo`, () => {
      const result = validator({ ...baseParams, repo: '--malicious' });
      expect(result?.code).toBe('INVALID_PARAM');
    });
  }
});

// ─── Cross-cutting: limit above 100 rejected ────────────────────────────────

/**
 * Ops that accept a limit must reject values above 100 (MAX_LIMIT).
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-013
 * @pseudocode 003-github-broker.md lines 120-123
 */
describe('limit above 100 rejected on list/search ops (P10)', () => {
  it('issue.list rejects limit > 100', () => {
    expect(validateIssueListParams({ limit: MAX_LIMIT + 1 })?.code).toBe(
      'INVALID_PARAM',
    );
  });

  it('pr.list rejects limit > 100', () => {
    expect(validatePrListParams({ limit: MAX_LIMIT + 1 })?.code).toBe(
      'INVALID_PARAM',
    );
  });

  it('search.issues rejects limit > 100', () => {
    expect(
      validateSearchIssuesParams({ query: 'x', limit: MAX_LIMIT + 1 })?.code,
    ).toBe('INVALID_PARAM');
  });

  it('run.list rejects limit > 100', () => {
    expect(validateRunListParams({ limit: MAX_LIMIT + 1 })?.code).toBe(
      'INVALID_PARAM',
    );
  });

  it('label.list rejects limit > 100', () => {
    expect(validateLabelListParams({ limit: MAX_LIMIT + 1 })?.code).toBe(
      'INVALID_PARAM',
    );
  });
});

// ─── End-to-end tests against real gh and real public data ───────────────────

/**
 * End-to-end tests that exercise the full dispatch path against real gh
 * and real public data in vybestack/llxprt-code. Gated behind
 * RUN_GH_NETWORK_TESTS=1.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines T1-T14
 */
describe.skipIf(skipNetwork)('GitHub broker P10 end-to-end (real gh)', () => {
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

  /**
   * Asserts that a list result excludes bodies. Extracted so network tests
   * can validate body exclusion without placing `expect` inside an `if`
   * block (vitest/no-conditional-expect).
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-013
   * @pseudocode 003-github-broker.md lines 120-123
   */
  function assertListExcludesBodies(data: unknown, key: string): void {
    const resp = data as Record<string, unknown>;
    expect(
      Array.isArray(resp),
      'collection ops must return a named object, not a bare array; the proxy client rejects array data',
    ).toBe(false);
    const items = resp[key] as unknown[];
    expect(Array.isArray(items)).toBe(true);
    items.slice(0, 1).forEach((item) => {
      const record = item as Record<string, unknown>;
      expect(record).not.toHaveProperty('body');
    });
  }

  /**
   * issue.list against vybestack/llxprt-code returns issues without bodies.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-009, REQ-013
   * @pseudocode 003-github-broker.md lines 120-123
   */
  it('issue.list returns issues without bodies (repo: vybestack/llxprt-code)', async () => {
    server = new CredentialProxyServer(
      serverOptionsWithBroker(tokenStore, keyStorage),
    );
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const result = await client.request('github', {
      op: 'issue.list',
      repo: 'vybestack/llxprt-code',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    assertListExcludesBodies(result.data, 'issues');
  }, 30000);

  /**
   * pr.list against vybestack/llxprt-code returns PRs without bodies.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-009, REQ-013
   * @pseudocode 003-github-broker.md lines 120-123
   */
  it('pr.list returns PRs without bodies (repo: vybestack/llxprt-code)', async () => {
    server = new CredentialProxyServer(
      serverOptionsWithBroker(tokenStore, keyStorage),
    );
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const result = await client.request('github', {
      op: 'pr.list',
      repo: 'vybestack/llxprt-code',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    assertListExcludesBodies(result.data, 'prs');
  }, 30000);

  /**
   * label.list against vybestack/llxprt-code returns labels.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-009, REQ-013
   */
  it('label.list returns labels (repo: vybestack/llxprt-code)', async () => {
    server = new CredentialProxyServer(
      serverOptionsWithBroker(tokenStore, keyStorage),
    );
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const result = await client.request('github', {
      op: 'label.list',
      repo: 'vybestack/llxprt-code',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    assertListExcludesBodies(result.data, 'labels');
  }, 30000);

  /**
   * run.list against vybestack/llxprt-code returns workflow runs.
   *
   * @plan PLAN-20260731-GHBROKER.P10
   * @requirement REQ-009, REQ-013
   */
  it('run.list returns runs (repo: vybestack/llxprt-code)', async () => {
    server = new CredentialProxyServer(
      serverOptionsWithBroker(tokenStore, keyStorage),
    );
    const socketPath = await server.start();
    client = new ProxySocketClient(socketPath);
    await client.ensureConnected();

    const result = await client.request('github', {
      op: 'run.list',
      repo: 'vybestack/llxprt-code',
      limit: 5,
    });

    expect(result.ok).toBe(true);
    assertListExcludesBodies(result.data, 'runs');
  }, 30000);
});
