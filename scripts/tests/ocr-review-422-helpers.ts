/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vm from 'node:vm';
import { extractFunctionSource } from './ocr-review-workflow-helpers.ts';
import { asRecord, asVmFunction } from './typed-test-helpers.ts';

// Shared harness for the issue #2930 HTTP 422 line-resolution grouping suites.
//
// Security note: the vm.runInContext calls here execute JavaScript extracted
// from the trusted, version-controlled ocr-review.yml workflow. This is
// repository content read from the checked-out HEAD, never user or PR input.

export const VM_TIMEOUT_MS = 5000;

export interface HunkRange {
  start: number;
  end: number;
}

export interface HunkInventory {
  ranges: HunkRange[];
  complete: boolean;
  additions: number;
  deletions: number;
}

export interface DiffInventory {
  files: Map<string, HunkRange[]>;
  known: Set<string>;
  complete: boolean;
}

export interface ReviewComment {
  path: string;
  line?: number | null;
  start_line?: number | null;
  side?: string;
  body?: string;
}

export interface Pair {
  comment: ReviewComment;
  finding: Record<string, unknown>;
}

export interface RegroupResult {
  posted: number;
  invalidPairs: Pair[];
  remaining: Pair[];
  /**
   * True when a grouped write was sent and threw. The write may still have
   * landed, so the caller must re-read what exists before reposting.
   */
  secondaryFailed: boolean;
}

export interface ListFilesEntry {
  filename: string;
  patch?: string;
  additions?: number;
  deletions?: number;
}

export interface CreateReviewCall {
  commit_id: string;
  comments: ReviewComment[];
}

export interface FakeGithubOptions {
  pages?: ListFilesEntry[][];
  headSha?: string;
  createReviewError?: Error;
  listFilesError?: Error;
}

export interface Harness {
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
export function loadHarness(
  postScript: string,
  options: FakeGithubOptions = {},
): Harness {
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
  const lastFunctionStart = postScript.indexOf(lastFunction);
  if (lastFunctionStart < blockStart) {
    throw new Error(
      'regroupLineResolutionFailure should follow LINE_RESOLUTION_PATTERNS contiguously',
    );
  }
  const blockEnd = lastFunctionStart + lastFunction.length;
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

export function pair(comment: ReviewComment, id = comment.path): Pair {
  return { comment, finding: { path: comment.path, id } };
}

// A single 10-line context hunk covering a.ts lines 1-10, with the change
// totals GitHub would report for it (no additions, no deletions).
export const PATCH = [
  '@@ -1,10 +1,10 @@',
  ' a',
  ' b',
  ' c',
  ' d',
  ' e',
  ' f',
  ' g',
  ' h',
  ' i',
  ' j',
].join(String.fromCharCode(10));
export const A_TS: ListFilesEntry = {
  filename: 'a.ts',
  patch: PATCH,
  additions: 0,
  deletions: 0,
};
