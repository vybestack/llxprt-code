/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'bun:test';
import {
  asRecord,
  asString,
  asVmFunction,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';
import {
  WORKFLOW_PATH,
  commandText,
  extractFunctionSource,
  readRootFile,
  stepNamed,
} from './ocr-review-workflow-helpers.ts';

// Security note: the vm.runInContext calls in this suite execute JavaScript
// extracted from the trusted, version-controlled ocr-review.yml workflow via
// extractFunctionSource / verbatim block slicing. This is repository content
// read from the checked-out HEAD, never user or PR input.

// Issue #3544: the inline comment objects built by the post step carry an
// internal `_severity` sort key. GitHub's REST-to-GraphQL bridge rejects
// unknown members on draft review threads (the key surfaces as a nonexistent
// `Severity` field), failing every batched `createReview` with HTTP 422.
// These tests pin the transmission boundary: the payload handed to
// github.rest.pulls.createReview contains exactly the fields the review API
// defines, and nothing else.

const VM_TIMEOUT_MS = 5000;

/** Keys that must always be present on a transmitted review comment. */
const BASE_KEYS = ['body', 'line', 'path', 'side'];

/** Additional keys permitted only when the comment spans a line range. */
const RANGE_KEYS = ['start_line', 'start_side'];

interface InternalComment {
  path: string;
  line: number;
  side: string;
  body: string;
  _severity?: string;
  start_line?: number;
  start_side?: string;
}

interface Pair {
  comment: InternalComment;
  finding: Record<string, unknown>;
}

interface CreateReviewCall {
  commit_id: string;
  comments: Array<Record<string, unknown>>;
}

function internalPair(comment: InternalComment): Pair {
  return { comment, finding: { path: comment.path } };
}

function multiLineComment(severity: string): InternalComment {
  return {
    path: 'a.ts',
    line: 9,
    side: 'RIGHT',
    body: '<!-- ocr-fp:ocr-run-1-0-abc -->\n> multi',
    _severity: severity,
    start_line: 3,
    start_side: 'RIGHT',
  };
}

function singleLineComment(severity: string): InternalComment {
  return {
    path: 'b.ts',
    line: 4,
    side: 'RIGHT',
    body: '<!-- ocr-fp:ocr-run-1-1-def -->\n> single',
    _severity: severity,
  };
}

function sortedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort();
}

