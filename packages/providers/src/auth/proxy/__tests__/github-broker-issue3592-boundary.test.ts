/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boundary coverage for issue.edit project arrays.
 *
 * @plan project-plans/issue3592.md
 * @requirement AC-1
 * @issue 3592
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const realNodeUtil = { ...(await import('node:util')) };
const calls: string[][] = [];

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => typeof entry === 'string')
  );
}

async function recordingExecFile(
  file: unknown,
  args: unknown,
  _options?: unknown,
): Promise<{ stdout: string; stderr: string }> {
  if (file !== 'gh' || !isStringArray(args)) {
    throw new Error('Expected a gh invocation with string argv');
  }
  calls.push([...args]);
  const stdout = args.join(' ').includes('projectItems')
    ? JSON.stringify({
        data: {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  { project: { title: 'Project One' } },
                  { project: { title: 'Project Two' } },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      })
    : '';
  return { stdout, stderr: '' };
}

void mock.module('node:util', () => ({
  ...realNodeUtil,
  promisify: () => recordingExecFile,
}));

let executeGitHubOp: typeof import('../github-broker.js').executeGitHubOp;
let validateIssueEditParams: typeof import('../github-broker-multistep-ops.js').validateIssueEditParams;

describe('issue.edit addProject array boundary', () => {
  beforeAll(async () => {
    ({ executeGitHubOp } = await import('../github-broker.js'));
    ({ validateIssueEditParams } = await import(
      '../github-broker-multistep-ops.js'
    ));
  });

  beforeEach(() => {
    calls.length = 0;
  });

  /**
   * @plan project-plans/issue3592.md
   * @requirement AC-1
   * @issue 3592
   */
  it('accepts a non-empty array of project titles during broker validation', () => {
    const result = validateIssueEditParams({
      number: 3592,
      addProject: ['Project One', 'Project Two'],
    });

    expect(result).toBeNull();
  });

  /**
   * @plan project-plans/issue3592.md
   * @requirement AC-1
   * @issue 3592
   */
  it('rejects an empty array of project titles during broker validation', () => {
    const result = validateIssueEditParams({
      number: 3592,
      addProject: [],
    });

    expect(result).toStrictEqual({
      code: 'INVALID_PARAM',
      message: 'Parameter addProject must be a non-empty array of strings',
    });
  });

  /**
   * @plan project-plans/issue3592.md
   * @requirement AC-1
   * @issue 3592
   */
  it('dispatches each project title and performs the verification read', async () => {
    const result = await executeGitHubOp(
      'issue.edit',
      {
        number: 3592,
        addProject: ['Project One', 'Project Two'],
        repo: 'vybestack/llxprt-code',
      },
      new AbortController().signal,
    );

    expect(result).toStrictEqual({ number: 3592, type: null });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toStrictEqual([
      'issue',
      'edit',
      '3592',
      '--add-project',
      'Project One',
      '--add-project',
      'Project Two',
      '--repo',
      'vybestack/llxprt-code',
    ]);
    expect(calls[1].join(' ')).toContain('projectItems');
  });
});
