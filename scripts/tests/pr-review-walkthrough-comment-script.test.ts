/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as fsModule from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  asVmFunction,
  findStep,
  parseWorkflowYaml,
} from './typed-test-helpers.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const WORKFLOW_PATH = '.github/workflows/pr-review.yml';
const STEP_NAME = 'Post walkthrough comment';
const MARKER = '<!-- llxprt-walkthrough -->';
const ISSUE_NUMBER = 123;
const OWNER = 'vybestack';
const REPO = 'llxprt-code';
const BODY = '# walkthrough\nprepared by the pipeline';

const asyncFunctionConstructor: unknown = Object.getPrototypeOf(
  async () => {},
).constructor;

function isAsyncFunctionConstructor(
  value: unknown,
): value is new (...args: string[]) => unknown {
  if (typeof value !== 'function') return false;
  const prototype: unknown = Reflect.get(value, 'prototype');
  return prototype !== null && typeof prototype === 'object';
}

if (!isAsyncFunctionConstructor(asyncFunctionConstructor)) {
  throw new Error('expected an async function constructor');
}
const AsyncFunction = asyncFunctionConstructor;

interface CommentRecord {
  readonly id: number;
  readonly body: string;
}

interface GithubCallLog {
  readonly listOptions: unknown[];
  readonly updateCalls: unknown[];
  readonly createCalls: unknown[];
}

interface GithubFake {
  readonly paginate: (
    fn: (options: unknown) => Promise<{ data: readonly CommentRecord[] }>,
    options: unknown,
  ) => Promise<readonly CommentRecord[]>;
  readonly rest: {
    readonly issues: {
      readonly listComments: (
        options: unknown,
      ) => Promise<{ data: readonly CommentRecord[] }>;
      readonly updateComment: (options: unknown) => Promise<unknown>;
      readonly createComment: (
        options: unknown,
      ) => Promise<{ data: { id: number } }>;
    };
  };
}

interface GithubConfig {
  readonly comments?: readonly CommentRecord[];
  readonly paginateError?: unknown;
  readonly update?: (options: unknown) => { data: { id: number } };
  readonly create?: (options: unknown) => { data: { id: number } };
}

/**
 * Build the faked github object granted to the script by actions/github-script.
 * The script under test is the REAL production source; only the runtime boundary
 * (github/core/context/require) is faked, exactly as github-script injects it.
 */
function makeGithub(config: GithubConfig = {}): {
  readonly github: GithubFake;
  readonly calls: GithubCallLog;
} {
  const calls: GithubCallLog = {
    listOptions: [],
    updateCalls: [],
    createCalls: [],
  };
  const defaultUpdate = (): { data: { id: number } } => ({ data: { id: 1 } });
  const defaultCreate = (): { data: { id: number } } => ({ data: { id: 2 } });
  const github: GithubFake = {
    paginate: async (
      fn: (options: unknown) => Promise<{ data: readonly CommentRecord[] }>,
      options: unknown,
    ): Promise<readonly CommentRecord[]> => {
      calls.listOptions.push(options);
      return (await fn(options)).data;
    },
    rest: {
      issues: {
        listComments: async (
          _options: unknown,
        ): Promise<{ data: readonly CommentRecord[] }> => {
          if (config.paginateError !== undefined) {
            throw config.paginateError;
          }
          return { data: config.comments ?? [] };
        },
        updateComment: async (options: unknown): Promise<unknown> => {
          calls.updateCalls.push(options);
          return (config.update ?? defaultUpdate)(options);
        },
        createComment: async (
          options: unknown,
        ): Promise<{ data: { id: number } }> => {
          calls.createCalls.push(options);
          return (config.create ?? defaultCreate)(options);
        },
      },
    },
  };
  return { github, calls };
}

interface CoreFake {
  readonly info: (message: unknown) => void;
  readonly setFailed: (message: unknown) => void;
}

