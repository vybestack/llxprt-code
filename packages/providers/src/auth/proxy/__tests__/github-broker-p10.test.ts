/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P10 tests for the GitHub broker: issue.list, pr.list, pr.view, pr.diff,
 * pr.checks, pr.reviews, search.issues, search.prs, run.list, label.list.
 *
 * Pure buildArgv and shape functions have ungated unit tests so shaping
 * is validated in CI without network access. End-to-end tests against
 * real gh and real public data use the skipIf(skipNetwork) convention.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55, 101-126
 */

import { describe, it, expect } from 'bun:test';
import {
  buildIssueListArgv,
  shapeIssueList,
  validateIssueListParams,
  buildPrListArgv,
  shapePrList,
  validatePrListParams,
  buildPrViewArgv,
  shapePrView,
  validatePrViewParams,
  buildPrDiffArgv,
  shapePrDiff,
  validatePrDiffParams,
  buildPrChecksArgv,
  shapePrChecks,
  validatePrChecksParams,
  buildPrReviewsArgv,
  shapePrReviews,
  validatePrReviewsParams,
} from '../github-broker-ops.js';
import { OP_REGISTRY } from '../github-broker-ops.js';

/**
 * Asserts that every op descriptor in the registry has mutating=false and
 * accepts the repo parameter, as required by P10 constraints.
 *
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-009
 * @pseudocode 003-github-broker.md lines 38-55
 */
/**
 * The P10 read operations. Mutating operations were added in P11, so the
 * non-mutating assertion is scoped to this set rather than the whole
 * registry. Accepting `repo` remains a universal invariant (REQ-009).
 */
const P10_READ_OPS: readonly string[] = [
  'issue.view',
  'issue.list',
  'pr.list',
  'pr.view',
  'pr.diff',
  'pr.checks',
  'pr.reviews',
  'search.issues',
  'search.prs',
  'run.list',
  'label.list',
];

function labelFlagIndex(value: string, index: number): number {
  return value === '--label' ? index : -1;
}

// ─── Registry structure tests ────────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002
 * @pseudocode 003-github-broker.md lines 46-47
 */
describe('GitHub broker P10 op registry', () => {
  it('registers all P10 ops', () => {
    const expectedOps = [
      'issue.view',
      'issue.list',
      'pr.list',
      'pr.view',
      'pr.diff',
      'pr.checks',
      'pr.reviews',
      'search.issues',
      'search.prs',
      'run.list',
      'label.list',
    ];
    for (const opName of expectedOps) {
      expect(OP_REGISTRY[opName]).toBeDefined();
    }
  });

  it('all ops are non-mutating and accept repo', () => {
    for (const name of P10_READ_OPS) {
      const descriptor = OP_REGISTRY[name];
      expect(descriptor).toBeDefined();
      expect(descriptor.mutating).toBe(false);
    }
    for (const [, descriptor] of Object.entries(OP_REGISTRY)) {
      expect('repo' in descriptor.params).toBe(true);
    }
    expect(Object.keys(OP_REGISTRY).length).toBeGreaterThanOrEqual(11);
  });

  it('pr.diff descriptor has rawOutput=true', () => {
    expect(OP_REGISTRY['pr.diff'].rawOutput).toBe(true);
  });

  it('pr.checks descriptor has tolerateNonZeroExit=true', () => {
    expect(OP_REGISTRY['pr.checks'].tolerateNonZeroExit).toBe(true);
  });

  it('pr.reviews descriptor has usesGraphql=true', () => {
    expect(OP_REGISTRY['pr.reviews'].usesGraphql).toBe(true);
  });
});

