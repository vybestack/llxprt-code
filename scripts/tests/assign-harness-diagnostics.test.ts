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

import { describe, expect, it, vi } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makeAssignedEvent,
  daysAgo,
  EMPTY_FAKE_STATE,
  readFakeState,
} from './assign-helpers.ts';
import {
  CANDIDATE_DISCOVERY_FAILED,
  READ_ISSUE_STATE_PREFIX,
  RETRY_FAILED_SUFFIX,
} from './assign-script-contract.ts';

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
  it('surfaces the script’s own root-cause message when cleanup fails', () => {
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
    // The pinned marker is the script→harness contract (assign-script-contract.ts).
    expect(result.stderr).toMatch(new RegExp(CANDIDATE_DISCOVERY_FAILED, 'i'));
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
    expect(result.stderr).toMatch(
      new RegExp(`Attempt \\d+ ${RETRY_FAILED_SUFFIX}`, 'i'),
    );
    // The failing endpoint must be identifiable from the output alone.
    expect(result.stderr).toContain('issues/42/timeline');
  });

  it('captures stderr from a run that succeeds after a recovered retry', () => {
    // This is the exact shape of the original defect. execFileSync only
    // returns stdout, so stderr on the SUCCESS path was unreachable and the
    // helper hardcoded `stderr: ''`. A transient API error that the retry
    // loop recovers from exits 0 while still warning on stderr -- previously
    // that warning was erased, hiding the fact that the run was degraded.
    const repo = staleRepo({
      fail_config: {
        requests: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 1,
            type: 'server_error',
          },
        ],
      },
    });

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(
      new RegExp(`Attempt \\d+ ${RETRY_FAILED_SUFFIX}`, 'i'),
    );
  });

  it('echoes script stderr to the console under CI so job logs are self-diagnosing', () => {
    // Returning stderr makes it assertable, but most tests in this suite
    // assert on status/state rather than stderr. On CI that left the job log
    // showing only "expected 1 to be +0" while the script's explanation was
    // never printed anywhere -- which is what made the ubuntu-22.04 breakage
    // take log archaeology to diagnose.
    const repo = staleRepo({
      fail_config: { 'repos/test/repo/issues': 'server_error' },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('CI', 'true');
    let printed;
    try {
      repo.runCleanup();
      // Read the recorded calls BEFORE restoring: mockRestore() also resets
      // mock state, so reading afterwards always yields an empty list and the
      // assertion would pass or fail for the wrong reason.
      printed = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    } finally {
      vi.unstubAllEnvs();
      errorSpy.mockRestore();
    }

    expect(printed).toMatch(new RegExp(CANDIDATE_DISCOVERY_FAILED, 'i'));
    // The failing script must be identifiable, not just the message.
    expect(printed).toContain('unassign-stale-issues.sh');
  });

  it('stays quiet on the console outside CI', () => {
    // Local runs should not be spammed by the many tests that deliberately
    // drive scripts to a nonzero exit.
    const repo = staleRepo({
      fail_config: { 'repos/test/repo/issues': 'server_error' },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Stubbing to undefined removes the var (vitest deletes it), matching the
    // "no CI" environment. Cleanup uses vi.unstubAllEnvs() for parity with the
    // CI-presence test above — the only stubbed var here is CI, so the restore
    // is effectively targeted. (vi.unstubEnv, a per-key reset, does not exist
    // in vitest 3.2.x; unstubAllEnvs is the available restore.)
    vi.stubEnv('CI', undefined);
    let callCount;
    try {
      repo.runCleanup();
      // Captured before mockRestore() resets the recorded calls.
      callCount = errorSpy.mock.calls.length;
    } finally {
      vi.unstubAllEnvs();
      errorSpy.mockRestore();
    }

    expect(callCount).toBe(0);
  });

  it('surfaces the assign script’s root cause on failure', () => {
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
    expect(result.stderr).toMatch(
      new RegExp(`${READ_ISSUE_STATE_PREFIX}7`, 'i'),
    );
  });
});

describe('state-file diagnosability (#2698)', () => {
  // The fake-gh state file is read back after every script run so tests can
  // assert on resulting state. Previously a corrupt/partially-written file
  // was silently swapped for an empty default, turning a parse failure into a
  // confusing "expected 1 but got 0" — the same hidden-diagnostic class that
  // made #2688 expensive to trace. runRecordHistory delegates state reading
  // to readFakeState and threads any parseError into its returned stderr, so
  // these tests on the helper prove the surfaced-diagnostic contract.

  it('surfaces the parse error when the state file is corrupt', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'corrupt-state-'));
    try {
      const corruptFile = path.join(dir, 'state.json');
      // Partially-written / truncated JSON, as a real crash mid-write could
      // leave behind.
      writeFileSync(corruptFile, '{ "issues": { "42": { partially');

      const { state, parseError } = readFakeState(corruptFile);

      // The corrupt file must NOT silently look like a clean empty run.
      expect(parseError).toMatch(/unparseable/i);
      // ...and it must still hand back a usable empty default so callers do
      // not throw on the state itself.
      expect(state).toEqual(EMPTY_FAKE_STATE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty default with no error when no state file exists', () => {
    // A script that aborts before writing any state is a legitimate empty
    // result, not corruption. It must not produce a noisy diagnostic.
    const dir = mkdtempSync(path.join(tmpdir(), 'no-state-'));
    try {
      const missing = path.join(dir, 'absent.json');

      const { state, parseError } = readFakeState(missing);

      expect(parseError).toBe('');
      expect(state).toEqual(EMPTY_FAKE_STATE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