function makeCore(): {
  readonly core: CoreFake;
  readonly info: string[];
  readonly failures: string[];
} {
  const info: string[] = [];
  const failures: string[] = [];
  return {
    core: {
      info: (message: unknown) => {
        info.push(String(message));
      },
      setFailed: (message: unknown) => {
        failures.push(String(message));
      },
    },
    info,
    failures,
  };
}

/**
 * Build an Error carrying a GitHub API HTTP status, the shape octokit rejects
 * with on non-2xx responses.
 */
function octokitError(status: number, message: string): Error {
  const error = new Error(message);
  return Object.assign(error, { status });
}

function reviewContext(issueNumber: number): {
  readonly repo: { readonly owner: string; readonly repo: string };
  readonly issue: { readonly number: number };
} {
  return {
    repo: { owner: OWNER, repo: REPO },
    issue: { number: issueNumber },
  };
}

function makeRequire(): (name: string) => unknown {
  return (name: string): unknown => {
    if (name === 'fs') return fsModule;
    throw new Error(`unexpected require: ${name}`);
  };
}

/**
 * Extract the REAL github-script source from the workflow (never a copy) and
 * execute it the same way actions/github-script does: compile the source as an
 * AsyncFunction and call it with github/context/core/require.
 */
function postStepScript(): string {
  const source = readFileSync(join(ROOT, WORKFLOW_PATH), 'utf8');
  const workflow = parseWorkflowYaml(source);
  const reviewJob = workflow.jobs?.['review'];
  const step = reviewJob ? findStep(reviewJob, STEP_NAME) : undefined;
  const script = step?.with?.['script'];
  if (typeof script !== 'string' || script.trim().length === 0) {
    throw new Error(`${STEP_NAME} should have a non-empty github-script body`);
  }
  return script;
}

async function runScript(
  script: string,
  github: unknown,
  context: unknown,
  core: unknown,
  requireFn: (name: string) => unknown,
): Promise<void> {
  const runner = asVmFunction(
    new AsyncFunction('github', 'context', 'core', 'require', script),
  );
  await runner(github, context, core, requireFn);
}

