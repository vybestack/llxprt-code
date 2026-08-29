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

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

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
import type { GhRunner } from '../github-broker-types.js';
import {
  searchIssuesDescriptor,
  searchPrsDescriptor,
} from '../github-broker-search-ops.js';
import { shapeIssueList } from '../github-broker-issue-ops.js';
import { buildPrListArgv } from '../github-broker-pr-ops.js';

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
      // Each whitespace-separated term is its OWN argv element so gh parses
      // every qualifier instead of swallowing the rest of the query, and the
      // terms sit behind the `--` option terminator so an exclusion term
      // cannot be read as a flag.
      const terms = argv.slice(argv.indexOf('--') + 1);
      expect(terms).toStrictEqual(['is:open', 'label:bug']);
    });

    it('includes --json without body', () => {
      const argv = buildSearchIssuesArgv({ query: 'test' });
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).not.toContain('body');
    });

    /**
     * gh is asked for ONE more row than the caller's limit, so a full page can
     * be distinguished from a complete result set; `windowByLimit` trims the
     * probe row and reports `hasMore`. Asserting the raw 30 here would pin the
     * ambiguity this fixes.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-6
     * @issue 3407
     */
    it('over-fetches one past the default limit of 30', () => {
      const argv = buildSearchIssuesArgv({ query: 'test' });
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('31');
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
      const terms = argv.slice(argv.indexOf('--') + 1);
      expect(terms).toStrictEqual(['is:pr', 'is:open']);
    });
  });

  describe('search query tokenization and repo lifting (issue 3407)', () => {
    const builders: ReadonlyArray<{
      name: string;
      build: (p: Record<string, unknown>) => string[];
    }> = [
      { name: 'search.issues', build: buildSearchIssuesArgv },
      { name: 'search.prs', build: buildSearchPrsArgv },
    ];

    /**
     * The query terms: everything after the `--` option terminator. Terms are
     * emitted last and behind `--` so a GitHub exclusion term like
     * `-label:bug` is not parsed by gh as a CLI flag.
     */
    function positionals(argv: string[]): string[] {
      const end = argv.indexOf('--');
      return end === -1 ? [] : argv.slice(end + 1);
    }

    for (const { name, build } of builders) {
      /**
       * The actual issue 3407 regression: the whole query used to be spliced
       * as ONE positional, so gh swallowed the rest of the query as one
       * qualifier value. Each term must be its own argv element.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: multi-term query becomes separate positional argv elements`, () => {
        const argv = build({
          query: 'repo:vybestack/llxprt-code author:acoliver',
        });
        // The repo term is lifted into --repo, so the surviving positional
        // shows the OTHER term alone — the regression was one element containing
        // the whole string with a space.
        expect(positionals(argv)).toStrictEqual(['author:acoliver']);
        // The regression: a single element containing the space must never exist.
        expect(argv).not.toContain(
          'repo:vybestack/llxprt-code author:acoliver',
        );
        expect(argv.filter((a) => a === '--repo')).toHaveLength(1);
      });

      /**
       * A liftable repo: term becomes --repo and is dropped from the
       * positionals, quoted or not.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: lifts an unquoted repo: term into --repo`, () => {
        const argv = build({ query: 'repo:vybestack/llxprt-code is:open' });
        expect(positionals(argv)).toStrictEqual(['is:open']);
        const idx = argv.indexOf('--repo');
        expect(idx).toBeGreaterThan(-1);
        expect(argv[idx + 1]).toBe('vybestack/llxprt-code');
      });

      /**
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: lifts a quoted repo: term into --repo, dropping the term`, () => {
        const argv = build({ query: 'repo:"vybestack/llxprt-code" is:open' });
        expect(positionals(argv)).toStrictEqual(['is:open']);
        const idx = argv.indexOf('--repo');
        expect(idx).toBeGreaterThan(-1);
        expect(argv[idx + 1]).toBe('vybestack/llxprt-code');
      });

      /**
       * An explicit repo param wins on conflict and the embedded repo: term
       * is STILL dropped, so exactly one --repo appears.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: explicit repo param wins and the embedded repo: term is dropped`, () => {
        const argv = build({
          query: 'repo:embedded/repo is:open',
          repo: 'explicit/repo',
        });
        expect(positionals(argv)).toStrictEqual(['is:open']);
        const repos = argv.filter((a) => a === '--repo');
        expect(repos).toHaveLength(1);
        expect(argv[argv.indexOf('--repo') + 1]).toBe('explicit/repo');
      });

      /**
       * A repo: value that is not owner/name must stay a positional term and
       * never become --repo.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: a non-conforming repo: value stays a term`, () => {
        const argv = build({ query: 'repo:notarepo' });
        expect(positionals(argv)).toStrictEqual(['repo:notarepo']);
        expect(argv).not.toContain('--repo');
      });

      /**
       * Only the FIRST liftable repo: term is lifted; a second one stays a
       * positional term.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: a second repo: term stays a positional term`, () => {
        const argv = build({
          query: 'repo:first/repo repo:second/repo',
        });
        expect(positionals(argv)).toStrictEqual(['repo:second/repo']);
        const idx = argv.indexOf('--repo');
        expect(idx).toBeGreaterThan(-1);
        expect(argv[idx + 1]).toBe('first/repo');
      });

      /**
       * Quote stripping: a quoted qualifier value loses its quotes (gh quotes
       * each value itself, so a pre-quoted value would arrive double-quoted
       * at the API and match nothing); a multi-word freetext phrase keeps its
       * inner space as ONE term.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: strips quotes around a qualifier value and keeps freetext phrases intact`, () => {
        const qualifier = build({ query: 'milestone:"0.11.0" is:open' });
        expect(positionals(qualifier)).toStrictEqual([
          'milestone:0.11.0',
          'is:open',
        ]);
        const phrase = build({ query: '"sandbox proxy" is:open' });
        expect(positionals(phrase)).toStrictEqual(['sandbox proxy', 'is:open']);
      });

      /**
       * The builder MUST NEVER add quotes of its own: a quoted value
       * arriving at the API double-quoted matches nothing. No argv element
       * may contain a quote character.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: no argv element ever contains a quote character`, () => {
        const argv = build({
          query: 'repo:"owner/name" is:open "sandbox proxy"',
        });
        expect(argv.some((a) => a.includes('"'))).toBe(false);
      });

      /**
       * Tab and newline separate terms exactly like a space.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: tokenizes on tab and newline like a space`, () => {
        const argv = build({ query: 'is:open\tlabel:bug\nis:pr' });
        expect(positionals(argv)).toStrictEqual([
          'is:open',
          'label:bug',
          'is:pr',
        ]);
      });

      /**
       * An unterminated quote makes the rest of the string one token rather
       * than choking: the whole remainder becomes ONE positional term.
       *
       * @plan PLAN-20260731-GHBROKER.P10
       * @requirement REQ-002, REQ-013
       */
      it(`${name}: an unterminated quote makes the rest one token`, () => {
        const argv = build({ query: 'milestone:"0.11.0 is:open' });
        expect(positionals(argv)).toStrictEqual(['milestone:0.11.0 is:open']);
      });

      /**
       * A query that carries no terms of its own must not contribute an
       * empty positional: an empty argv element reaches gh as an empty
       * search term rather than as "no term at all".
       *
       * @plan PLAN-20260828-ISSUE3407
       * @requirement AC-2
       * @issue 3407
       */
      it(`${name}: a whitespace-only query contributes no positional terms`, () => {
        const argv = build({ query: '   ' });
        expect(positionals(argv)).toStrictEqual([]);
        expect(argv).not.toContain('');
        // No terms means no bare trailing terminator either.
        expect(argv).not.toContain('--');
        expect(argv[0]).toBe('search');
        expect(argv.indexOf('--json')).toBe(2);
      });

      /**
       * GitHub excludes a qualifier by prefixing it with a dash. Once every
       * term is its own argv element, gh parses a leading-dash term as a CLI
       * flag and dies with "unknown shorthand flag: 'l'" unless the terms sit
       * behind a `--` option terminator. Value validation only rejects a
       * query that STARTS with a dash, so an interior `-label:bug` reaches
       * argv and the terminator is what makes it work.
       *
       * @plan PLAN-20260828-ISSUE3407
       * @requirement AC-2
       * @issue 3407
       */
      it(`${name}: an exclusion term is protected by the -- terminator`, () => {
        const argv = build({ query: 'is:open -label:bug' });
        expect(positionals(argv)).toStrictEqual(['is:open', '-label:bug']);
        // Every flag must precede the terminator, or gh sees the terms first.
        const terminator = argv.indexOf('--');
        expect(terminator).toBeGreaterThan(-1);
        expect(argv.indexOf('--json')).toBeLessThan(terminator);
        expect(argv.indexOf('--limit')).toBeLessThan(terminator);
        // Nothing after the terminator may be mistaken for a flag position.
        expect(argv.lastIndexOf('--')).toBe(terminator);
      });

      /**
       * @plan PLAN-20260828-ISSUE3407
       * @requirement AC-1, AC-2
       * @issue 3407
       */
      it(`${name}: --repo is emitted before the terminator, never after`, () => {
        const argv = build({ query: 'repo:owner/name -label:bug' });
        const terminator = argv.indexOf('--');
        const repoIdx = argv.indexOf('--repo');
        expect(repoIdx).toBeGreaterThan(-1);
        expect(repoIdx).toBeLessThan(terminator);
        expect(argv[repoIdx + 1]).toBe('owner/name');
        expect(positionals(argv)).toStrictEqual(['-label:bug']);
      });

      /**
       * When the query is nothing but a liftable repo: term, the term moves
       * to --repo and the positional slot is left empty rather than being
       * filled with a stray blank term.
       *
       * @plan PLAN-20260828-ISSUE3407
       * @requirement AC-1
       * @issue 3407
       */
      it(`${name}: a query of only a repo: term becomes --repo with no positionals`, () => {
        const argv = build({ query: 'repo:vybestack/llxprt-code' });
        expect(positionals(argv)).toStrictEqual([]);
        expect(argv).not.toContain('');
        expect(argv).not.toContain('--');
        const idx = argv.indexOf('--repo');
        expect(idx).toBeGreaterThan(-1);
        expect(argv[idx + 1]).toBe('vybestack/llxprt-code');
      });
    }
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

    /**
     * gh is asked for ONE more row than the caller's limit, so a full page can
     * be distinguished from a complete result set; `windowByLimit` trims the
     * probe row and reports `hasMore`. Asserting the raw 30 here would pin the
     * ambiguity this fixes.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-6
     * @issue 3407
     */
    it('over-fetches one past the default limit of 30', () => {
      const argv = buildRunListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('31');
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

    /**
     * gh is asked for ONE more row than the caller's limit, so a full page can
     * be distinguished from a complete result set; `windowByLimit` trims the
     * probe row and reports `hasMore`. Asserting the raw 30 here would pin the
     * ambiguity this fixes.
     *
     * @plan PLAN-20260828-ISSUE3407
     * @requirement AC-6
     * @issue 3407
     */
    it('over-fetches one past the default limit of 30', () => {
      const argv = buildLabelListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('31');
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
    items.forEach((item) => {
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

/**
 * Issue #3407: a page plus a `hasMore` boolean answers "is there more" but
 * not "how many". Three different models evaluated against this tool all
 * invented the same workaround — split the query into date buckets and sum
 * them — spending roughly twenty calls on a question that is one call with a
 * total, and one of them still miscounted by hand.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-8
 * @issue 3407
 */
describe('issue #3407: search reports the size of the whole result set', () => {
  /** Builds `count` raw gh search rows. */
  function rawResults(count: number): unknown[] {
    return Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      title: `T${i}`,
      state: 'open',
      repository: { nameWithOwner: 'vybestack/llxprt-code' },
      author: { login: 'acoliver' },
      labels: [],
      assignees: [],
      updatedAt: '2026-08-01T00:00:00Z',
    }));
  }

  /**
   * Records every argv the op runs, so the test asserts on the real gh
   * invocations rather than on a mock's internal bookkeeping.
   */
  function recordingRunner(responses: readonly unknown[]): {
    run: GhRunner;
    argvs: string[][];
  } {
    const argvs: string[][] = [];
    let call = 0;
    const run: GhRunner = async (argv) => {
      argvs.push([...argv]);
      return responses[call++];
    };
    return { run, argvs };
  }

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('asks GitHub for the total only when the page is truncated', async () => {
    const { run, argvs } = recordingRunner([rawResults(31), '206\n']);
    const result = (await searchIssuesDescriptor.execute!(
      { query: 'is:open', repo: 'vybestack/llxprt-code' },
      run,
      new AbortController().signal,
    )) as { issues: readonly unknown[]; hasMore: boolean; totalCount: number };

    expect(result.issues).toHaveLength(30);
    expect(result.hasMore).toBe(true);
    expect(result.totalCount).toBe(206);

    // Second call is the count request, and it rebuilds the SAME query: the
    // lifted repo scope and the issue/PR discriminator go back into `q`.
    expect(argvs).toHaveLength(2);
    const q = argvs[1][argvs[1].indexOf('-f') + 1];
    expect(q).toBe('q=is:open repo:vybestack/llxprt-code type:issue');
    expect(argvs[1]).toContain('--jq');
    expect(argvs[1]).toContain('.total_count');
  });

  /**
   * A complete page already knows its own size, so paying for a second round
   * trip would be waste.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('uses the page length and makes no extra call when nothing is truncated', async () => {
    const { run, argvs } = recordingRunner([rawResults(4)]);
    const result = (await searchIssuesDescriptor.execute!(
      { query: 'is:open' },
      run,
      new AbortController().signal,
    )) as { issues: readonly unknown[]; hasMore: boolean; totalCount: number };

    expect(result.hasMore).toBe(false);
    expect(result.totalCount).toBe(4);
    expect(argvs).toHaveLength(1);
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('search.prs counts pull requests, not issues', async () => {
    const { run, argvs } = recordingRunner([rawResults(31), '68\n']);
    const result = (await searchPrsDescriptor.execute!(
      { query: 'is:open', repo: 'vybestack/llxprt-code' },
      run,
      new AbortController().signal,
    )) as { prs: readonly unknown[]; totalCount: number };

    expect(result.totalCount).toBe(68);
    expect(argvs[1][argvs[1].indexOf('-f') + 1]).toContain('type:pr');
  });

  /**
   * A non-numeric total means gh returned something unexpected; surfacing it
   * beats reporting a silently wrong count, which is the whole point here.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('rejects a non-numeric total rather than inventing a count', async () => {
    const { run } = recordingRunner([rawResults(31), 'not a number']);
    await expect(
      searchIssuesDescriptor.execute!(
        { query: 'is:open' },
        run,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/numeric total/);
  });

  /**
   * gh reports `OPEN` from `issue list` but `open` from `search issues`, so
   * the same issue looked like two different states depending on which op
   * returned it. Lower case is what the `state` parameter accepts.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-7
   * @issue 3407
   */
  it('normalises state to lower case across list and search', () => {
    const fromSearch = shapeSearchResults([
      { number: 1, title: 'T', state: 'open', updatedAt: '' },
    ]);
    const fromList = shapeIssueList([
      { number: 1, title: 'T', state: 'OPEN', labels: [], updatedAt: '' },
    ]);
    expect(fromSearch[0].state).toBe('open');
    expect(fromList[0].state).toBe(fromSearch[0].state);
  });

  /**
   * Answering "who filed each of these" cost one pr.view per row because the
   * list projection omitted the author that gh had all along.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-5
   * @issue 3407
   */
  it('search results and pr.list carry the author', () => {
    expect(
      buildSearchIssuesArgv({ query: 'x' })[
        buildSearchIssuesArgv({ query: 'x' }).indexOf('--json') + 1
      ],
    ).toContain('author');
    expect(
      buildPrListArgv({})[buildPrListArgv({}).indexOf('--json') + 1],
    ).toContain('author');
    expect(shapeSearchResults(rawResults(1))[0].author).toBe('acoliver');
  });
});
