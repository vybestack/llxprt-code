/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { describe, expect, it } from 'bun:test';
import { useWorkflowFixture } from './ocr-manifest-test-helpers.ts';
import { extractFunctionSource } from './ocr-review-workflow-helpers.ts';
import { asRecord, asVmFunction } from './typed-test-helpers.ts';

// Security note: the vm.runInContext call below executes JavaScript extracted
// from the trusted, version-controlled ocr-review.yml workflow. This is
// repository content read from the checked-out HEAD, never user or PR input.

const VM_TIMEOUT_MS = 5000;

// Assigned inside the top-level describe, matching the sibling OCR workflow
// suites: the fixture factory is named use* and must not be invoked at module
// scope.
let fixture: ReturnType<typeof useWorkflowFixture>;

interface HunkRange {
  start: number;
  end: number;
}

interface HunkInventory {
  ranges: HunkRange[];
  complete: boolean;
}

interface DiffInventory {
  files: Map<string, HunkRange[]>;
  known: Set<string>;
  complete: boolean;
}

interface ReviewComment {
  path: string;
  line?: number | null;
  start_line?: number | null;
  side?: string;
  body?: string;
}

interface Pair {
  comment: ReviewComment;
  finding: Record<string, unknown>;
}

interface RegroupResult {
  posted: number;
  invalidPairs: Pair[];
  remaining: Pair[];
}

interface ListFilesEntry {
  filename: string;
  patch?: string;
}

interface CreateReviewCall {
  commit_id: string;
  comments: ReviewComment[];
}

interface FakeGithubOptions {
  pages?: ListFilesEntry[][];
  headSha?: string;
  createReviewError?: Error;
  listFilesError?: Error;
}

interface Harness {
  errorStatus: (error: unknown) => number | undefined;
  isLineResolutionFailure: (error: unknown) => boolean;
  parseDiffHunkInventory: (patch: unknown) => HunkInventory;
  classifyCommentAgainstDiff: (
    comment: ReviewComment,
    diff: DiffInventory | null,
  ) => string;
  prDiffHunkInventory: (commitSha: string) => Promise<DiffInventory>;
  regroupLineResolutionFailure: (
    pairs: Pair[],
    commitSha: string,
  ) => Promise<RegroupResult>;
  createReviewCalls: CreateReviewCall[];
  listFilesPages: number[];
  warnings: string[];
  infos: string[];
}

/**
 * Load the REAL 422-grouping source out of the workflow's "Post OCR results"
 * step and run it in a sandbox against a fake Octokit.
 *
 * The whole contiguous region is taken verbatim — from the
 * LINE_RESOLUTION_PATTERNS constant through the end of
 * regroupLineResolutionFailure — rather than re-declaring the constants in the
 * test, so the patterns and thresholds under test are the ones the workflow
 * actually ships.
 */
