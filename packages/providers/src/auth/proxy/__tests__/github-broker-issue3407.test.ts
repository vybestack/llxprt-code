/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent-experience regressions for issue #3407.
 *
 * Split out of github-broker-p10b.test.ts, which hit the 800-line cap. These
 * cover the behaviours three separate model evaluations identified as the
 * difference between a tool an agent can use and one it works around:
 * knowing how many results exist, being able to see which query actually ran,
 * and getting the same field values for the same object regardless of which
 * operation returned it.
 *
 * @plan PLAN-20260828-ISSUE3407
 * @requirement AC-5, AC-7, AC-8, AC-9
 * @issue 3407
 */

import { describe, it, expect } from 'bun:test';
import type { GhRunner } from '../github-broker-types.js';
import {
  buildSearchIssuesArgv,
  buildSearchCountQuery,
  searchIssuesDescriptor,
  searchPrsDescriptor,
  shapeSearchResults,
} from '../github-broker-search-ops.js';
import {
  buildIssueListCountQuery,
  issueListDescriptor,
  shapeIssueList,
} from '../github-broker-issue-ops.js';
import {
  buildPrListArgv,
  buildPrListCountQuery,
} from '../github-broker-pr-ops.js';

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
   * The count query is assembled by hand, so it must re-quote a multi-word
   * qualifier value that gh would have quoted for the page request. Joined
   * unquoted, `label:help wanted` reads to the API as `label:help` plus the
   * freetext `wanted`: measured against cli/cli it matched 0 issues where the
   * page returned 2, so a truncated page would have reported totalCount 0.
   *
   * This is the exact inverse of the argv rule, where quoting is forbidden
   * because gh does it. Both rules are pinned so neither can be "corrected"
   * into the other.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('re-quotes multi-word qualifier values in the count query only', () => {
    const params = { query: 'is:open label:"help wanted"', repo: 'cli/cli' };
    expect(buildSearchCountQuery(params, 'issue')).toBe(
      'is:open label:"help wanted" repo:cli/cli type:issue',
    );
    // ...while the argv the page request uses stays unquoted.
    const argv = buildSearchIssuesArgv(params);
    expect(argv.slice(argv.indexOf('--') + 1)).toStrictEqual([
      'is:open',
      'label:help wanted',
    ]);
    expect(argv.some((a) => a.includes('"'))).toBe(false);
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('quotes a multi-word freetext keyword whole in the count query', () => {
    expect(
      buildSearchCountQuery({ query: '"sandbox proxy" is:open' }, 'issue'),
    ).toBe('"sandbox proxy" is:open type:issue');
  });

  /**
   * An exclusion keeps its leading dash outside the quotes so it is still
   * parsed as a negated qualifier.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('keeps an excluded qualifier negated when re-quoting', () => {
    expect(
      buildSearchCountQuery({ query: '-label:"help wanted"' }, 'issue'),
    ).toBe('-label:"help wanted" type:issue');
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
  /**
   * issue.list is the operation an agent reaches for when counting, because
   * it is the one that filters richly and returns `milestone`. Leaving the
   * total to search.issues alone meant "how many issues are on milestone X"
   * needed two operations; every evaluated model raised it.
   *
   * The filter-to-query mapping was checked against live counts rather than
   * assumed: label, no:assignee and milestone: filters each produced identical
   * numbers from gh issue list and the search API.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('issue.list reports a total and echoes the query it counted', async () => {
    const rows = Array.from({ length: 31 }, (_, i) => ({
      number: i + 1,
      title: `T${i}`,
      state: 'OPEN',
      author: { login: 'acoliver' },
      labels: [],
      updatedAt: '',
      assignees: [],
      milestone: null,
    }));
    const { run, argvs } = recordingRunner([rows, '141\n']);
    const result = (await issueListDescriptor.execute!(
      {
        state: 'open',
        search: 'milestone:0.12.0',
        label: ['Tooling'],
        repo: 'vybestack/llxprt-code',
      },
      run,
      new AbortController().signal,
    )) as Record<string, unknown>;

    expect(result.totalCount).toBe(141);
    expect(result.hasMore).toBe(true);
    expect(result.effectiveQuery).toBe(
      'milestone:0.12.0 is:open label:Tooling repo:vybestack/llxprt-code type:issue',
    );
    expect(argvs[1][argvs[1].indexOf('-f') + 1]).toBe(
      `q=${String(result.effectiveQuery)}`,
    );
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('issue.list omits the state qualifier for state:all', () => {
    expect(buildIssueListCountQuery({ state: 'all' })).toBe('type:issue');
    // ...and defaults to open, matching gh's own default.
    expect(buildIssueListCountQuery({})).toBe('is:open type:issue');
  });

  /**
   * `gh pr list --state closed` returns merged pull requests too, and
   * search's `is:closed` includes them, so the count describes the same rows.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('pr.list counts closed as including merged, matching gh', () => {
    expect(buildPrListCountQuery({ state: 'closed', repo: 'o/n' })).toBe(
      'is:closed repo:o/n type:pr',
    );
    expect(buildPrListCountQuery({ state: 'merged', repo: 'o/n' })).toBe(
      'is:merged repo:o/n type:pr',
    );
    expect(buildPrListCountQuery({ state: 'all' })).toBe('type:pr');
  });

  /**
   * A multi-word label has to be quoted in the hand-assembled count query for
   * the same reason it does in search: unquoted, the API reads it as a short
   * qualifier plus stray freetext.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('quotes a multi-word label in the issue.list count query', () => {
    expect(buildIssueListCountQuery({ label: ['help wanted'] })).toBe(
      'is:open label:"help wanted" type:issue',
    );
  });

  /**
   * `-label:bug` against a repository with no `bug` label excludes nothing and
   * returns the unfiltered total, which is indistinguishable from the filter
   * having been dropped. All three evaluated models flagged that. Echoing the
   * query that actually ran lets a caller confirm the term survived, and
   * exposes the `type:issue` that gh appends invisibly.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-9
   * @issue 3407
   */
  it('search echoes the effective query including exclusions and the type filter', async () => {
    const { run } = recordingRunner([rawResults(2)]);
    const result = (await searchIssuesDescriptor.execute!(
      { query: 'is:open -label:bug', repo: 'vybestack/llxprt-code' },
      run,
      new AbortController().signal,
    )) as Record<string, unknown>;
    expect(result.effectiveQuery).toBe(
      'is:open -label:bug repo:vybestack/llxprt-code type:issue',
    );
  });

  it('normalises a bot author to one name across list and search', () => {
    // gh reports the same bot as `app/cursor` from issue list and
    // `cursor[bot]` from search, so equality checks across ops failed.
    const fromList = shapeIssueList([
      {
        number: 3403,
        title: 'T',
        state: 'OPEN',
        author: { login: 'app/cursor', is_bot: true },
        labels: [],
        updatedAt: '',
      },
    ]);
    const fromSearch = shapeSearchResults([
      {
        number: 3403,
        title: 'T',
        state: 'open',
        author: { login: 'cursor[bot]', type: 'Bot' },
        updatedAt: '',
      },
    ]);
    expect(fromList[0].author).toBe('cursor[bot]');
    expect(fromList[0].author).toBe(fromSearch[0].author);
    // A human login is untouched.
    expect(
      shapeSearchResults([{ number: 1, author: { login: 'acoliver' } }])[0]
        .author,
    ).toBe('acoliver');
  });

  /**
   * A size-truncated response is cut from the end, so the total has to lead
   * the object or it is the first thing lost — which is precisely the failure
   * returning a total exists to prevent.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-8
   * @issue 3407
   */
  it('puts hasMore and totalCount before the items array', async () => {
    const { run } = recordingRunner([rawResults(31), '206\n']);
    const result = (await searchIssuesDescriptor.execute!(
      { query: 'is:open' },
      run,
      new AbortController().signal,
    )) as Record<string, unknown>;
    expect(Object.keys(result).slice(0, 2)).toStrictEqual([
      'hasMore',
      'totalCount',
    ]);
  });

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
