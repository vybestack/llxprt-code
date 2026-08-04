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
    expect(message).toContain('Unknown parameter: number');
    expect(message).toContain('Accepted parameters: threadId, repo');
    expect(message).toContain('Required: threadId');
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
    expect(message).toContain('Unknown parameter: number');
    expect(message).toContain('Accepted parameters: threadId, repo');
    expect(message).toContain('Required: threadId');
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
    expect(result?.message).toContain('Unknown parameter: number');
    expect(result?.message).toContain('Accepted parameters: threadId, repo');
    expect(result?.message).toContain('Required: threadId');
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
    expect(result?.message).toContain(
      'Accepted parameters: search, state, label, limit, repo',
    );
    expect(result?.message).not.toContain('Required:');
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
