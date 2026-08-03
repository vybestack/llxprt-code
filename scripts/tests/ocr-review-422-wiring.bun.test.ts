/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { describe, expect, it } from 'bun:test';
import { useWorkflowFixture } from './ocr-manifest-test-helpers.ts';
import { extractFunctionSource } from './ocr-review-workflow-helpers.ts';
import {
  A_TS,
  type CreateReviewCall,
  type FakeGithubOptions,
  type Pair,
  type ReviewComment,
  VM_TIMEOUT_MS,
  pair,
} from './ocr-review-422-helpers.ts';

// Security note: the vm.runInContext call below executes JavaScript extracted
// from the trusted, version-controlled ocr-review.yml workflow.

let fixture: ReturnType<typeof useWorkflowFixture>;

describe('.github/workflows/ocr-review.yml — 422 grouping wired into the batch-failure fallback (#2930)', () => {
  fixture = useWorkflowFixture();

  interface WiringOptions extends FakeGithubOptions {
    pairsToPost: Pair[];
    batchErr: unknown;
    existingKeyBodies?: ReviewComment[];
  }

  interface WiringResult {
    postedInline: number;
    failedInline: number;
    skippedExactHistoryCount: number;
    overflowRouted: Array<Record<string, unknown>>;
    remaining: Pair[];
    createReviewCalls: CreateReviewCall[];
    listKeyCalls: number;
  }

  /**
   * Execute the REAL batch-failure recovery block out of the workflow.
   *
   * Everything from the `recoverablePairs` dedup loop through the end of the
   * 422 branch is taken verbatim from `.github/workflows/ocr-review.yml` and
   * run against a fake Octokit, so the counters, summary routing and dedup
   * this asserts are the ones the workflow actually performs — not a
   * restatement of them.
   */
  async function runWiring(options: WiringOptions): Promise<WiringResult> {
    const postScript = fixture.postScript;
    const helperStart = postScript.indexOf('const LINE_RESOLUTION_PATTERNS');
    const lastHelper = extractFunctionSource(
      postScript,
      'regroupLineResolutionFailure',
    );
    const helperEnd = postScript.indexOf(lastHelper) + lastHelper.length;
    if (helperStart < 0 || helperEnd <= helperStart) {
      throw new Error(
        'post step should define the 422 helper block from LINE_RESOLUTION_PATTERNS through regroupLineResolutionFailure',
      );
    }
    const helperBlock = postScript.slice(helperStart, helperEnd);
    const wiringStart = postScript.indexOf('const recoverablePairs = [];');
    const wiringEnd = postScript.indexOf(
      '// pairsToPost was already capped to effectiveCap',
    );
    if (wiringStart < 0 || wiringEnd <= wiringStart) {
      throw new Error(
        'post step should contain the 422 recovery block between the recoverablePairs loop and the per-comment loop',
      );
    }
    const wiringBlock = postScript.slice(wiringStart, wiringEnd);

    const createReviewCalls: CreateReviewCall[] = [];
    let listKeyCalls = 0;
    const pages = options.pages ?? [[A_TS]];
    const github = {
      rest: {
        pulls: {
          listFiles: (params: { page: number }) =>
            Promise.resolve({ data: pages[params.page - 1] ?? [] }),
          get: () =>
            Promise.resolve({
              data: { head: { sha: options.headSha ?? 'sha-1' } },
            }),
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
      headSha: options.headSha ?? 'sha-1',
      pairsToPost: options.pairsToPost,
      batchErr: options.batchErr,
      core: {
        warning: () => {},
        info: () => {},
      },
      redactSecretDiagnostics: (value: unknown) => String(value),
      __listKeys: () => {
        listKeyCalls += 1;
        return options.existingKeyBodies ?? [];
      },
    };
    vm.createContext(sandbox);
    const source = [
      // Real key derivation, so dedup is exercised exactly as shipped.
      extractFunctionSource(postScript, 'unrenderFindingText'),
      extractFunctionSource(postScript, 'inlineCommentKey'),
      helperBlock,
      'async function existingInlineCommentKeys() {',
      '  return new Set(__listKeys().map(inlineCommentKey));',
      '}',
      'let existingInlineKeys = new Set(__listKeys().map(inlineCommentKey));',
      'let postedInline = 0;',
      'let failedInline = 0;',
      'let skippedExactHistoryCount = 0;',
      'const overflowRouted = [];',
      '__RESULT__ = (async () => {',
      wiringBlock,
      '  return {',
      '    postedInline,',
      '    failedInline,',
      '    skippedExactHistoryCount,',
      '    overflowRouted,',
      '    remaining: pairsToPostIndividually,',
      '  };',
      '})();',
    ].join(String.fromCharCode(10));
    vm.runInContext(source, sandbox, { timeout: VM_TIMEOUT_MS });
    const settled = (await sandbox['__RESULT__']) as {
      postedInline: number;
      failedInline: number;
      skippedExactHistoryCount: number;
      overflowRouted: Array<Record<string, unknown>>;
      remaining: Pair[];
    };
    return {
      ...settled,
      createReviewCalls,
      // The prelude's own priming read is not part of the workflow.
      listKeyCalls: listKeyCalls - 1,
    };
  }

  const LINE_422 = Object.assign(new Error('Unprocessable Entity'), {
    status: 422,
    errors: ['Line could not be resolved'],
  });

  it('groups in-diff survivors and books the rest as failed overflow', async () => {
    const good = pair({ path: 'a.ts', line: 3 }, 'good');
    const bad = pair({ path: 'a.ts', line: 900 }, 'bad');

    const result = await runWiring({
      pairsToPost: [good, bad],
      batchErr: LINE_422,
    });

    expect(result.createReviewCalls.length).toBe(1);
    expect(result.createReviewCalls[0].comments).toEqual([good.comment]);
    expect(result.postedInline).toBe(1);
    // The invariant shouldAdvanceCheckpoint depends on: a comment we decline
    // to post must still count as failed AND reach the sticky summary.
    expect(result.failedInline).toBe(1);
    expect(result.overflowRouted).toEqual([bad.finding]);
    expect(result.remaining).toEqual([]);
  });

  it('leaves a non-422 failure entirely to the per-comment loop', async () => {
    const one = pair({ path: 'a.ts', line: 3 }, 'one');
    const two = pair({ path: 'a.ts', line: 900 }, 'two');

    const result = await runWiring({
      pairsToPost: [one, two],
      batchErr: Object.assign(new Error('server exploded'), { status: 500 }),
    });

    expect(result.createReviewCalls.length).toBe(0);
    expect(result.postedInline).toBe(0);
    expect(result.failedInline).toBe(0);
    expect(result.overflowRouted).toEqual([]);
    expect(result.remaining.map((p) => p.finding['id'])).toEqual([
      'one',
      'two',
    ]);
  });

  it('leaves an unrecognised 422 entirely to the per-comment loop', async () => {
    const one = pair({ path: 'a.ts', line: 900 }, 'one');

    const result = await runWiring({
      pairsToPost: [one],
      batchErr: Object.assign(
        new Error(
          'Unprocessable Entity: "You have exceeded a secondary rate limit"',
        ),
        { status: 422 },
      ),
    });

    expect(result.createReviewCalls.length).toBe(0);
    expect(result.failedInline).toBe(0);
    expect(result.remaining.map((p) => p.finding['id'])).toEqual(['one']);
  });

  it('never regroups a comment the refreshed key set already shows as posted', async () => {
    const already = pair(
      { path: 'a.ts', line: 3, body: 'already there' },
      'already',
    );
    const good = pair({ path: 'a.ts', line: 4, body: 'fresh' }, 'good');
    const bad = pair({ path: 'a.ts', line: 900, body: 'outside' }, 'bad');

    const result = await runWiring({
      pairsToPost: [already, good, bad],
      batchErr: LINE_422,
      existingKeyBodies: [already.comment],
    });

    expect(result.skippedExactHistoryCount).toBe(1);
    expect(result.createReviewCalls.length).toBe(1);
    // The already-posted comment must not be re-sent by the grouped review.
    expect(result.createReviewCalls[0].comments).toEqual([good.comment]);
    expect(result.overflowRouted).toEqual([bad.finding]);
  });

  it('re-reads what landed when the grouped write throws', async () => {
    const good = pair({ path: 'a.ts', line: 3 }, 'good');
    const bad = pair({ path: 'a.ts', line: 900 }, 'bad');

    const result = await runWiring({
      pairsToPost: [good, bad],
      batchErr: LINE_422,
      createReviewError: Object.assign(new Error('gateway timeout'), {
        status: 504,
      }),
    });

    expect(result.createReviewCalls.length).toBe(1);
    expect(result.postedInline).toBe(0);
    // A grouped write that threw may still have landed, so the workflow must
    // refresh its view before the per-comment loop can repost the survivors.
    expect(result.listKeyCalls).toBeGreaterThan(0);
    expect(result.remaining.map((p) => p.finding['id'])).toEqual(['good']);
    expect(result.failedInline).toBe(1);
  });
});