describe('Post walkthrough comment github-script behavior', () => {
  const script = postStepScript();
  const requireFn = makeRequire();
  let tempDir: string | undefined;
  let commentFile: string | undefined;
  let previousCommentFile: string | undefined;
  let previousCommentMarker: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-walkthrough-comment-'));
    commentFile = join(tempDir, 'comment.md');
    writeFileSync(commentFile, BODY, 'utf8');
    previousCommentFile = process.env.COMMENT_FILE;
    previousCommentMarker = process.env.COMMENT_MARKER;
    process.env.COMMENT_FILE = commentFile;
    process.env.COMMENT_MARKER = MARKER;
  });

  afterEach(() => {
    if (tempDir !== undefined) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (previousCommentFile === undefined) {
      delete process.env.COMMENT_FILE;
    } else {
      process.env.COMMENT_FILE = previousCommentFile;
    }
    if (previousCommentMarker === undefined) {
      delete process.env.COMMENT_MARKER;
    } else {
      process.env.COMMENT_MARKER = previousCommentMarker;
    }
  });

  it('compiles as an AsyncFunction (mirrors actions/github-script)', () => {
    expect(
      () => new AsyncFunction('github', 'context', 'core', 'require', script),
    ).not.toThrow();
  });

  it('updates the matched comment in place when updateComment succeeds', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 11, body: 'unrelated comment' },
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({ comments });
    const { core, info, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.updateCalls).toHaveLength(1);
    expect(calls.updateCalls[0]).toMatchObject({
      owner: OWNER,
      repo: REPO,
      comment_id: 7,
      body: BODY,
    });
    expect(calls.createCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('Updated comment'))).toBe(true);
  });

  it('falls back to createComment when updateComment rejects with 404', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({
      comments,
      update: () => {
        throw octokitError(404, 'Not Found');
      },
    });
    const { core, info, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.createCalls).toHaveLength(1);
    expect(calls.createCalls[0]).toMatchObject({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER,
      body: BODY,
    });
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('404'))).toBe(true);
  });

  it('does not fall back when updateComment rejects with a string status "404"', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({
      comments,
      update: () => {
        throw Object.assign(new Error('Not Found'), { status: '404' });
      },
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(calls.createCalls).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(1);
  });

  it('surfaces a non-404 updateComment failure and never falls back', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({
      comments,
      update: () => {
        throw octokitError(403, 'rate limit exceeded');
      },
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(failures[0]).toContain('rate limit exceeded');
    expect(calls.createCalls).toHaveLength(0);
  });

  it('does not fall back when updateComment fails without a status', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({
      comments,
      update: () => {
        throw new Error('network down');
      },
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(calls.createCalls).toHaveLength(0);
  });

  it('creates a new comment when no comment carries the marker', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 11, body: 'unrelated comment' },
    ];
    const { github, calls } = makeGithub({ comments });
    const { core, info, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.createCalls).toHaveLength(1);
    expect(calls.createCalls[0]).toMatchObject({
      owner: OWNER,
      repo: REPO,
      issue_number: ISSUE_NUMBER,
      body: BODY,
    });
    expect(calls.updateCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('Created comment'))).toBe(true);
  });

  it('surfaces a failing listComments via setFailed with the prefix', async () => {
    const { github } = makeGithub({
      paginateError: octokitError(500, 'comments unavailable'),
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(failures[0]).toContain('comments unavailable');
  });

  it('surfaces a failing createComment on the no-match path via setFailed', async () => {
    const { github } = makeGithub({
      comments: [],
      create: () => {
        throw octokitError(422, 'invalid payload');
      },
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(failures[0]).toContain('invalid payload');
  });

  it('surfaces a failing fallback createComment after a 404 updateComment', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 7, body: `${MARKER}\ncurrent walkthrough` },
    ];
    const { github, calls } = makeGithub({
      comments,
      update: () => {
        throw octokitError(404, 'Not Found');
      },
      create: () => {
        throw octokitError(500, 'fallback failed');
      },
    });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.createCalls).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^Failed to post walkthrough comment:/);
    expect(failures[0]).toContain('fallback failed');
  });

  it('skips with zero API calls when the comment file is missing', async () => {
    if (tempDir === undefined) {
      throw new Error('tempDir should be created in beforeEach');
    }
    process.env.COMMENT_FILE = join(tempDir, 'missing.md');
    const { github, calls } = makeGithub({});
    const { core, info, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.listOptions).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.createCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('not found'))).toBe(true);
  });

  it('skips with zero API calls when the comment marker is unset', async () => {
    delete process.env.COMMENT_MARKER;
    const { github, calls } = makeGithub({});
    const { core, info, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.listOptions).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.createCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('No comment marker set'))).toBe(
      true,
    );
  });

  it('skips with zero API calls when context has no issue number', async () => {
    const { github, calls } = makeGithub({});
    const { core, info, failures } = makeCore();

    await runScript(script, github, reviewContext(0), core, requireFn);

    expect(calls.listOptions).toHaveLength(0);
    expect(calls.updateCalls).toHaveLength(0);
    expect(calls.createCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
    expect(info.some((line) => line.includes('No issue/PR number'))).toBe(true);
  });

  it('updates only the comment that carries the marker among several', async () => {
    const comments: readonly CommentRecord[] = [
      { id: 11, body: 'unrelated comment' },
      { id: 22, body: `${MARKER}\ncurrent walkthrough` },
      { id: 33, body: `${MARKER}\nolder walkthrough` },
    ];
    const { github, calls } = makeGithub({ comments });
    const { core, failures } = makeCore();

    await runScript(
      script,
      github,
      reviewContext(ISSUE_NUMBER),
      core,
      requireFn,
    );

    expect(calls.updateCalls).toHaveLength(1);
    expect(calls.updateCalls[0]).toMatchObject({ comment_id: 22 });
    expect(calls.createCalls).toHaveLength(0);
    expect(failures).toHaveLength(0);
  });
});
