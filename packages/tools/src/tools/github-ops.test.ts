/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the github operation catalog (issue #3030).
 *
 * The catalog is the single source of truth for what each operation accepts,
 * so these tests pin its structural invariants: every op supports cross-repo,
 * the order is stable, mutating ops are exactly the writes, required params
 * are always accepted, and the validation/description helpers produce
 * actionable, op-naming messages.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012
 */

import { describe, it, expect } from 'bun:test';
import {
  GITHUB_OP_SPECS,
  GITHUB_SUPPORTED_OPS,
  GITHUB_MUTATING_OPS,
  describeGithubOp,
  describeGithubOpParams,
  validateGithubOpParams,
  validateGithubParamValue,
} from './github-ops.js';

/**
 * The canonical operation order the tool has always published. Pinned here
 * independently of `github.ts` so a reorder is caught.
 */
const EXPECTED_OP_ORDER = [
  'issue.view',
  'issue.list',
  'issue.create',
  'issue.comment',
  'issue.edit',
  'issue.close',
  'pr.view',
  'pr.list',
  'pr.diff',
  'pr.checks',
  'pr.reviews',
  'pr.create',
  'pr.comment',
  'pr.edit',
  'pr.ready',
  'pr.resolve-thread',
  'search.issues',
  'search.prs',
  'run.list',
  'label.list',
  'label.create',
] as const;

/** The ten write operations. */
const EXPECTED_MUTATING = [
  'issue.create',
  'issue.comment',
  'issue.edit',
  'issue.close',
  'pr.create',
  'pr.comment',
  'pr.edit',
  'pr.ready',
  'pr.resolve-thread',
  'label.create',
] as const;

function isUnexpectedMutatingOperation(
  operation: (typeof GITHUB_SUPPORTED_OPS)[number],
  expectedMutating: readonly string[],
): boolean {
  return (
    GITHUB_MUTATING_OPS.has(operation) && !expectedMutating.includes(operation)
  );
}

describe('github operation catalog', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-009
   */
  it('every op declares repo (cross-repo is universal)', () => {
    for (const [, spec] of Object.entries(GITHUB_OP_SPECS)) {
      expect(spec.params).toHaveProperty('repo');
    }
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('GITHUB_SUPPORTED_OPS equals the op keys and matches the pinned order', () => {
    expect(GITHUB_SUPPORTED_OPS).toStrictEqual(Object.keys(GITHUB_OP_SPECS));
    expect(GITHUB_SUPPORTED_OPS).toStrictEqual([...EXPECTED_OP_ORDER]);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-012
   */

  it('GITHUB_MUTATING_OPS is exactly the ten write ops and no read', () => {
    expect([...GITHUB_MUTATING_OPS].sort()).toStrictEqual(
      [...EXPECTED_MUTATING].sort(),
    );
    const expectedMutating: string[] = [...EXPECTED_MUTATING];
    const unexpectedMutating = GITHUB_SUPPORTED_OPS.filter((operation) =>
      isUnexpectedMutatingOperation(operation, expectedMutating),
    );
    expect(unexpectedMutating).toStrictEqual([]);
  });

  /**
   * A required parameter the op does not accept is unsatisfiable, so the
   * catalog must never declare one.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('every required entry is a key of that op params', () => {
    for (const [, spec] of Object.entries(GITHUB_OP_SPECS)) {
      for (const required of spec.required) {
        expect(spec.params).toHaveProperty(required);
      }
    }
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('validateGithubOpParams flags a missing required param naming the op', () => {
    const msg = validateGithubOpParams('issue.comment', { number: 1 });
    expect(msg).not.toBeNull();
    expect(msg).toContain('issue.comment');
    expect(msg).toContain('body');
    expect(msg).toContain('required');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('validateGithubOpParams flags an unknown param and lists accepted params', () => {
    const msg = validateGithubOpParams('issue.comment', {
      number: 1,
      body: 'x',
      titel: 'y',
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('titel');
    expect(msg).toContain('number');
    expect(msg).toContain('body');
    expect(msg).toContain('repo');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('validateGithubOpParams returns null for a valid call', () => {
    expect(
      validateGithubOpParams('issue.comment', { number: 1, body: 'x' }),
    ).toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('validateGithubOpParams names an unknown operation', () => {
    const msg = validateGithubOpParams('issue.destroy', {});
    expect(msg).not.toBeNull();
    expect(msg).toContain('issue.destroy');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('describeGithubOp contains the op name and every required param', () => {
    for (const op of GITHUB_SUPPORTED_OPS) {
      const line = describeGithubOp(op);
      expect(line).toContain(op);
      for (const required of GITHUB_OP_SPECS[op].required) {
        expect(line).toContain(required);
      }
    }
  });

  /**
   * describeGithubOpParams must list every accepted param for each op so the
   * tool description and error messages stay self-describing.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-008
   */
  it('describeGithubOpParams lists every accepted param for each op', () => {
    for (const op of GITHUB_SUPPORTED_OPS) {
      const line = describeGithubOpParams(op);
      expect(line).toContain('accepts');
      for (const param of Object.keys(GITHUB_OP_SPECS[op].params)) {
        expect(line).toContain(param);
      }
    }
  });
});

describe('validateGithubParamValue (per-kind value rules)', () => {
  /**
   * The catalog is the single source of truth for per-kind value rules, so
   * the tool boundary rejects invalid values the broker would reject, with
   * the SAME messages. These tests pin the shared messages the broker's own
   * tests also assert on.
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002, REQ-008
   */
  it('a valid value of each kind returns null', () => {
    expect(validateGithubParamValue('repo', 'owner/name', 'repo')).toBeNull();
    expect(validateGithubParamValue('number', 1, 'number')).toBeNull();
    expect(validateGithubParamValue('comments', true, 'boolean')).toBeNull();
    expect(validateGithubParamValue('state', 'merged', 'state')).toBeNull();
    expect(validateGithubParamValue('state', 'open', 'stateIssue')).toBeNull();
    expect(validateGithubParamValue('label', 'bug', 'label')).toBeNull();
    expect(validateGithubParamValue('label', ['bug', 'x'], 'label')).toBeNull();
    expect(
      validateGithubParamValue('threadId', 'PRRT_abc', 'threadId'),
    ).toBeNull();
    expect(validateGithubParamValue('body', 'text', 'body')).toBeNull();
    expect(validateGithubParamValue('freetext', 'text', 'freetext')).toBeNull();
    expect(validateGithubParamValue('limit', 30, 'limit')).toBeNull();
    expect(
      validateGithubParamValue('reason', 'completed', 'closeReason'),
    ).toBeNull();
    expect(validateGithubParamValue('color', '#aabbcc', 'color')).toBeNull();
    expect(
      validateGithubParamValue('assignee', 'alice', 'assignee'),
    ).toBeNull();
    expect(validateGithubParamValue('milestone', 'm1', 'milestone')).toBeNull();
    expect(validateGithubParamValue('project', 'p1', 'project')).toBeNull();
    expect(validateGithubParamValue('base', 'main', 'branch')).toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('repo rejects a value that is not owner/name', () => {
    expect(validateGithubParamValue('repo', 'not-a-repo', 'repo')).toContain(
      'must be "owner/name"',
    );
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('number rejects a non-integer', () => {
    expect(validateGithubParamValue('number', 1.5, 'number')).toContain(
      'must be a positive integer',
    );
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('limit rejects above 100', () => {
    expect(validateGithubParamValue('limit', 101, 'limit')).toContain(
      'must not exceed 100',
    );
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('state rejects a value outside the allowed list', () => {
    const msg = validateGithubParamValue('state', 'merged', 'stateIssue');
    expect(msg).not.toBeNull();
    expect(msg).toContain('must be one of');
    expect(msg).toContain('open');
    expect(msg).toContain('closed');
    expect(msg).toContain('all');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('state (full) accepts merged', () => {
    expect(validateGithubParamValue('state', 'merged', 'state')).toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('label array rejects an element beginning with a dash', () => {
    expect(validateGithubParamValue('label', ['bug', '-x'], 'label')).toContain(
      "may not contain a value beginning with '-'",
    );
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('a top-level string beginning with a dash is rejected (flag injection)', () => {
    expect(validateGithubParamValue('body', '-x', 'body')).toContain(
      "must not begin with '-'",
    );
  });
});

describe('validateGithubOpParams value enforcement (issue #3030)', () => {
  /**
   * The whole point: issue.list uses the stateIssue kind (open/closed/all),
   * so "merged" must be rejected at the tool boundary, not after a broker
   * round trip. pr.list uses the state kind and accepts "merged".
   *
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002, REQ-008
   */
  it('issue.list rejects state:merged naming the allowed values', () => {
    const msg = validateGithubOpParams('issue.list', { state: 'merged' });
    expect(msg).not.toBeNull();
    expect(msg).toContain('must be one of');
    expect(msg).toContain('open');
    expect(msg).toContain('closed');
    expect(msg).toContain('all');
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('pr.list accepts state:merged', () => {
    expect(validateGithubOpParams('pr.list', { state: 'merged' })).toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('issue.view rejects a non-integer number', () => {
    expect(
      validateGithubOpParams('issue.view', { number: 1.5 }),
    ).not.toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('issue.list rejects limit above 100', () => {
    expect(validateGithubOpParams('issue.list', { limit: 101 })).not.toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('issue.view rejects a bad repo', () => {
    expect(
      validateGithubOpParams('issue.view', { number: 1, repo: 'not-a-repo' }),
    ).not.toBeNull();
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P15
   * @requirement REQ-002
   */
  it('returns null for a valid call of each kind', () => {
    expect(
      validateGithubOpParams('issue.list', { state: 'open', limit: 5 }),
    ).toBeNull();
    expect(
      validateGithubOpParams('issue.view', { number: 1, repo: 'o/n' }),
    ).toBeNull();
    expect(
      validateGithubOpParams('pr.list', { state: 'merged', limit: 10 }),
    ).toBeNull();
  });
});
