/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { useWorkflowFixture } from './ocr-manifest-test-helpers.ts';
import {
  A_TS,
  type DiffInventory,
  type FakeGithubOptions,
  type HunkRange,
  type ListFilesEntry,
  type Pair,
  loadHarness,
  pair,
} from './ocr-review-422-helpers.ts';

let fixture: ReturnType<typeof useWorkflowFixture>;

describe('.github/workflows/ocr-review.yml — HTTP 422 line-resolution grouping (#2930)', () => {
  fixture = useWorkflowFixture();

  describe('parseDiffHunkInventory', () => {
    it('collapses a single hunk to its RIGHT-side line range', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -1,3 +1,4 @@', ' a', '+b', ' c', ' d'].join('\n');
      expect(parseDiffHunkInventory(patch)).toEqual({
        ranges: [{ start: 1, end: 4 }],
        complete: true,
        additions: 1,
        deletions: 0,
      });
    });

    it('reports one range per hunk so a straddling span can be rejected', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = [
        '@@ -1,2 +1,2 @@',
        ' a',
        ' b',
        '@@ -20,2 +30,3 @@',
        ' x',
        '+y',
        ' z',
      ].join('\n');
      expect(parseDiffHunkInventory(patch).ranges).toEqual([
        { start: 1, end: 2 },
        { start: 30, end: 32 },
      ]);
      expect(parseDiffHunkInventory(patch).complete).toBe(true);
    });

    it('does not let deletion lines advance the new-file counter', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -1,4 +1,2 @@', ' a', '-gone', '-also gone', ' b'].join(
        '\n',
      );
      expect(parseDiffHunkInventory(patch).ranges).toEqual([
        { start: 1, end: 2 },
      ]);
    });

    it('emits no range for a pure-deletion hunk', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -5,3 +5,0 @@', '-a', '-b', '-c'].join('\n');
      expect(parseDiffHunkInventory(patch)).toEqual({
        ranges: [],
        complete: true,
        additions: 0,
        deletions: 3,
      });
    });

    it('treats a header with no explicit count as a single line on both sides', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -3 +7 @@', ' ctx'].join('\n');
      expect(parseDiffHunkInventory(patch).ranges).toEqual([
        { start: 7, end: 7 },
      ]);
      expect(parseDiffHunkInventory(patch).complete).toBe(true);
    });

    it('ignores the "no newline at end of file" marker', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = [
        '@@ -1,1 +1,2 @@',
        ' a',
        '+b',
        '\\ No newline at end of file',
      ].join('\n');
      const parsed = parseDiffHunkInventory(patch);
      expect(parsed.ranges).toEqual([{ start: 1, end: 2 }]);
      expect(parsed.complete).toBe(true);
    });

    it('marks a clipped patch incomplete rather than trusting the prefix', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      // Header declares 5 RIGHT-side lines; only 2 are present.
      const patch = ['@@ -1,5 +1,5 @@', ' a', '+b'].join('\n');
      expect(parseDiffHunkInventory(patch).complete).toBe(false);
    });

    it('detects truncation inside a run of deletions', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      // The NEW-side count (1) is already satisfied by the context line, so
      // only validating the new side would wrongly call this complete. The
      // OLD side declares 3 but only 2 are present.
      const patch = ['@@ -1,3 +1,1 @@', ' keep', '-gone'].join('\n');
      expect(parseDiffHunkInventory(patch).complete).toBe(false);
    });

    it('detects a pure-deletion hunk truncated before its body', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -5,3 +5,0 @@'].join('\n');
      expect(parseDiffHunkInventory(patch).complete).toBe(false);
    });

    it('counts additions and deletions so the caller can cross-check totals', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = ['@@ -1,3 +1,3 @@', ' a', '-old', '+new', ' b'].join('\n');
      const parsed = parseDiffHunkInventory(patch);
      expect(parsed.complete).toBe(true);
      expect(parsed.additions).toBe(1);
      expect(parsed.deletions).toBe(1);
    });

    it('treats absent or empty patch data as incomplete', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      expect(parseDiffHunkInventory(undefined)).toEqual({
        ranges: [],
        complete: false,
        additions: 0,
        deletions: 0,
      });
      expect(parseDiffHunkInventory('')).toEqual({
        ranges: [],
        complete: false,
        additions: 0,
        deletions: 0,
      });
      expect(parseDiffHunkInventory('no hunk header here').complete).toBe(
        false,
      );
    });

    it('does not let a trailing newline inflate the observed count', () => {
      const { parseDiffHunkInventory } = loadHarness(fixture.postScript);
      const patch = '@@ -1,1 +1,2 @@\n a\n+b\n';
      expect(parseDiffHunkInventory(patch).complete).toBe(true);
    });
  });

  describe('classifyCommentAgainstDiff', () => {
    function diffWith(
      files: Record<string, HunkRange[]>,
      known: string[],
      complete = true,
    ): DiffInventory {
      return {
        files: new Map(Object.entries(files)),
        known: new Set(known),
        complete,
      };
    }

    it('returns valid when the whole span sits inside one hunk', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 10, end: 20 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 15, start_line: 12 },
          diff,
        ),
      ).toBe('valid');
    });

    it('returns invalid for a span that straddles two hunks', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith(
        {
          'a.ts': [
            { start: 1, end: 5 },
            { start: 30, end: 40 },
          ],
        },
        ['a.ts'],
      );
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 32, start_line: 4 },
          diff,
        ),
      ).toBe('invalid');
    });

    it('returns invalid for a line outside every hunk', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 10, end: 20 }] }, ['a.ts']);
      expect(classifyCommentAgainstDiff({ path: 'a.ts', line: 99 }, diff)).toBe(
        'invalid',
      );
    });

    it('returns invalid for a path that is not in the PR at all', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff({ path: 'ghost.ts', line: 2 }, diff),
      ).toBe('invalid');
    });

    it('returns invalid for a reversed span', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 50 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 5, start_line: 40 },
          diff,
        ),
      ).toBe('invalid');
    });

    it('declines to judge when the inventory is incomplete', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith(
        { 'a.ts': [{ start: 1, end: 2 }] },
        ['a.ts'],
        false,
      );
      // Would be "invalid" against a complete inventory.
      expect(classifyCommentAgainstDiff({ path: 'a.ts', line: 99 }, diff)).toBe(
        'unknown',
      );
      expect(
        classifyCommentAgainstDiff({ path: 'nope.ts', line: 1 }, diff),
      ).toBe('unknown');
    });

    it('declines to judge when there is no inventory at all', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      expect(classifyCommentAgainstDiff({ path: 'a.ts', line: 1 }, null)).toBe(
        'unknown',
      );
    });

    it('declines to judge a file whose patch GitHub omitted', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({}, ['binary.png']);
      expect(
        classifyCommentAgainstDiff({ path: 'binary.png', line: 3 }, diff),
      ).toBe('unknown');
    });

    it('declines to judge a LEFT-side comment', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 99, side: 'LEFT' },
          diff,
        ),
      ).toBe('unknown');
    });

    it('declines to judge a comment with no line', () => {
      const { classifyCommentAgainstDiff } = loadHarness(fixture.postScript);
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff({ path: 'a.ts', line: null }, diff),
      ).toBe('unknown');
    });
  });

  describe('errorStatus / isLineResolutionFailure gate', () => {
    it('reads the status off either error shape', () => {
      const { errorStatus } = loadHarness(fixture.postScript);
      expect(errorStatus({ status: 422 })).toBe(422);
      expect(errorStatus({ response: { status: 422 } })).toBe(422);
      expect(errorStatus({ status: 'nope' })).toBeUndefined();
      expect(errorStatus(null)).toBeUndefined();
      expect(errorStatus('422')).toBeUndefined();
    });

    it('activates on the real GitHub line-resolution payload', () => {
      const { isLineResolutionFailure } = loadHarness(fixture.postScript);
      expect(
        isLineResolutionFailure({
          status: 422,
          message:
            'Unprocessable Entity: "Line could not be resolved and Line could not be resolved"',
          response: {
            data: { errors: ['Line could not be resolved'] },
          },
        }),
      ).toBe(true);
    });

    it('activates when only the errors array carries the wording', () => {
      const { isLineResolutionFailure } = loadHarness(fixture.postScript);
      expect(
        isLineResolutionFailure({
          status: 422,
          message: 'Unprocessable Entity',
          errors: ['Start position could not be resolved'],
        }),
      ).toBe(true);
    });

    it('activates on a structured validation error naming a line field', () => {
      const { isLineResolutionFailure } = loadHarness(fixture.postScript);
      expect(
        isLineResolutionFailure({
          status: 422,
          message: 'Validation Failed',
          errors: [
            { resource: 'PullRequestReviewComment', field: 'start_line' },
          ],
        }),
      ).toBe(true);
    });

    it('does NOT activate on a bare Unprocessable Entity message', () => {
      const { isLineResolutionFailure } = loadHarness(fixture.postScript);
      expect(
        isLineResolutionFailure({
          status: 422,
          message: 'Unprocessable Entity',
        }),
      ).toBe(false);
    });

    it('does NOT activate on an unrelated 422 such as spam detection', () => {
      const { isLineResolutionFailure } = loadHarness(fixture.postScript);
      expect(
        isLineResolutionFailure({
          status: 422,
          message:
            'Unprocessable Entity: "You have exceeded a secondary rate limit"',
        }),
      ).toBe(false);
      expect(isLineResolutionFailure(null)).toBe(false);
      expect(isLineResolutionFailure({ status: 422 })).toBe(false);
    });
  });

  describe('prDiffHunkInventory', () => {
    it('builds a complete inventory from a single page when the head matches', async () => {
      const harness = loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages: [
          [
            {
              filename: 'a.ts',
              patch: '@@ -1,1 +1,2 @@\n a\n+b',
              additions: 1,
              deletions: 0,
            },
            { filename: 'binary.png' },
          ],
        ],
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.complete).toBe(true);
      expect(diff.known.has('a.ts')).toBe(true);
      expect(diff.known.has('binary.png')).toBe(true);
      // A file with no patch is known but has no ranges, so it classifies
      // "unknown" rather than "invalid".
      expect(diff.files.has('binary.png')).toBe(false);
      expect(diff.files.get('a.ts')).toEqual([{ start: 1, end: 2 }]);
    });

    it('refuses to prove anything when the PR head moved during the walk', async () => {
      const harness = loadHarness(fixture.postScript, {
        headSha: 'moved-sha',
        pages: [
          [
            {
              filename: 'a.ts',
              patch: '@@ -0,0 +1,1 @@\n+a',
              additions: 1,
              deletions: 0,
            },
          ],
        ],
      });
      const diff = await harness.prDiffHunkInventory('review-sha');
      expect(diff.complete).toBe(false);
      expect(harness.warnings.join('\n')).toContain('head moved');
    });

    it('refuses to prove anything when the changed-file list comes back empty', async () => {
      const harness = loadHarness(fixture.postScript, { pages: [[]] });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.complete).toBe(false);
      expect(harness.warnings.join('\n')).toContain('came back empty');
    });

    it('refuses to prove anything when pagination is truncated', async () => {
      const pages: ListFilesEntry[][] = [];
      for (let page = 0; page < 30; page += 1) {
        const entries: ListFilesEntry[] = [];
        for (let index = 0; index < 100; index += 1) {
          entries.push({ filename: `f-${page}-${index}.ts` });
        }
        pages.push(entries);
      }
      const harness = loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages,
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.complete).toBe(false);
      expect(harness.listFilesPages.length).toBe(30);
      expect(harness.warnings.join('\n')).toContain('exceeded 3000 files');
    });

    it('does not index a file whose patch is clipped', async () => {
      const harness = loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages: [
          [
            {
              filename: 'a.ts',
              patch: '@@ -1,9 +1,9 @@\n a',
              additions: 0,
              deletions: 0,
            },
          ],
        ],
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.known.has('a.ts')).toBe(true);
      expect(diff.files.has('a.ts')).toBe(false);
    });

    it('does not index a file whose patch omits whole trailing hunks', async () => {
      // Every hunk present is internally consistent, so per-hunk counts alone
      // cannot detect the truncation. The entry's own totals can: it declares
      // 5 additions but the patch only accounts for 1.
      const harness = loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages: [
          [
            {
              filename: 'a.ts',
              patch: '@@ -1,1 +1,2 @@\n a\n+b',
              additions: 5,
              deletions: 0,
            },
          ],
        ],
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.known.has('a.ts')).toBe(true);
      expect(diff.files.has('a.ts')).toBe(false);
    });

    it('does not index a file whose entry omits the change totals', async () => {
      const harness = loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages: [[{ filename: 'a.ts', patch: '@@ -1,1 +1,2 @@\n a\n+b' }]],
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.known.has('a.ts')).toBe(true);
      expect(diff.files.has('a.ts')).toBe(false);
    });
  });

  describe('regroupLineResolutionFailure', () => {
    function harnessWithDiff(extra: FakeGithubOptions = {}) {
      return loadHarness(fixture.postScript, {
        headSha: 'sha-1',
        pages: [[A_TS]],
        ...extra,
      });
    }

    it('posts the in-diff survivors as ONE grouped review', async () => {
      const harness = harnessWithDiff();
      const good = pair({ path: 'a.ts', line: 3 }, 'good-1');
      const alsoGood = pair({ path: 'a.ts', line: 7 }, 'good-2');
      const bad = pair({ path: 'a.ts', line: 900 }, 'bad-1');

      const result = await harness.regroupLineResolutionFailure(
        [good, alsoGood, bad],
        'sha-1',
      );

      expect(harness.createReviewCalls.length).toBe(1);
      expect(harness.createReviewCalls[0].comments).toEqual([
        good.comment,
        alsoGood.comment,
      ]);
      expect(harness.createReviewCalls[0].commit_id).toBe('sha-1');
      expect(result.posted).toBe(2);
      expect(result.invalidPairs.map((p) => p.finding['id'])).toEqual([
        'bad-1',
      ]);
      expect(result.remaining).toEqual([]);
    });

    it('leaves unjudgeable comments to the per-comment loop', async () => {
      const harness = harnessWithDiff({
        pages: [[A_TS, { filename: 'binary.png' }]],
      });
      const good = pair({ path: 'a.ts', line: 3 }, 'good');
      const unknown = pair({ path: 'binary.png', line: 2 }, 'unknown');
      const bad = pair({ path: 'a.ts', line: 900 }, 'bad');

      const result = await harness.regroupLineResolutionFailure(
        [good, unknown, bad],
        'sha-1',
      );

      expect(harness.createReviewCalls.length).toBe(1);
      expect(harness.createReviewCalls[0].comments).toEqual([good.comment]);
      expect(result.posted).toBe(1);
      expect(result.invalidPairs.map((p) => p.finding['id'])).toEqual(['bad']);
      expect(result.remaining.map((p) => p.finding['id'])).toEqual(['unknown']);
    });

    it('skips the grouped retry when filtering removed nothing', async () => {
      const harness = harnessWithDiff();
      const good = pair({ path: 'a.ts', line: 3 }, 'good-1');
      const alsoGood = pair({ path: 'a.ts', line: 4 }, 'good-2');

      const result = await harness.regroupLineResolutionFailure(
        [good, alsoGood],
        'sha-1',
      );

      // Re-sending an identical payload into an endpoint that just rejected it
      // is a guaranteed second 422, so no write is attempted.
      expect(harness.createReviewCalls.length).toBe(0);
      expect(result.posted).toBe(0);
      expect(result.invalidPairs).toEqual([]);
      expect(result.remaining.map((p) => p.finding['id'])).toEqual([
        'good-1',
        'good-2',
      ]);
    });

    it('falls through untouched when the inventory cannot be trusted', async () => {
      // A populated file list, so the inventory is untrustworthy specifically
      // because the head moved — not because the list was empty, which would
      // short-circuit the head check and pass for the wrong reason.
      const harness = loadHarness(fixture.postScript, {
        headSha: 'moved',
        pages: [[A_TS]],
      });
      const one = pair({ path: 'a.ts', line: 3 }, 'one');
      const two = pair({ path: 'ghost.ts', line: 4 }, 'two');

      const result = await harness.regroupLineResolutionFailure(
        [one, two],
        'sha-1',
      );

      expect(harness.createReviewCalls.length).toBe(0);
      expect(result.posted).toBe(0);
      // Nothing is discarded on an untrustworthy inventory.
      expect(result.invalidPairs).toEqual([]);
      expect(result.remaining.map((p) => p.finding['id'])).toEqual([
        'one',
        'two',
      ]);
    });

    it('keeps every finding when the grouped retry itself fails', async () => {
      const harness = harnessWithDiff({
        createReviewError: Object.assign(new Error('boom'), { status: 500 }),
      });
      const good = pair({ path: 'a.ts', line: 3 }, 'good');
      const bad = pair({ path: 'a.ts', line: 900 }, 'bad');

      const result = await harness.regroupLineResolutionFailure(
        [good, bad],
        'sha-1',
      );

      expect(harness.createReviewCalls.length).toBe(1);
      expect(result.posted).toBe(0);
      expect(result.invalidPairs.map((p) => p.finding['id'])).toEqual(['bad']);
      // The survivors go back to the per-comment loop rather than vanishing.
      expect(result.remaining.map((p) => p.finding['id'])).toEqual(['good']);
      // The grouped write may have landed before it threw, so the caller is
      // told to re-read before reposting.
      expect(result.secondaryFailed).toBe(true);
    });

    it('does not ask for a re-read when no grouped write was attempted', async () => {
      const harness = harnessWithDiff();
      const good = pair({ path: 'a.ts', line: 3 }, 'good-1');
      const alsoGood = pair({ path: 'a.ts', line: 4 }, 'good-2');

      const result = await harness.regroupLineResolutionFailure(
        [good, alsoGood],
        'sha-1',
      );

      expect(harness.createReviewCalls.length).toBe(0);
      expect(result.secondaryFailed).toBe(false);
    });

    it('falls through untouched when the diff inventory read throws', async () => {
      const harness = loadHarness(fixture.postScript, {
        listFilesError: new Error('network down'),
      });
      const one = pair({ path: 'a.ts', line: 3 }, 'one');

      const result = await harness.regroupLineResolutionFailure([one], 'sha-1');

      expect(harness.createReviewCalls.length).toBe(0);
      expect(result.posted).toBe(0);
      expect(result.invalidPairs).toEqual([]);
      expect(result.remaining.map((p) => p.finding['id'])).toEqual(['one']);
    });

    it('preserves the original finding object for summary routing', async () => {
      const harness = harnessWithDiff();
      const bad: Pair = {
        comment: { path: 'a.ts', line: 900 },
        finding: {
          path: 'a.ts',
          category: 'security',
          severity: 'high',
          content: 'do not do this',
        },
      };
      const good = pair({ path: 'a.ts', line: 2 }, 'good');

      const result = await harness.regroupLineResolutionFailure(
        [good, bad],
        'sha-1',
      );

      expect(result.invalidPairs.length).toBe(1);
      expect(result.invalidPairs[0].finding).toEqual(bad.finding);
    });
  });
});
