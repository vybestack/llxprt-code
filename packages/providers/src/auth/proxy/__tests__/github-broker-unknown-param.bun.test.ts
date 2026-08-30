/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for issue #3019: unknown-parameter rejections are self-correcting.
 *
 * When a caller passes a parameter an operation does not accept (e.g.
 * `number` on `pr.resolve-thread`), the broker must name the offending
 * parameter AND the parameters the operation DOES accept, plus the required
 * ones when the descriptor declares any. The old `Unknown parameter: <key>`
 * message named only what was wrong, leaving the caller no recovery path —
 * and when only `number` was supplied it actively hid the missing required
 * `threadId`.
 *
 * These are behavioural tests driven through the real dispatch entry point
 * and the real per-op validators. No mocks: validation runs before any `gh`
 * process is spawned, so the dispatch tests never shell out.
 *
 * @plan issue-3019-github-unknown-parameter
 * @requirement AB1
 * @issue 3019
 */

import { describe, it, expect } from 'bun:test';
import { executeGitHubOp } from '../github-broker.js';
import { validateResolveThreadParams } from '../github-broker-multistep-ops.js';
import {
  validateIssueListParams,
  validateIssueViewParams,
} from '../github-broker-issue-ops.js';

/** Extracts a message from any thrown value without type assertions. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe('issue #3019: self-correcting unknown-parameter rejection', () => {
  // ─── Dispatch path (validation before any gh spawn) ───────────────────

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('executeGitHubOp pr.resolve-thread with number names accepted + required params', async () => {
    const signal = new AbortController().signal;
    let thrown: unknown = undefined;
    try {
      await executeGitHubOp(
        'pr.resolve-thread',
        { threadId: 'PRRT_x', number: 3018 },
        signal,
      );
    } catch (error) {
      thrown = error;
    }
    const message = errorMessage(thrown);
    // The dispatch path names the offending parameter, the accepted set
    // (with the required `threadId`), and the catalog-backed redirect:
    // `number` is not taken by pr.resolve-thread but IS taken by the ops
    // that take a PR/issue number, so the caller learns where it belongs.
    expect(message).toBe(
      'Unknown parameter: number. Accepted parameters: threadId, repo. Required: threadId. That parameter is accepted by issue.view, issue.comment, issue.edit, issue.close, pr.view, pr.diff, pr.checks, pr.reviews, pr.comment, pr.edit, pr.ready.',
    );
  });

  /**
   * The case the old message actively hid: the caller passed only `number`,
   * no `threadId`. The unknown-parameter check still runs first, and the new
   * message reveals the required `threadId`.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('executeGitHubOp pr.resolve-thread with number only still reveals the accepted params', async () => {
    const signal = new AbortController().signal;
    let thrown: unknown = undefined;
    try {
      await executeGitHubOp('pr.resolve-thread', { number: 3018 }, signal);
    } catch (error) {
      thrown = error;
    }
    const message = errorMessage(thrown);
    expect(message).toBe(
      'Unknown parameter: number. Accepted parameters: threadId, repo. Required: threadId. That parameter is accepted by issue.view, issue.comment, issue.edit, issue.close, pr.view, pr.diff, pr.checks, pr.reviews, pr.comment, pr.edit, pr.ready.',
    );
  });

  // ─── Per-op validators ───────────────────────────────────────────────

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('validateResolveThreadParams returns INVALID_PARAM listing accepted + required params', () => {
    const result = validateResolveThreadParams({
      threadId: 'PRRT_x',
      number: 3018,
    });
    expect(result?.code).toBe('INVALID_PARAM');
    expect(result?.message).toBe(
      'Unknown parameter: number. Accepted parameters: threadId, repo. Required: threadId. That parameter is accepted by issue.view, issue.comment, issue.edit, issue.close, pr.view, pr.diff, pr.checks, pr.reviews, pr.comment, pr.edit, pr.ready.',
    );
  });

  /**
   * Ops that declare no required params list accepted params but NO
   * `Required:` clause.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('validateIssueListParams lists accepted params with no Required clause', () => {
    const result = validateIssueListParams({ bogus: true });
    expect(result?.code).toBe('INVALID_PARAM');
    // `bogus` is accepted by NO operation, so the issue-3407 redirect sentence
    // is omitted entirely — including its separating space. Asserting the
    // exact string pins that a missing redirect cannot leave trailing
    // whitespace on the message.
    expect(result?.message).toBe(
      'Unknown parameter: bogus. Accepted parameters: search, state, label, limit, repo.',
    );
  });

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('validateIssueViewParams lists number, comments, repo', () => {
    const result = validateIssueViewParams({
      number: 135,
      bogusParam: 'x',
    });
    expect(result?.code).toBe('INVALID_PARAM');
    expect(result?.message).toContain(
      'Accepted parameters: number, comments, repo',
    );
  });

  // ─── Regression guards ───────────────────────────────────────────────

  /**
   * Valid params still validate to null; an invalid VALUE keeps its existing
   * per-kind message and is NOT rewritten to the accepted-parameter message.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('regression: valid pr.resolve-thread passes, and an invalid repo value keeps its own message', () => {
    expect(
      validateResolveThreadParams({
        threadId: 'PRRT_x',
        repo: 'owner/name',
      }),
    ).toBeNull();

    const invalidValue = validateResolveThreadParams({
      threadId: 'PRRT_x',
      repo: 'not a repo',
    });
    expect(invalidValue?.code).toBe('INVALID_PARAM');
    // The per-kind repo message must survive, not be replaced.
    expect(invalidValue?.message).toContain('must be "owner/name"');
    expect(invalidValue?.message).not.toContain('Accepted parameters');
  });
});

describe('issue #3019 (FIX 4): prototype-chain names are rejected, not accepted', () => {
  // `constructor`, `toString` and `__proto__` are inherited from
  // Object.prototype, so an `in`-operator unknown-key check would treat them
  // as known and silently skip them. A valid `threadId` is included so the
  // required-param check does not fire first — isolating the unknown-key
  // rejection to the prototype name itself. Each must be rejected with
  // INVALID_PARAM and the accepted-parameter message.

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('rejects `constructor` as an unknown parameter', () => {
    const result = validateResolveThreadParams({
      threadId: 'PRRT_x',
      constructor: 'x',
    });
    expect(result?.code).toBe('INVALID_PARAM');
    expect(result?.message).toContain('Unknown parameter: constructor');
    expect(result?.message).toContain('Accepted parameters: threadId, repo');
  });

  /**
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('rejects `toString` as an unknown parameter', () => {
    const result = validateResolveThreadParams({
      threadId: 'PRRT_x',
      toString: 'x',
    });
    expect(result?.code).toBe('INVALID_PARAM');
    expect(result?.message).toContain('Unknown parameter: toString');
    expect(result?.message).toContain('Accepted parameters: threadId, repo');
  });

  /**
   * `__proto__` must be a real own enumerable key to be observable: an object
   * literal would mutate the prototype instead of creating an own property.
   * `Object.defineProperty` creates a genuine own data property without
   * changing the object's [[Prototype]], so the unknown-key check sees it.
   *
   * @plan issue-3019-github-unknown-parameter
   * @requirement AB1
   * @issue 3019
   */
  it('rejects an own `__proto__` key as an unknown parameter', () => {
    const params: Record<string, unknown> = { threadId: 'PRRT_x' };
    Object.defineProperty(params, '__proto__', {
      value: 'x',
      enumerable: true,
      configurable: true,
      writable: true,
    });
    // Guard: verify this really is an own key before asserting on it.
    expect(Object.prototype.hasOwnProperty.call(params, '__proto__')).toBe(
      true,
    );
    const result = validateResolveThreadParams(params);
    expect(result?.code).toBe('INVALID_PARAM');
    expect(result?.message).toContain('Unknown parameter: __proto__');
    expect(result?.message).toContain('Accepted parameters: threadId, repo');
  });
});
