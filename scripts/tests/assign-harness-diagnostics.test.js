/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the assignment test harness's own diagnosability
 * (issue #2688).
 *
 * Background: the nightly release job runs on ubuntu-22.04, a platform no
 * other workflow exercises. When the assign harness broke there, twelve test
 * files failed with nothing but bare assertions like "expected 1 to be +0".
 * The bash scripts had reported their real root cause on stderr, but the
 * harness discarded it: execFileSync only returns stdout, so stderr was
 * unreachable on the success path and the returned object hardcoded
 * `stderr: ''`.
 *
 * A test harness that hides the failure reason turns every environment
 * -specific breakage into an archaeology exercise. These tests pin the
 * contract that makes a failure explain itself.
 *
 * These execute the REAL bash scripts against the stateful fake gh
 * infrastructure adapter and assert observable output, not invocation counts.
 */

import { describe, expect, it } from 'vitest';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makeAssignedEvent,
  daysAgo,
} from './assign-helpers.js';

/**
 * A repo with one issue that is unambiguously stale, so cleanup has real work
 * to do and a failure cannot be confused with a no-op.
 */
function staleRepo(extraState = {}) {
  const state = defaultState();
  state.issues = {
    42: makeIssue({
      number: 42,
      assignees: ['stale-user'],
      labels: ['auto-assigned'],
    }),
  };
  state.events = {
    42: [
      makeAssignedEvent({
        assignee: 'stale-user',
        createdAt: daysAgo(20),
      }),
    ],
  };
  return createFakeRepo({ ...state, ...extraState });
}

describe('assign harness diagnosability (#2688)', () => {
  it('surfaces the script\u2019s own root-cause message when cleanup fails', () => {
    // Model an infrastructure failure of the kind that broke ubuntu-22.04:
    // the script runs, but candidate discovery fails against the API.
    const repo = staleRepo({
      fail_config: { 'repos/test/repo/issues': 'server_error' },
    });

    const result = repo.runCleanup();

    // The failure must be reported...
    expect(result.status).not.toBe(0);
    // ...and it must say WHY, not merely that it happened. Without this the
    // only signal is a downstream "expected 1 to be +0" state assertion.
    expect(result.stderr).toMatch(/Candidate discovery failed/i);
  });

  it('reports the retry trail leading up to a cleanup failure', () => {
    // The scripts retry transient API errors before giving up. Those retry
    // notices are the difference between "something broke" and "the timeline
    // endpoint was failing repeatedly", which is precisely the detail needed
    // to distinguish an environment/toolchain fault from a logic bug.
    const repo = staleRepo({
      fail_config: { 'repos/test/repo/issues/42/timeline': 'server_error' },
    });

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Attempt \d+ failed, retrying/i);
    // The failing endpoint must be identifiable from the output alone.
    expect(result.stderr).toContain('issues/42/timeline');
  });

  it('surfaces the assign script\u2019s root cause on failure', () => {
    // The same contract must hold for assign-issue.sh, not just cleanup.
    const state = defaultState();
    state.issues = { 7: makeIssue({ number: 7 }) };
    const repo = createFakeRepo({
      ...state,
      fail_config: { 'repos/test/repo/issues/7': 'server_error' },
    });

    const result = repo.runAssign({
      issueNumber: 7,
      commenter: 'someone',
      authorAssociation: 'MEMBER',
    });

    // A failing assign run must name the operation that failed, not merely
    // emit some non-empty text. A length check would pass on unrelated noise
    // or a bare stack trace, which is the very ambiguity this issue is about.
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Failed to read issue state for #7/i);
  });
});