function loadHarness(options: FakeGithubOptions = {}): Harness {
  const postScript = fixture.postScript;
  const blockStart = postScript.indexOf('const LINE_RESOLUTION_PATTERNS');
  if (blockStart < 0) {
    throw new Error(
      'post step should define LINE_RESOLUTION_PATTERNS (issue #2930 422 grouping)',
    );
  }
  const lastFunction = extractFunctionSource(
    postScript,
    'regroupLineResolutionFailure',
  );
  const blockEnd = postScript.indexOf(lastFunction) + lastFunction.length;
  if (blockEnd <= blockStart) {
    throw new Error(
      'regroupLineResolutionFailure should follow LINE_RESOLUTION_PATTERNS contiguously',
    );
  }
  const block = postScript.slice(blockStart, blockEnd);

  const createReviewCalls: CreateReviewCall[] = [];
  const listFilesPages: number[] = [];
  const warnings: string[] = [];
  const infos: string[] = [];
  const pages = options.pages ?? [[]];
  const headSha = options.headSha ?? 'head-sha';

  const github = {
    rest: {
      pulls: {
        listFiles: (params: { page: number }) => {
          if (options.listFilesError) throw options.listFilesError;
          listFilesPages.push(params.page);
          return Promise.resolve({ data: pages[params.page - 1] ?? [] });
        },
        get: () => Promise.resolve({ data: { head: { sha: headSha } } }),
        createReview: (params: CreateReviewCall) => {
          createReviewCalls.push({
            commit_id: params.commit_id,
            comments: params.comments,
          });
          if (options.createReviewError) throw options.createReviewError;
          return Promise.resolve({ data: {} });
        },
      },
    },
  };

  const sandbox: Record<string, unknown> = {
    String,
    Number,
    Math,
    JSON,
    Object,
    Array,
    Boolean,
    Error,
    Set,
    Map,
    Promise,
    parseInt,
    github,
    owner: 'acme',
    repo: 'widget',
    number: 42,
    core: {
      warning: (message: unknown) => warnings.push(String(message)),
      info: (message: unknown) => infos.push(String(message)),
    },
    // The workflow redacts credentials out of diagnostics before logging. The
    // 422 path only passes it error text, so identity is faithful here.
    redactSecretDiagnostics: (value: unknown) => String(value),
  };
  vm.createContext(sandbox);
  vm.runInContext(
    [
      block,
      '__EXPOSED__ = {',
      '  errorStatus,',
      '  isLineResolutionFailure,',
      '  parseDiffHunkInventory,',
      '  classifyCommentAgainstDiff,',
      '  prDiffHunkInventory,',
      '  regroupLineResolutionFailure,',
      '};',
    ].join('\n'),
    sandbox,
    { timeout: VM_TIMEOUT_MS },
  );
  const exposed = asRecord(sandbox['__EXPOSED__']);
  const errorStatusFn = asVmFunction(exposed['errorStatus']);
  const isLineResolutionFailureFn = asVmFunction(
    exposed['isLineResolutionFailure'],
  );
  const parseFn = asVmFunction(exposed['parseDiffHunkInventory']);
  const classifyFn = asVmFunction(exposed['classifyCommentAgainstDiff']);
  const inventoryFn = asVmFunction(exposed['prDiffHunkInventory']);
  const regroupFn = asVmFunction(exposed['regroupLineResolutionFailure']);

  return {
    errorStatus: (error) => errorStatusFn(error) as number | undefined,
    isLineResolutionFailure: (error) =>
      isLineResolutionFailureFn(error) as boolean,
    parseDiffHunkInventory: (patch) => parseFn(patch) as HunkInventory,
    classifyCommentAgainstDiff: (comment, diff) =>
      classifyFn(comment, diff) as string,
    prDiffHunkInventory: (commitSha) =>
      inventoryFn(commitSha) as Promise<DiffInventory>,
    regroupLineResolutionFailure: (pairs, commitSha) =>
      regroupFn(pairs, commitSha) as Promise<RegroupResult>,
    createReviewCalls,
    listFilesPages,
    warnings,
    infos,
  };
}

function pair(comment: ReviewComment, id = comment.path): Pair {
  return { comment, finding: { path: comment.path, id } };
}