describe('.github/workflows/ocr-review.yml — review comment payload allow-list (#3544)', () => {
  let postScript: string;

  beforeAll(() => {
    const workflow = parseWorkflowYaml(readRootFile(WORKFLOW_PATH));
    const codeReviewJob = workflow.jobs?.['code-review'];
    expect(
      codeReviewJob,
      'workflow should contain job: code-review',
    ).toBeTruthy();
    const postStep = stepNamed(codeReviewJob, 'Post OCR results');
    postScript = commandText(postStep);
  });

  /**
   * Slice the REAL primary batch-post block verbatim out of the post step:
   * from `const inlineToPost = ...` through the success assignment. The
   * harness closes the workflow's `try` so the sandbox compiles, and asserts
   * the next workflow line is the catch so a future re-shaping of this block
   * fails loudly instead of testing the wrong code.
   */ function primaryPostBlock(): string {
    const startMarker =
      'const inlineToPost = pairsToPost.map((p) => p.comment);';
    const endMarker = 'postedInline = inlineToPost.length;';
    const blockStart = postScript.indexOf(startMarker);
    if (blockStart < 0) {
      throw new Error(
        'post step should build inlineToPost from pairsToPost before the batch post',
      );
    }
    const endMarkerIndex = postScript.indexOf(endMarker, blockStart);
    if (endMarkerIndex < 0) {
      throw new Error(
        'post step should assign postedInline from inlineToPost after the batch post',
      );
    }
    const blockEnd = endMarkerIndex + endMarker.length;
    if (
      !postScript.slice(blockEnd).trimStart().startsWith('} catch (batchErr)')
    ) {
      throw new Error(
        'primary batch post block should end at the success assignment, immediately before its catch',
      );
    }
    // Close the workflow's `try` with an empty finally so the sandbox
    // compiles; it adds no behavior, and the fake createReview succeeds so
    // the catch path never runs here.
    return `${postScript.slice(blockStart, blockEnd)}\n} finally {}`;
  }

  /** Execute the primary batch-post block against a recording fake Octokit. */
  async function runPrimaryPost(
    pairsToPost: Pair[],
  ): Promise<{ createReviewCalls: CreateReviewCall[]; postedInline: number }> {
    const createReviewCalls: CreateReviewCall[] = [];
    const github = {
      rest: {
        pulls: {
          createReview: (params: {
            commit_id: string;
            comments: Array<Record<string, unknown>>;
          }) => {
            createReviewCalls.push({
              commit_id: params.commit_id,
              comments: params.comments,
            });
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
      github,
      owner: 'acme',
      repo: 'widget',
      number: 42,
      headSha: 'sha-1',
      pairsToPost,
      core: { warning: () => {}, info: () => {} },
    };
    vm.createContext(sandbox);
    vm.runInContext(
      [
        // The primary-post block strips internal keys at its createReview
        // boundary via this helper; the block slice itself does not contain
        // the definition, so it is loaded alongside it.
        extractFunctionSource(postScript, 'reviewCommentPayload'),
        'let postedInline = 0;',
        '__RESULT__ = (async () => {',
        primaryPostBlock(),
        '  return { postedInline };',
        '})();',
      ].join('\n'),
      sandbox,
      { timeout: VM_TIMEOUT_MS },
    );
    const settled = (await sandbox['__RESULT__']) as { postedInline: number };
    return { createReviewCalls, postedInline: settled.postedInline };
  }

  // ------------------------------------------------------------------
  // B1-c: the payload helper, directly, for each boundary case.
  // ------------------------------------------------------------------
  describe('reviewCommentPayload boundary cases', () => {
    let payloadOf: (comment: InternalComment) => Record<string, unknown>;

    beforeAll(() => {
      const sandbox: Record<string, unknown> = {};
      vm.createContext(sandbox);
      vm.runInContext(
        extractFunctionSource(postScript, 'reviewCommentPayload'),
        sandbox,
        { timeout: VM_TIMEOUT_MS },
      );
      const fn = asVmFunction(sandbox['reviewCommentPayload']);
      payloadOf = (comment) => asRecord(fn(comment));
    });

    it('transmits a single-line comment with exactly the always-required fields', () => {
      const payload = payloadOf(singleLineComment('high'));
      expect(sortedKeys(payload)).toEqual(BASE_KEYS);
      expect(payload).toEqual({
        path: 'b.ts',
        line: 4,
        side: 'RIGHT',
        body: '<!-- ocr-fp:ocr-run-1-1-def -->\n> single',
      });
      expect('_severity' in payload).toBe(false);
    });

    it('transmits a multi-line comment with the range fields added', () => {
      const payload = payloadOf(multiLineComment('low'));
      expect(sortedKeys(payload)).toEqual([...BASE_KEYS, ...RANGE_KEYS].sort());
      expect(payload).toEqual({
        path: 'a.ts',
        line: 9,
        side: 'RIGHT',
        body: '<!-- ocr-fp:ocr-run-1-0-abc -->\n> multi',
        start_line: 3,
        start_side: 'RIGHT',
      });
      expect('_severity' in payload).toBe(false);
    });

    it('drops the internal severity when it is absent from the comment', () => {
      const comment = singleLineComment('high');
      delete comment._severity;
      const payload = payloadOf(comment);
      expect(sortedKeys(payload)).toEqual(BASE_KEYS);
      expect('_severity' in payload).toBe(false);
    });

    it('drops the internal severity when it is the fail-safe value unknown', () => {
      const payload = payloadOf(singleLineComment('unknown'));
      expect(sortedKeys(payload)).toEqual(BASE_KEYS);
      expect('_severity' in payload).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // B1-b: the primary batch post transmits the allow-listed payload.
  // ------------------------------------------------------------------
  describe('primary batch post', () => {
    it('transmits comments whose key set is exactly the permitted set', async () => {
      const result = await runPrimaryPost([
        internalPair(multiLineComment('high')),
        internalPair(singleLineComment('low')),
      ]);

      expect(result.createReviewCalls.length).toBe(1);
      expect(result.postedInline).toBe(2);
      const [multi, single] = result.createReviewCalls[0].comments;
      expect(sortedKeys(multi)).toEqual([...BASE_KEYS, ...RANGE_KEYS].sort());
      expect(sortedKeys(single)).toEqual(BASE_KEYS);
    });

    it('does not transmit the internal _severity sort key', async () => {
      const result = await runPrimaryPost([
        internalPair(singleLineComment('critical')),
      ]);

      const [comment] = result.createReviewCalls[0].comments;
      expect('_severity' in comment).toBe(false);
      expect(comment).not.toHaveProperty('_severity');
    });
  });

  // ------------------------------------------------------------------
  // B1-d: severity ordering is unchanged by the payload allow-list.
  // ------------------------------------------------------------------
  describe('severity ordering through the primary batch post', () => {
    it('posts mixed-severity findings in severity-priority order after stripping', async () => {
      // Load the REAL sorter the workflow ships.
      const sortSandbox: Record<string, unknown> = {
        String,
        Number,
        Math,
        Array,
      };
      vm.createContext(sortSandbox);
      vm.runInContext(
        [
          extractFunctionSource(postScript, 'severityRank'),
          extractFunctionSource(postScript, 'sortInlineComments'),
        ].join('\n'),
        sortSandbox,
        { timeout: VM_TIMEOUT_MS },
      );
      const sortFn = asVmFunction(sortSandbox['sortInlineComments']);

      const bySeverity: Array<[string, string | undefined]> = [
        ['low.ts', 'low'],
        ['crit.ts', 'critical'],
        ['unk.ts', undefined],
        ['med.ts', 'medium'],
        ['high.ts', 'high'],
      ];
      const pairs = bySeverity.map(([path, severity]) => {
        const comment =
          severity === undefined
            ? { ...singleLineComment('low'), path, body: path }
            : { ...singleLineComment(severity), path, body: path };
        if (severity === undefined) delete comment._severity;
        return internalPair(comment);
      });
      const sorted = sortFn(pairs) as Pair[];
      const sortedPaths = sorted.map((p) => asString(p.comment.path));
      // The workflow's documented priority: critical, high, medium, unknown
      // (fail-safe above low), low.
      expect(sortedPaths).toEqual([
        'crit.ts',
        'high.ts',
        'med.ts',
        'unk.ts',
        'low.ts',
      ]);

      // Run the REAL primary-post block on the sorted pairs — the same
      // hand-off the workflow performs — and inspect the transmitted order.
      const result = await runPrimaryPost(sorted);

      expect(result.createReviewCalls.length).toBe(1);
      const transmittedPaths = result.createReviewCalls[0].comments.map((c) =>
        asString(c['path']),
      );
      // The transmitted order is the severity-priority order: stripping the
      // sort key at the boundary does not reorder the batch.
      expect(transmittedPaths).toEqual(sortedPaths);
      for (const comment of result.createReviewCalls[0].comments) {
        expect('_severity' in comment).toBe(false);
      }
    });
  });
});
