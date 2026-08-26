/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the multi-step mutating operations: issue.edit and
 * pr.resolve-thread. These are the pair that retires `gh api` from the
 * workflow, so the call sequences are the thing worth pinning.
 *
 * No test mutates a real repository. The gh runner is a recording stub, so
 * assertions are on the exact argv sequence issued — which is where the
 * defects would actually be.
 *
 * @plan PLAN-20260731-GHBROKER.P11
 * @requirement REQ-002, REQ-008, REQ-009, REQ-012, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import { describe, it, expect } from 'bun:test';
import { OP_REGISTRY } from '../github-broker-ops.js';
import {
  buildIssueEditArgv,
  executeIssueEdit,
  executeResolveThread,
  hasCliEditFields,
} from '../github-broker-multistep-ops.js';

/**
 * Records every argv the operation issues and replies with canned GraphQL
 * payloads keyed by a fragment of the query.
 */
function makeRunner(replies: Array<[string, unknown]> = []): {
  run: (a: readonly string[], o?: unknown) => Promise<unknown>;
  calls: string[][];
} {
  const calls: string[][] = [];
  const run = async (argv: readonly string[]): Promise<unknown> => {
    calls.push([...argv]);
    const joined = argv.join(' ');
    for (const [fragment, payload] of replies) {
      if (joined.includes(fragment)) return payload;
    }
    return {};
  };
  return { run, calls };
}

const ISSUE_TYPES_REPLY: [string, unknown] = [
  'issueTypes',
  {
    data: {
      repository: {
        issueTypes: {
          nodes: [
            { id: 'IT_bug', name: 'Bug' },
            { id: 'IT_feat', name: 'Feature' },
          ],
        },
      },
    },
  },
];

const ISSUE_NODE_REPLY: [string, unknown] = [
  'issue(number:$number)',
  { data: { repository: { issue: { id: 'I_kwDO123' } } } },
];

function isIssueEditCall(call: readonly string[]): boolean {
  return call[0] === 'issue' && call[1] === 'edit';
}

function isRepoViewCall(call: readonly string[]): boolean {
  return call[0] === 'repo' && call[1] === 'view';
}