describe('.github/workflows/ocr-review.yml — HTTP 422 line-resolution grouping (#2930)', () => {
  fixture = useWorkflowFixture();

  describe('parseDiffHunkInventory', () => {
    it('collapses a single hunk to its RIGHT-side line range', () => {
      const { parseDiffHunkInventory } = loadHarness();
      const patch = ['@@ -1,3 +1,4 @@', ' a', '+b', ' c', ' d'].join('\n');
      expect(parseDiffHunkInventory(patch)).toEqual({
        ranges: [{ start: 1, end: 4 }],
        complete: true,
      });
    });

    it('reports one range per hunk so a straddling span can be rejected', () => {
      const { parseDiffHunkInventory } = loadHarness();
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
      const { parseDiffHunkInventory } = loadHarness();
      const patch = ['@@ -1,4 +1,2 @@', ' a', '-gone', '-also gone', ' b'].join(
        '\n',
      );
      expect(parseDiffHunkInventory(patch).ranges).toEqual([
        { start: 1, end: 2 },
      ]);
    });

    it('emits no range for a pure-deletion hunk', () => {
      const { parseDiffHunkInventory } = loadHarness();
      const patch = ['@@ -5,3 +5,0 @@', '-a', '-b', '-c'].join('\n');
      expect(parseDiffHunkInventory(patch)).toEqual({
        ranges: [],
        complete: true,
      });
    });

    it('treats a header with no explicit count as a single line', () => {
      const { parseDiffHunkInventory } = loadHarness();
      const patch = ['@@ -1 +7 @@', '+only'].join('\n');
      expect(parseDiffHunkInventory(patch).ranges).toEqual([
        { start: 7, end: 7 },
      ]);
      expect(parseDiffHunkInventory(patch).complete).toBe(true);
    });

    it('ignores the "no newline at end of file" marker', () => {
      const { parseDiffHunkInventory } = loadHarness();
      const patch = [
        '@@ -1,2 +1,2 @@',
        ' a',
        '+b',
        '\\ No newline at end of file',
      ].join('\n');
      expect(parseDiffHunkInventory(patch)).toEqual({
        ranges: [{ start: 1, end: 2 }],
        complete: true,
      });
    });

    it('marks a clipped patch incomplete rather than trusting the prefix', () => {
      const { parseDiffHunkInventory } = loadHarness();
      // Header declares 5 RIGHT-side lines; only 2 are present.
      const patch = ['@@ -1,5 +1,5 @@', ' a', '+b'].join('\n');
      expect(parseDiffHunkInventory(patch).complete).toBe(false);
    });

    it('treats absent or empty patch data as incomplete', () => {
      const { parseDiffHunkInventory } = loadHarness();
      expect(parseDiffHunkInventory(undefined)).toEqual({
        ranges: [],
        complete: false,
      });
      expect(parseDiffHunkInventory('')).toEqual({
        ranges: [],
        complete: false,
      });
      expect(parseDiffHunkInventory('no hunk header here').complete).toBe(
        false,
      );
    });

    it('does not let a trailing newline inflate the observed count', () => {
      const { parseDiffHunkInventory } = loadHarness();
      const patch = '@@ -1,2 +1,2 @@\n a\n+b\n';
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
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 10, end: 20 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 15, start_line: 12 },
          diff,
        ),
      ).toBe('valid');
    });

    it('returns invalid for a span that straddles two hunks', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
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
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 10, end: 20 }] }, ['a.ts']);
      expect(classifyCommentAgainstDiff({ path: 'a.ts', line: 99 }, diff)).toBe(
        'invalid',
      );
    });

    it('returns invalid for a path that is not in the PR at all', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff({ path: 'ghost.ts', line: 2 }, diff),
      ).toBe('invalid');
    });

    it('returns invalid for a reversed span', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 50 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 5, start_line: 40 },
          diff,
        ),
      ).toBe('invalid');
    });

    it('declines to judge when the inventory is incomplete', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
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
      const { classifyCommentAgainstDiff } = loadHarness();
      expect(classifyCommentAgainstDiff({ path: 'a.ts', line: 1 }, null)).toBe(
        'unknown',
      );
    });

    it('declines to judge a file whose patch GitHub omitted', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({}, ['binary.png']);
      expect(
        classifyCommentAgainstDiff({ path: 'binary.png', line: 3 }, diff),
      ).toBe('unknown');
    });

    it('declines to judge a LEFT-side comment', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff(
          { path: 'a.ts', line: 99, side: 'LEFT' },
          diff,
        ),
      ).toBe('unknown');
    });

    it('declines to judge a comment with no line', () => {
      const { classifyCommentAgainstDiff } = loadHarness();
      const diff = diffWith({ 'a.ts': [{ start: 1, end: 5 }] }, ['a.ts']);
      expect(
        classifyCommentAgainstDiff({ path: 'a.ts', line: null }, diff),
      ).toBe('unknown');
    });
  });

  describe('errorStatus / isLineResolutionFailure gate', () => {
    it('reads the status off either error shape', () => {
      const { errorStatus } = loadHarness();
      expect(errorStatus({ status: 422 })).toBe(422);
      expect(errorStatus({ response: { status: 422 } })).toBe(422);
      expect(errorStatus({ status: 'nope' })).toBeUndefined();
      expect(errorStatus(null)).toBeUndefined();
      expect(errorStatus('422')).toBeUndefined();
    });

    it('activates on the real GitHub line-resolution payload', () => {
      const { isLineResolutionFailure } = loadHarness();
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
      const { isLineResolutionFailure } = loadHarness();
      expect(
        isLineResolutionFailure({
          status: 422,
          message: 'Unprocessable Entity',
          errors: ['Start position could not be resolved'],
        }),
      ).toBe(true);
    });

    it('activates on a structured validation error naming a line field', () => {
      const { isLineResolutionFailure } = loadHarness();
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
      const { isLineResolutionFailure } = loadHarness();
      expect(
        isLineResolutionFailure({
          status: 422,
          message: 'Unprocessable Entity',
        }),
      ).toBe(false);
    });

    it('does NOT activate on an unrelated 422 such as spam detection', () => {
      const { isLineResolutionFailure } = loadHarness();
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
      const harness = loadHarness({
        headSha: 'sha-1',
        pages: [
          [
            { filename: 'a.ts', patch: '@@ -1,2 +1,2 @@\n a\n+b' },
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
      const harness = loadHarness({
        headSha: 'moved-sha',
        pages: [[{ filename: 'a.ts', patch: '@@ -1,1 +1,1 @@\n+a' }]],
      });
      const diff = await harness.prDiffHunkInventory('review-sha');
      expect(diff.complete).toBe(false);
      expect(harness.warnings.join('\n')).toContain('head moved');
    });

    it('refuses to prove anything when the changed-file list comes back empty', async () => {
      const harness = loadHarness({ pages: [[]] });
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
      const harness = loadHarness({ headSha: 'sha-1', pages });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.complete).toBe(false);
      expect(harness.listFilesPages.length).toBe(30);
      expect(harness.warnings.join('\n')).toContain('exceeded 3000 files');
    });

    it('does not index a file whose patch is clipped', async () => {
      const harness = loadHarness({
        headSha: 'sha-1',
        pages: [[{ filename: 'a.ts', patch: '@@ -1,9 +1,9 @@\n a' }]],
      });
      const diff = await harness.prDiffHunkInventory('sha-1');
      expect(diff.known.has('a.ts')).toBe(true);
      expect(diff.files.has('a.ts')).toBe(false);
    });
  });

  describe('regroupLineResolutionFailure', () => {
    const PATCH = '@@ -1,10 +1,10 @@\n a\n b\n c\n d\n e\n f\n g\n h\n i\n j';

    function harnessWithDiff(extra: FakeGithubOptions = {}) {
      return loadHarness({
        headSha: 'sha-1',
        pages: [[{ filename: 'a.ts', patch: PATCH }]],
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
        pages: [
          [{ filename: 'a.ts', patch: PATCH }, { filename: 'binary.png' }],
        ],
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
      const harness = loadHarness({ headSha: 'moved', pages: [[]] });
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
    });

    it('falls through untouched when the diff inventory read throws', async () => {
      const harness = loadHarness({
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

  describe('wiring into the batch-failure fallback', () => {
    it('gates the grouped retry on a confirmed line-resolution 422', () => {
      const script = fixture.postScript;
      expect(script).toContain(
        'if (errorStatus(batchErr) === 422 && isLineResolutionFailure(batchErr)) {',
      );
      expect(script).toContain(
        'const regrouped = await regroupLineResolutionFailure(pairsToPost, headSha);',
      );
    });

    it('counts provably out-of-diff comments as failed and routes them to the summary', () => {
      const script = fixture.postScript;
      const branchStart = script.indexOf(
        'const regrouped = await regroupLineResolutionFailure(',
      );
      expect(branchStart).toBeGreaterThan(-1);
      const branch = script.slice(branchStart, branchStart + 700);
      // The failedInline invariant shouldAdvanceCheckpoint depends on: a
      // comment we decline to post must still count as failed.
      expect(branch).toContain('failedInline += 1;');
      expect(branch).toContain('overflowRouted.push(p.finding);');
      expect(branch).toContain('postedInline += regrouped.posted;');
      expect(branch).toContain(
        'pairsToPostIndividually = regrouped.remaining;',
      );
    });

    it('still routes everything else through the per-comment loop', () => {
      const script = fixture.postScript;
      expect(script).toContain('let pairsToPostIndividually = pairsToPost;');
      expect(script).toContain('for (const p of pairsToPostIndividually) {');
    });
  });
});