// ─── issue.list pure-function tests ──────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
describe('issue.list pure functions (P10)', () => {
  describe('buildIssueListArgv', () => {
    it('builds argv with issue list and json fields without body', () => {
      const argv = buildIssueListArgv({});
      expect(argv[0]).toBe('issue');
      expect(argv[1]).toBe('list');
      const jsonIdx = argv.indexOf('--json');
      const fields = argv[jsonIdx + 1];
      expect(fields).toContain('number');
      expect(fields).toContain('title');
      expect(fields).toContain('state');
      expect(fields).toContain('labels');
      expect(fields).toContain('updatedAt');
      expect(fields).not.toContain('body');
    });

    it('includes --search when provided', () => {
      const argv = buildIssueListArgv({ search: 'bug report' });
      const idx = argv.indexOf('--search');
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe('bug report');
    });

    it('includes --state when provided', () => {
      const argv = buildIssueListArgv({ state: 'closed' });
      const idx = argv.indexOf('--state');
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe('closed');
    });

    it('includes --label for each label when array provided', () => {
      const argv = buildIssueListArgv({ label: ['bug', 'enhancement'] });
      const indices = argv.map(labelFlagIndex).filter((i) => i >= 0);
      expect(indices.length).toBe(2);
      expect(argv[indices[0] + 1]).toBe('bug');
      expect(argv[indices[1] + 1]).toBe('enhancement');
    });

    it('includes --label for single string label', () => {
      const argv = buildIssueListArgv({ label: 'bug' });
      const idx = argv.indexOf('--label');
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe('bug');
    });

    it('defaults limit to 30', () => {
      const argv = buildIssueListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('30');
    });

    it('honours explicit limit', () => {
      const argv = buildIssueListArgv({ limit: 50 });
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('50');
    });

    it('appends --repo when provided', () => {
      const argv = buildIssueListArgv({ repo: 'vybestack/llxprt-code' });
      const idx = argv.indexOf('--repo');
      expect(idx).toBeGreaterThan(-1);
      expect(argv[idx + 1]).toBe('vybestack/llxprt-code');
    });

    it('omits --repo when not provided', () => {
      const argv = buildIssueListArgv({});
      expect(argv).not.toContain('--repo');
    });
  });

  describe('validateIssueListParams', () => {
    it('accepts empty params', () => {
      expect(validateIssueListParams({})).toBeNull();
    });

    it('accepts valid params', () => {
      expect(
        validateIssueListParams({
          search: 'test',
          state: 'open',
          label: 'bug',
          limit: 10,
          repo: 'owner/repo',
        }),
      ).toBeNull();
    });

    it('rejects limit above 100', () => {
      const result = validateIssueListParams({ limit: 101 });
      expect(result?.code).toBe('INVALID_PARAM');
      expect(result?.message).toContain('100');
    });

    it('accepts limit at exactly 100', () => {
      expect(validateIssueListParams({ limit: 100 })).toBeNull();
    });

    it('rejects invalid issue state', () => {
      const result = validateIssueListParams({ state: 'merged' });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('accepts open, closed, all for issue state', () => {
      expect(validateIssueListParams({ state: 'open' })).toBeNull();
      expect(validateIssueListParams({ state: 'closed' })).toBeNull();
      expect(validateIssueListParams({ state: 'all' })).toBeNull();
    });

    it('rejects unknown parameter', () => {
      const result = validateIssueListParams({ bogus: true });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed search value', () => {
      const result = validateIssueListParams({ search: '--malicious' });
      expect(result?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed repo value', () => {
      const result = validateIssueListParams({ repo: '--malicious' });
      expect(result?.code).toBe('INVALID_PARAM');
    });
  });

  describe('shapeIssueList', () => {
    it('shapes an array of issues excluding bodies', () => {
      const raw = [
        {
          number: 1,
          title: 'First',
          state: 'OPEN',
          labels: [{ name: 'bug' }],
          updatedAt: '2026-01-01T00:00:00Z',
          body: 'should not appear',
        },
        {
          number: 2,
          title: 'Second',
          state: 'CLOSED',
          labels: [],
          updatedAt: '2026-01-02T00:00:00Z',
          body: 'also should not appear',
        },
      ];
      const shaped = shapeIssueList(raw);
      expect(shaped.length).toBe(2);
      expect(shaped[0].number).toBe(1);
      expect(shaped[0].title).toBe('First');
      expect(shaped[0].state).toBe('OPEN');
      expect(shaped[0].labels).toStrictEqual(['bug']);
      expect(shaped[0].updatedAt).toBe('2026-01-01T00:00:00Z');
      // Body must NOT be a field on the shaped output
      expect(shaped[0]).not.toHaveProperty('body');
    });

    /**
     * A non-array response means gh returned something unexpected — an auth
     * failure, a CLI error, a changed payload. Returning [] made all of
     * those indistinguishable from "no results", which is the worst
     * available reading, so it now surfaces instead.
     *
     * @plan PLAN-20260731-GHBROKER.P19
     * @requirement REQ-013
     */
    it('fails loudly for non-array input rather than reporting no results', () => {
      expect(() => shapeIssueList(null)).toThrow(/expected a list/);
      expect(() => shapeIssueList({})).toThrow(/expected a list/);
    });

    it('handles missing fields defensively', () => {
      const shaped = shapeIssueList([{}]);
      expect(shaped[0].number).toBe(0);
      expect(shaped[0].title).toBe('');
    });
  });
});

// ─── pr.list pure-function tests ─────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 46-55, 120-123
 */
describe('pr.list pure functions (P10)', () => {
  describe('buildPrListArgv', () => {
    it('builds argv with pr list and json fields without body', () => {
      const argv = buildPrListArgv({});
      expect(argv[0]).toBe('pr');
      expect(argv[1]).toBe('list');
      const jsonIdx = argv.indexOf('--json');
      const fields = argv[jsonIdx + 1];
      expect(fields).not.toContain('body');
    });

    it('includes --state when provided', () => {
      const argv = buildPrListArgv({ state: 'merged' });
      const idx = argv.indexOf('--state');
      expect(argv[idx + 1]).toBe('merged');
    });

    it('defaults limit to 30', () => {
      const argv = buildPrListArgv({});
      const idx = argv.indexOf('--limit');
      expect(argv[idx + 1]).toBe('30');
    });

    it('appends --repo when provided', () => {
      const argv = buildPrListArgv({ repo: 'vybestack/llxprt-code' });
      expect(argv).toContain('--repo');
    });
  });

  describe('validatePrListParams', () => {
    it('rejects limit above 100', () => {
      expect(validatePrListParams({ limit: 200 })?.code).toBe('INVALID_PARAM');
    });

    it('accepts merged state (PRs can merge)', () => {
      expect(validatePrListParams({ state: 'merged' })).toBeNull();
    });

    it('rejects dash-prefixed repo', () => {
      expect(validatePrListParams({ repo: '-foo/bar' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapePrList', () => {
    it('shapes PRs excluding bodies', () => {
      const raw = [
        {
          number: 10,
          title: 'PR One',
          state: 'OPEN',
          labels: [],
          updatedAt: '2026-01-01T00:00:00Z',
          body: 'secret body',
        },
      ];
      const shaped = shapePrList(raw);
      expect(shaped[0].number).toBe(10);
      expect(shaped[0]).not.toHaveProperty('body');
    });
  });
});

// ─── pr.view pure-function tests ─────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 101-103
 */
describe('pr.view pure functions (P10)', () => {
  describe('buildPrViewArgv', () => {
    it('includes PR-specific fields without comments by default', () => {
      const argv = buildPrViewArgv({ number: 42 }, false);
      const jsonIdx = argv.indexOf('--json');
      const fields = argv[jsonIdx + 1];
      expect(fields).toContain('isDraft');
      expect(fields).toContain('reviewDecision');
      expect(fields).toContain('headRefName');
      expect(fields).toContain('baseRefName');
      expect(fields).not.toContain('comments');
    });

    it('includes comments when comments=true', () => {
      const argv = buildPrViewArgv({ number: 42 }, true);
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).toContain('comments');
    });

    it('appends --repo when provided', () => {
      const argv = buildPrViewArgv({ number: 42, repo: 'o/r' }, false);
      expect(argv).toContain('--repo');
    });
  });

  describe('validatePrViewParams', () => {
    it('requires number', () => {
      expect(validatePrViewParams({})?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed repo', () => {
      expect(validatePrViewParams({ number: 1, repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapePrView', () => {
    it('shapes raw JSON with PR-specific fields', () => {
      const raw = {
        number: 42,
        title: 'Fix bug',
        state: 'OPEN',
        author: { login: 'dev' },
        labels: [{ name: 'bug' }],
        body: 'body text',
        isDraft: true,
        reviewDecision: 'APPROVED',
        headRefName: 'feature',
        baseRefName: 'main',
      };
      const shaped = shapePrView(raw);
      expect(shaped.number).toBe(42);
      expect(shaped.isDraft).toBe(true);
      expect(shaped.reviewDecision).toBe('APPROVED');
      expect(shaped.headRefName).toBe('feature');
      expect(shaped.baseRefName).toBe('main');
      expect(shaped.comments).toBeNull();
    });
  });
});

// ─── pr.diff pure-function tests ─────────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 125-126
 */
describe('pr.diff pure functions (P10)', () => {
  describe('buildPrDiffArgv', () => {
    it('builds argv with pr diff and number', () => {
      const argv = buildPrDiffArgv({ number: 42 });
      expect(argv[0]).toBe('pr');
      expect(argv[1]).toBe('diff');
      expect(argv).toContain('42');
      // No --json for diff since it returns text
      expect(argv).not.toContain('--json');
    });

    it('appends --repo when provided', () => {
      const argv = buildPrDiffArgv({ number: 42, repo: 'o/r' });
      expect(argv).toContain('--repo');
    });
  });

  describe('validatePrDiffParams', () => {
    it('requires number', () => {
      expect(validatePrDiffParams({})?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed repo', () => {
      expect(validatePrDiffParams({ number: 1, repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapePrDiff', () => {
    it('returns diff text unchanged when under limit', () => {
      const shortDiff = 'diff --git a/file b/file\n+hello\n';
      const shaped = shapePrDiff(shortDiff);
      expect(shaped.diff).toBe(shortDiff);
      expect(shaped.truncated).toBeNull();
    });

    it('truncates oversized diff with a marker', () => {
      const bigDiff = 'x'.repeat(70 * 1024);
      const shaped = shapePrDiff(bigDiff);
      expect(Buffer.byteLength(shaped.diff, 'utf8')).toBeLessThanOrEqual(
        64 * 1024,
      );
      expect(shaped.diff).toContain('truncated');
      expect(shaped.truncated).not.toBeNull();
      expect(shaped.truncated?.field).toBe('diff');
      expect(shaped.truncated?.originalBytes).toBeGreaterThan(64 * 1024);
    });

    it('handles empty input', () => {
      const shaped = shapePrDiff('');
      expect(shaped.diff).toBe('');
      expect(shaped.truncated).toBeNull();
    });
  });
});

// ─── pr.checks pure-function tests ───────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 105-109
 */
describe('pr.checks pure functions (P10)', () => {
  describe('buildPrChecksArgv', () => {
    it('builds argv with pr checks and bucket json fields', () => {
      const argv = buildPrChecksArgv({ number: 42 });
      expect(argv[0]).toBe('pr');
      expect(argv[1]).toBe('checks');
      expect(argv).toContain('42');
      const jsonIdx = argv.indexOf('--json');
      expect(argv[jsonIdx + 1]).toContain('bucket');
      expect(argv[jsonIdx + 1]).toContain('name');
      expect(argv[jsonIdx + 1]).toContain('state');
      expect(argv[jsonIdx + 1]).toContain('link');
    });

    it('appends --repo when provided', () => {
      const argv = buildPrChecksArgv({ number: 42, repo: 'o/r' });
      expect(argv).toContain('--repo');
    });
  });

  describe('validatePrChecksParams', () => {
    it('requires number', () => {
      expect(validatePrChecksParams({})?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed repo', () => {
      expect(validatePrChecksParams({ number: 1, repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });
  });

  describe('shapePrChecks', () => {
    it('counts checks by bucket field', () => {
      const raw = [
        { name: 'CI', state: 'SUCCESS', bucket: 'pass', link: 'http://a' },
        { name: 'Lint', state: 'FAILURE', bucket: 'fail', link: 'http://b' },
        {
          name: 'Deploy',
          state: 'PENDING',
          bucket: 'pending',
          link: 'http://c',
        },
        {
          name: 'Skip',
          state: 'SKIPPED',
          bucket: 'skipping',
          link: 'http://d',
        },
        { name: 'CI2', state: 'SUCCESS', bucket: 'pass', link: 'http://e' },
      ];
      const shaped = shapePrChecks(raw);
      expect(shaped.checks.length).toBe(5);
      expect(shaped.summary.pass).toBe(2);
      expect(shaped.summary.fail).toBe(1);
      expect(shaped.summary.pending).toBe(1);
      expect(shaped.summary.skipping).toBe(1);
    });

    it('does NOT re-derive bucket from state string', () => {
      // Even if state is "SUCCESS", if bucket is "fail", it counts as fail
      const raw = [
        { name: 'Weird', state: 'SUCCESS', bucket: 'fail', link: '' },
      ];
      const shaped = shapePrChecks(raw);
      expect(shaped.summary.fail).toBe(1);
      expect(shaped.summary.pass).toBe(0);
    });

    it('handles empty input', () => {
      const shaped = shapePrChecks([]);
      expect(shaped.checks).toStrictEqual([]);
      expect(shaped.summary.pass).toBe(0);
      expect(shaped.summary.fail).toBe(0);
    });
  });
});

// ─── pr.reviews pure-function tests ──────────────────────────────────────────

/**
 * @plan PLAN-20260731-GHBROKER.P10
 * @requirement REQ-002, REQ-013
 * @pseudocode 003-github-broker.md lines 111-118
 */
describe('pr.reviews pure functions (P10)', () => {
  describe('buildPrReviewsArgv', () => {
    it('builds argv with api graphql', () => {
      const argv = buildPrReviewsArgv({
        number: 42,
        repo: 'vybestack/llxprt-code',
      });
      expect(argv[0]).toBe('api');
      expect(argv[1]).toBe('graphql');
      const queryIdx = argv.indexOf('-f');
      expect(queryIdx).toBeGreaterThan(-1);
      expect(argv[queryIdx + 1]).toContain('query=');
    });

    it('includes owner and name from repo param', () => {
      const argv = buildPrReviewsArgv({
        number: 42,
        repo: 'vybestack/llxprt-code',
      });
      const fIdx = argv.indexOf('-F');
      expect(fIdx).toBeGreaterThan(-1);
      const combined = argv.join(' ');
      expect(combined).toContain('owner=vybestack');
      expect(combined).toContain('name=llxprt-code');
    });
  });

  describe('validatePrReviewsParams', () => {
    it('requires number', () => {
      expect(validatePrReviewsParams({})?.code).toBe('INVALID_PARAM');
    });

    it('rejects dash-prefixed repo', () => {
      expect(validatePrReviewsParams({ number: 1, repo: '-x/y' })?.code).toBe(
        'INVALID_PARAM',
      );
    });

    it('accepts actionable boolean', () => {
      expect(
        validatePrReviewsParams({ number: 1, actionable: true }),
      ).toBeNull();
    });
  });

  describe('shapePrReviews', () => {
    const sampleResponse = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_kw1',
                  isResolved: false,
                  isOutdated: false,
                  path: 'src/index.ts',
                  line: 10,
                  viewerCanResolve: true,
                  comments: {
                    nodes: [
                      { author: { login: 'reviewer1' }, body: 'Fix this' },
                    ],
                  },
                },
                {
                  id: 'PRRT_kw2',
                  isResolved: true,
                  isOutdated: false,
                  path: 'src/util.ts',
                  line: 20,
                  viewerCanResolve: false,
                  comments: {
                    nodes: [{ author: { login: 'reviewer2' }, body: 'Done' }],
                  },
                },
                {
                  id: 'PRRT_kw3',
                  isResolved: false,
                  isOutdated: true,
                  path: 'src/old.ts',
                  line: 5,
                  viewerCanResolve: false,
                  comments: {
                    nodes: [
                      { author: { login: 'reviewer3' }, body: 'Old comment' },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    };

    it('includes all threads when actionable=false', () => {
      const shaped = shapePrReviews(sampleResponse, false);
      expect(shaped.threads.length).toBe(3);
      expect(shaped.truncated).toBe(false);
    });

    it('excludes resolved and outdated threads when actionable=true', () => {
      const shaped = shapePrReviews(sampleResponse, true);
      expect(shaped.threads.length).toBe(1);
      expect(shaped.threads[0].id).toBe('PRRT_kw1');
      expect(shaped.threads[0].isResolved).toBe(false);
      expect(shaped.threads[0].isOutdated).toBe(false);
    });

    it('shapes thread comments with author and body', () => {
      const shaped = shapePrReviews(sampleResponse, false);
      const thread = shaped.threads[0];
      expect(thread.comments.length).toBe(1);
      expect(thread.comments[0].author).toBe('reviewer1');
      expect(thread.comments[0].body).toBe('Fix this');
    });

    it('shapes thread path, line, viewerCanResolve', () => {
      const shaped = shapePrReviews(sampleResponse, false);
      const thread = shaped.threads[0];
      expect(thread.path).toBe('src/index.ts');
      expect(thread.line).toBe(10);
      expect(thread.viewerCanResolve).toBe(true);
    });

    it('handles empty/null response gracefully', () => {
      expect(shapePrReviews(null, false).threads).toStrictEqual([]);
      expect(shapePrReviews({}, false).threads).toStrictEqual([]);
    });
  });
});
