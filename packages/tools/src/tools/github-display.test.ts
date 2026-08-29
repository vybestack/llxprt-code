/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the github result renderer (issue #3030).
 *
 * The transcript must show a human summary, not a JSON dump. These tests
 * assert on the rendered strings only — no internal helper call counts, no
 * stubbing of the renderer.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-013
 */

import { describe, it, expect } from 'bun:test';
import { renderGithubResult, renderChecks } from './github-display.js';

describe('github result rendering', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.comment renders a human line and the url with no JSON punctuation', () => {
    const out = renderGithubResult(
      'issue.comment',
      { number: 438 },
      { url: 'https://github.com/o/r/issues/438#issuecomment-1' },
    );
    expect(out).toContain('Commented on issue #438');
    expect(out).toContain('https://github.com/o/r/issues/438#issuecomment-1');
    expect(out).not.toContain('{');
    expect(out).not.toContain('"url"');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.create renders the created number and the url', () => {
    const out = renderGithubResult(
      'issue.create',
      { title: 'T' },
      { url: 'https://github.com/o/r/issues/123', number: 123 },
    );
    expect(out).toContain('Created issue #123');
    expect(out).toContain('https://github.com/o/r/issues/123');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.close renders a closed line', () => {
    const out = renderGithubResult(
      'issue.close',
      { number: 438 },
      { number: 438, state: 'closed' },
    );
    expect(out).toContain('Closed issue #438');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.view puts number, state and title on the first line', () => {
    const out = renderGithubResult(
      'issue.view',
      { number: 1663 },
      {
        number: 1663,
        title: 'Bug here',
        state: 'open',
        author: 'alice',
        labels: ['bug'],
        comments: [{ author: 'bob', body: 'hi' }],
      },
    );
    const firstLine = out.split('\n')[0];
    expect(firstLine).toContain('1663');
    expect(firstLine).toContain('open');
    expect(firstLine).toContain('Bug here');
  });

  /**
   * Issue #3407: assignment state was invisible in the transcript even once
   * the shaped contract carried it, so a human reading the render could not
   * see who an issue was assigned to or which milestone it belonged to.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-5
   * @issue 3407
   */
  it('issue.view renders assignees and milestone when present', () => {
    const out = renderGithubResult(
      'issue.view',
      { number: 3345 },
      {
        number: 3345,
        title: 'Assigned and milestoned',
        state: 'open',
        author: 'alice',
        labels: ['bug'],
        assignees: ['acoliver'],
        milestone: '0.12.0',
        comments: null,
      },
    );
    expect(out).toContain('acoliver');
    expect(out).toContain('0.12.0');
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-5
   * @issue 3407
   */
  it('issue.view omits the assignee and milestone lines when unset', () => {
    const out = renderGithubResult(
      'issue.view',
      { number: 3407 },
      {
        number: 3407,
        title: 'Unassigned',
        state: 'open',
        author: 'alice',
        labels: [],
        assignees: [],
        milestone: null,
        comments: null,
      },
    );
    expect(out).not.toContain('assignees:');
    expect(out).not.toContain('milestone:');
  });

  /**
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-5
   * @issue 3407
   */
  it('issue.list surfaces assignee and milestone on each item line', () => {
    const out = renderGithubResult(
      'issue.list',
      {},
      {
        issues: [
          {
            number: 1,
            title: 'Assigned',
            state: 'open',
            labels: [],
            updatedAt: '',
            assignees: ['acoliver'],
            milestone: '0.12.0',
          },
          {
            number: 2,
            title: 'Bare',
            state: 'open',
            labels: [],
            updatedAt: '',
            assignees: [],
            milestone: null,
          },
        ],
      },
    );
    const lines = out.split('\n').filter((l) => l.startsWith('#'));
    expect(lines[0]).toContain('acoliver');
    expect(lines[0]).toContain('0.12.0');
    // An item with neither field keeps the plain "#N state  title" form.
    expect(lines[1]).toBe('#2 open  Bare');
  });

  /**
   * pr.list has neither field, so its line format must be untouched by the
   * issue-3407 suffix.
   *
   * @plan PLAN-20260828-ISSUE3407
   * @requirement AC-5
   * @issue 3407
   */
  it('pr.list item lines are unaffected by the issue.list suffix', () => {
    const out = renderGithubResult(
      'pr.list',
      {},
      {
        prs: [{ number: 7, title: 'A PR', state: 'open', updatedAt: '' }],
      },
    );
    const lines = out.split('\n').filter((l) => l.startsWith('#'));
    expect(lines[0]).toBe('#7 open  A PR');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.view renders head → base and the draft marker', () => {
    const out = renderGithubResult(
      'pr.view',
      { number: 2317 },
      {
        number: 2317,
        title: 'PR',
        state: 'open',
        isDraft: true,
        headRefName: 'feat',
        baseRefName: 'main',
        reviewDecision: '',
        comments: null,
      },
    );
    expect(out).toContain('feat → main');
    expect(out).toContain('draft');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.list renders the count, ten lines and a more tail', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      number: i + 1,
      title: `T${i}`,
      state: 'open',
      labels: [],
      updatedAt: '',
    }));
    const out = renderGithubResult('issue.list', {}, { issues: items });
    expect(out).toContain('25 issues');
    expect(out).toContain('… and 15 more');
    const itemLines = out.split('\n').filter((l) => l.startsWith('#'));
    expect(itemLines).toHaveLength(10);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.reviews renders one line per thread with path and author', () => {
    const out = renderGithubResult(
      'pr.reviews',
      { number: 1 },
      {
        threads: [
          {
            id: 't1',
            path: 'src/a.ts',
            line: 10,
            isResolved: false,
            isOutdated: false,
            viewerCanResolve: true,
            comments: [{ author: 'alice', body: 'fix this' }],
          },
        ],
        truncated: false,
      },
    );
    expect(out).toContain('1 review thread');
    expect(out).toContain('src/a.ts:10');
    expect(out).toContain('alice');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.diff renders the line count and notes truncation when present', () => {
    const diff = 'a\nb\nc';
    const ok = renderGithubResult(
      'pr.diff',
      { number: 2317 },
      { diff, truncated: null },
    );
    expect(ok).toContain('Diff for PR #2317');
    expect(ok).toContain('3 lines');
    expect(ok).not.toContain('truncated');

    const truncated = renderGithubResult(
      'pr.diff',
      { number: 2317 },
      { diff, truncated: { field: 'diff', originalBytes: 70000 } },
    );
    expect(truncated).toContain('truncated at 70000 bytes');

    // `truncated` is a boolean on pr.reviews and a record on pr.diff, so the
    // note must read both shapes rather than the one its own op happens to
    // produce today.
    const booleanShape = renderGithubResult(
      'pr.diff',
      { number: 2317 },
      { diff, truncated: true },
    );
    expect(booleanShape).toContain('(truncated)');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('renders a non-empty line for missing or oddly-typed fields without throwing', () => {
    const sparse = renderGithubResult('issue.view', { number: 1 }, {});
    expect(sparse.length).toBeGreaterThan(0);
    const odd = renderGithubResult(
      'issue.view',
      { number: 1 },
      { number: 'x', title: 123, state: true },
    );
    expect(odd.length).toBeGreaterThan(0);
    // No raw JSON fallback.
    expect(odd).not.toContain('{');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P14
   * @requirement REQ-011
   */
  it('renderChecks behaviour is unchanged (no checks reported)', () => {
    expect(renderChecks({ checks: [] })).toBe('No checks reported.');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('an explicit repo appears in the rendered line', () => {
    const out = renderGithubResult(
      'issue.close',
      { number: 1, repo: 'o/n' },
      { number: 1, state: 'closed' },
    );
    expect(out).toContain('o/n');
  });

  /**
   * The renderer must show the content the user asked for, not delete it.
   * A pr.diff call must include the actual diff text.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.diff renders the actual diff text after the header', () => {
    const diff = 'diff --git a/x b/x\n+added line\n-removed line';
    const out = renderGithubResult('pr.diff', { number: 5 }, { diff });
    expect(out).toContain('Diff for PR #5');
    expect(out).toContain('+added line');
    expect(out).toContain('-removed line');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.diff caps at 200 lines and shows a more-tail', () => {
    const diff = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const out = renderGithubResult('pr.diff', { number: 5 }, { diff });
    expect(out).toContain('more lines');
    expect(out).not.toContain('line 300');
  });

  /**
   * The issue body and comment bodies must be visible, not reduced to a
   * count.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.view renders the body and each comment body', () => {
    const out = renderGithubResult(
      'issue.view',
      { number: 1 },
      {
        number: 1,
        title: 'T',
        state: 'open',
        author: 'alice',
        body: 'This is the issue body text.',
        comments: [{ author: 'bob', body: 'A comment body here.' }],
      },
    );
    expect(out).toContain('This is the issue body text.');
    expect(out).toContain('A comment body here.');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('issue.view caps a very long body and shows a more-tail', () => {
    const body = Array.from({ length: 200 }, (_, i) => `body ${i}`).join('\n');
    const out = renderGithubResult(
      'issue.view',
      { number: 1 },
      { number: 1, title: 'T', state: 'open', body },
    );
    expect(out).toContain('more lines');
    expect(out).not.toContain('body 150');
  });

  /**
   * pr.reviews must show every comment in a thread, not just the first.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.reviews renders the body of a second comment in a thread', () => {
    const out = renderGithubResult(
      'pr.reviews',
      { number: 1 },
      {
        threads: [
          {
            path: 'src/a.ts',
            line: 10,
            comments: [
              { author: 'alice', body: 'first comment' },
              { author: 'bob', body: 'reply body text' },
            ],
          },
        ],
      },
    );
    expect(out).toContain('first comment');
    expect(out).toContain('reply body text');
  });

  /**
   * The upstream query fetches up to 100 comments per thread, so a single
   * thread must not be allowed to swallow the pane. Comments are capped per
   * thread the way the view renderer caps an issue's comment list, and a tail
   * names what was cut.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.reviews caps comments per thread and shows a more-comments tail', () => {
    const comments = Array.from({ length: 50 }, (_, i) => ({
      author: `user${i}`,
      body: `comment ${i}`,
    }));
    const out = renderGithubResult(
      'pr.reviews',
      { number: 1 },
      {
        threads: [{ path: 'src/a.ts', line: 10, comments }],
        truncated: false,
      },
    );
    // The cap is MAX_VIEW_COMMENTS (3): the 4th comment body must not appear.
    expect(out).toContain('comment 0');
    expect(out).toContain('comment 1');
    expect(out).toContain('comment 2');
    expect(out).not.toContain('comment 3');
    expect(out).toContain('… and 47 more comments');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.view renders the body text', () => {
    const out = renderGithubResult(
      'pr.view',
      { number: 1 },
      {
        number: 1,
        title: 'T',
        state: 'open',
        headRefName: 'f',
        baseRefName: 'm',
        body: 'The PR description.',
      },
    );
    expect(out).toContain('The PR description.');
  });

  /**
   * A non-watch pr.checks result has no watch status fields, so it must
   * render the counts with a neutral header and never say "timed out".
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('pr.checks non-watch renders counts and never says timed out', () => {
    const out = renderGithubResult(
      'pr.checks',
      { number: 1 },
      {
        checks: [
          { name: 'a', bucket: 'pass' },
          { name: 'b', bucket: 'fail' },
        ],
        summary: { pass: 1, fail: 1, pending: 0, skipping: 0 },
      },
    );
    expect(out).toContain('1 pass');
    expect(out).toContain('1 fail');
    expect(out).not.toContain('timed out');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P14
   * @requirement REQ-011
   */
  it('renderChecks with a concluded watch still renders complete', () => {
    expect(
      renderChecks(
        {
          concluded: true,
          cancelled: false,
          summary: { pass: 1, fail: 0, pending: 0, skipping: 0 },
          checks: [{ name: 'a', bucket: 'pass' }],
        },
        true,
      ),
    ).toContain('complete');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('label.list caps the names at MAX_SUMMARY_LINES and shows a tail', () => {
    const labels = Array.from({ length: 100 }, (_, i) => ({
      name: `label-${i}`,
    }));
    const out = renderGithubResult('label.list', {}, { labels });
    expect(out).toContain('100 labels');
    expect(out).toContain('more');
  });

  /**
   * A label object with an absent or non-string `name` renders nothing, so
   * the header, the shown slice and the "… and N more" tail must all derive
   * from the filtered (named) count. Mixing the raw count into the header
   * made the header and tail disagree.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-013
   */
  it('label.list counts only named labels so header and tail agree', () => {
    const labels = [
      ...Array.from({ length: 12 }, (_, i) => ({ name: `label-${i}` })),
      { name: '' },
    ];
    const out = renderGithubResult('label.list', {}, { labels });
    // 13 raw items, but only 12 carry a name: the header must say 12, not 13,
    // and the tail must reflect 12 - 10 shown = 2.
    expect(out).toContain('12 labels');
    expect(out).not.toContain('13 labels');
    expect(out).toContain('… and 2 more');
  });
});