describe('issue.edit (multi-step)', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-012
   */
  it('is registered, mutating, and supplies an execute function', () => {
    const d = OP_REGISTRY['issue.edit'];
    expect(d).toBeDefined();
    expect(d.mutating).toBe(true);
    expect(typeof d.execute).toBe('function');
  });

  /**
   * gh has no issue-type flag, so type must never appear in CLI argv.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('never puts type into gh issue edit argv', () => {
    const argv = buildIssueEditArgv({
      number: 5,
      type: 'Feature',
      addLabel: ['bug'],
    });
    expect(argv.join(' ')).not.toContain('Feature');
    expect(argv).not.toContain('--type');
    expect(argv).toContain('--add-label');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('detects whether any CLI-supported field was supplied', () => {
    expect(hasCliEditFields({ number: 1, type: 'Bug' })).toBe(false);
    expect(hasCliEditFields({ number: 1, addLabel: ['x'] })).toBe(true);
    expect(hasCliEditFields({ number: 1, title: 'T' })).toBe(true);
  });

  /**
   * Labels alone must not trigger any GraphQL work.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('issues only the CLI call when no type is requested', async () => {
    const { run, calls } = makeRunner();
    await executeIssueEdit(
      { number: 7, addLabel: ['security'], repo: 'o/n' },
      run,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 2)).toStrictEqual(['issue', 'edit']);
    expect(calls[0]).not.toContain('graphql');
  });

  /**
   * Type alone must skip the CLI call entirely.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('skips gh issue edit when only type is supplied', async () => {
    const { run, calls } = makeRunner([ISSUE_TYPES_REPLY, ISSUE_NODE_REPLY]);
    await executeIssueEdit({ number: 7, type: 'Feature', repo: 'o/n' }, run);
    expect(calls.some(isIssueEditCall)).toBe(false);
    expect(calls.some((c) => c.join(' ').includes('updateIssue'))).toBe(true);
  });

  /**
   * The whole point of this op: setting an issue type without the caller
   * writing a GraphQL query.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-008
   */
  it('resolves the type name to an id and issues updateIssue', async () => {
    const { run, calls } = makeRunner([ISSUE_TYPES_REPLY, ISSUE_NODE_REPLY]);
    const out = await executeIssueEdit(
      { number: 7, type: 'Feature', repo: 'o/n' },
      run,
    );
    const mutation = calls.find((c) => c.join(' ').includes('updateIssue'));
    expect(mutation).toBeDefined();
    expect(mutation!.join(' ')).toContain('typeId=IT_feat');
    expect(mutation!.join(' ')).toContain('id=I_kwDO123');
    expect(out.type).toBe('Feature');
  });

  /**
   * Matching must not be case-sensitive; "feature" is what a model writes.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-008
   */
  it('matches the type name case-insensitively', async () => {
    const { run, calls } = makeRunner([ISSUE_TYPES_REPLY, ISSUE_NODE_REPLY]);
    await executeIssueEdit({ number: 7, type: 'feature', repo: 'o/n' }, run);
    const mutation = calls.find((c) => c.join(' ').includes('updateIssue'));
    expect(mutation!.join(' ')).toContain('typeId=IT_feat');
  });

  /**
   * Silently doing nothing is the worst outcome: the caller would believe
   * the type was set.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('fails fast listing available types when the type is unknown', async () => {
    const { run } = makeRunner([ISSUE_TYPES_REPLY, ISSUE_NODE_REPLY]);
    await expect(
      executeIssueEdit({ number: 7, type: 'Epic', repo: 'o/n' }, run),
    ).rejects.toThrow(/Unknown issue type "Epic".*Bug, Feature/s);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-009
   */
  it('resolves the current repo when repo is omitted', async () => {
    const { run, calls } = makeRunner([
      ['repo view', { owner: { login: 'acoliver' }, name: 'proj' }],
      ISSUE_TYPES_REPLY,
      ISSUE_NODE_REPLY,
    ]);
    await executeIssueEdit({ number: 7, type: 'Bug' }, run);
    expect(calls.some(isRepoViewCall)).toBe(true);
    const typesCall = calls.find((c) => c.join(' ').includes('issueTypes'));
    expect(typesCall!.join(' ')).toContain('owner=acoliver');
  });
});

describe('pr.resolve-thread (multi-step)', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-012
   */
  it('is registered, mutating, and supplies an execute function', () => {
    const d = OP_REGISTRY['pr.resolve-thread'];
    expect(d).toBeDefined();
    expect(d.mutating).toBe(true);
    expect(typeof d.execute).toBe('function');
  });

  /**
   * ResolveReviewThreadInput accepts only clientMutationId and threadId.
   *
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-002
   */
  it('sends only threadId and reports resolution', async () => {
    const { run, calls } = makeRunner([
      [
        'resolveReviewThread',
        {
          data: {
            resolveReviewThread: {
              thread: { id: 'PRRT_x', isResolved: true },
            },
          },
        },
      ],
    ]);
    const out = await executeResolveThread({ threadId: 'PRRT_x' }, run);
    expect(calls).toHaveLength(1);
    const joined = calls[0].join(' ');
    expect(joined).toContain('resolveReviewThread');
    expect(joined).toContain('threadId=PRRT_x');
    expect(out).toStrictEqual({ threadId: 'PRRT_x', isResolved: true });
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P11
   * @requirement REQ-013
   */
  /**
   * Reporting isResolved: false for a missing payload made "the mutation
   * did not happen" indistinguishable from "the thread is still
   * unresolved". A caller driving a review loop would silently skip the
   * thread instead of retrying, so the ambiguity now surfaces.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-013
   */
  it('fails when the mutation returns no resolution state', async () => {
    const { run } = makeRunner();
    await expect(
      executeResolveThread({ threadId: 'PRRT_y' }, run),
    ).rejects.toThrow(/no resolution state/);
  });

  it('reports isResolved false when the mutation says so explicitly', async () => {
    const { run } = makeRunner([
      [
        'resolveReviewThread',
        { data: { resolveReviewThread: { thread: { isResolved: false } } } },
      ],
    ]);
    const out = await executeResolveThread({ threadId: 'PRRT_z' }, run);
    expect(out.isResolved).toBe(false);
  });
});
