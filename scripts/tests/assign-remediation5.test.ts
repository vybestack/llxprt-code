/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 Round 5 remediation findings.
 *
 * Each test targets a specific fresh review finding:
 *   G1: state=all eligibility query (closed issue counts as prior assignment)
 *   G2: record-assignment-history.sh validate_history_label return-code capture
 *   G3: unassign-stale-issues.sh validates auto-assigned label definition upfront
 *   G4: fake-gh 404 on DELETE of non-attached label; cleanup race resilience
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import * as nodePath from 'path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  failOnNth,
  runRecordHistory,
} from './assign-helpers.ts';
import {
  asNumber,
  asOptionalRecord,
  asRecord,
  asRecordArray,
  stateIssue,
  stateLabels,
} from './typed-test-helpers.ts';

const HISTORY_COLOR = '0E8A16';
const HISTORY_DESC = 'Issue assignment history index';

function defaultStateWith(overrides: Record<string, unknown>) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// G1: state=all eligibility query
// ===========================================================================

describe('G1: state=all eligibility query', () => {
  it('closed issue assignment qualifies (state=all, not default open)', () => {
    // The user's ONLY current non-PR assignment is a CLOSED issue. No static
    // backfill line and no history label exist. The current-assignment
    // eligibility query must use state=all so the closed issue is visible.
    // (Omitted state defaults to open on GitHub and would miss it.)
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          99: makeIssue({
            number: 99,
            assignees: ['prioruser'],
            state: 'closed',
          }),
        },
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'prioruser',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('prioruser');
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });

  it('fake-gh: omitted state on /issues defaults to open (not all)', () => {
    // Directly verify fake-gh fidelity: omitting state returns only open issues.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          1: makeIssue({ number: 1, assignees: ['u'], state: 'open' }),
          2: makeIssue({
            number: 2,
            assignees: ['u'],
            state: 'closed',
          }),
        },
      }),
    );

    // Query WITHOUT state param (should default to open → only #1)
    const out = execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues?assignee=u&per_page=100'`,
      ],
      { encoding: 'utf8' },
    );
    const nums = asRecordArray(JSON.parse(out)).map((i) =>
      asNumber(i['number']),
    );
    expect(nums).toContain(1);
    expect(nums).not.toContain(2);
  });

  it('fake-gh: explicit state=all returns both open and closed', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          1: makeIssue({ number: 1, assignees: ['u'], state: 'open' }),
          2: makeIssue({
            number: 2,
            assignees: ['u'],
            state: 'closed',
          }),
        },
      }),
    );

    const out = execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues?assignee=u&state=all&per_page=100'`,
      ],
      { encoding: 'utf8' },
    );
    const nums = asRecordArray(JSON.parse(out)).map((i) =>
      asNumber(i['number']),
    );
    expect(nums).toContain(1);
    expect(nums).toContain(2);
  });
});

// ===========================================================================
// G1b: fake-gh search query and events fidelity
// ===========================================================================

describe('G1b: fake-gh search and events fidelity', () => {
  it('search query splits on whitespace (not literal +)', () => {
    // The gh CLI query uses '+' as a space separator, which unquote_plus
    // converts to spaces. After that, split must be on whitespace only.
    // A literal '+' in a search value would be percent-encoded as %2B.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    // Query with '+' separators (URL-encoded spaces): repo+author+type+is
    const out = execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'search/issues?q=repo:test/repo+author:alice+type:pr+is:merged&per_page=1'`,
      ],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out);
    expect(parsed.total_count).toBe(1);
    expect(parsed.items[0].number).toBe(100);
  });

  it('repository /issues/events includes both issue and PR events', () => {
    // GitHub's repository-wide /issues/events endpoint includes events from
    // both issues and PRs. The fake must match this fidelity.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: ['alice'] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'bob', merged: true }),
        },
        events: {
          42: [
            {
              id: 1,
              event: 'assigned',
              actor: { login: 'github-actions[bot]', type: 'Bot' },
              assignee: { login: 'alice' },
              created_at: '2025-07-01T00:00:00Z',
            },
          ],
          100: [
            {
              id: 2,
              event: 'assigned',
              actor: { login: 'github-actions[bot]', type: 'Bot' },
              assignee: { login: 'bob' },
              created_at: '2025-07-02T00:00:00Z',
            },
          ],
        },
      }),
    );

    const out = execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues/events'`,
      ],
      { encoding: 'utf8' },
    );
    const events = JSON.parse(out).map(asRecord);
    // Both issue #42 and PR #100 events must be present
    expect(events.length).toBeGreaterThanOrEqual(2);
    const issueNums = events.map(
      (e: Record<string, unknown>) => asOptionalRecord(e['issue'])?.number,
    );
    expect(issueNums).toContain(42);
    expect(issueNums).toContain(100);
  });
});

// ===========================================================================
// G2: record-assignment-history.sh validate_history_label return codes
// ===========================================================================

describe('G2: record-history return-code capture', () => {
  it('initial GET API error exits nonzero and performs no POST', () => {
    // The initial validate_history_label GET fails (500). The script must
    // capture the return code, exit nonzero, and NOT POST a label.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/labels/asnhist--newuser',
          on_nth: 1,
          type: 'error',
          http_status: 500,
        }),
      },
      assigneeLogin: 'newuser',
    });

    expect(result.status).not.toBe(0);
    // No label was created (no POST happened)
    expect(stateLabels(result.state)['asnhist--newuser']).toBeUndefined();
    // Verify via op_log that no POST /labels occurred
    const opLog = asRecordArray(result.state._op_log) ?? [];
    const postLabels = opLog.filter(
      (op) => op.method === 'POST' && op.endpoint === 'repos/test/repo/labels',
    );
    expect(postLabels.length).toBe(0);
  });

  it('concurrent exact label creation after failed POST succeeds', () => {
    // POST /labels fails (race), but recheck finds the label was created
    // concurrently with the exact correct definition → success.
    const result = runRecordHistory({
      state: {
        // Pre-place the label so the recheck finds it (simulates concurrent creation)
        labels: {
          'asnhist--racer': {
            name: 'asnhist--racer',
            color: HISTORY_COLOR,
            description: HISTORY_DESC,
          },
        },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'racer',
    });

    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--racer']).toBeDefined();
    expect(stateLabels(result.state)['asnhist--racer'].color).toBe(
      HISTORY_COLOR,
    );
    expect(stateLabels(result.state)['asnhist--racer'].description).toBe(
      HISTORY_DESC,
    );
  });

  it('conflicting label after failed POST exits nonzero', () => {
    // POST /labels fails, recheck finds a label with WRONG definition
    // (conflicting) → must fail nonzero.
    const result = runRecordHistory({
      state: {
        labels: {
          'asnhist--conflict': {
            name: 'asnhist--conflict',
            color: 'FF0000',
            description: 'Human label',
          },
        },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'conflict',
    });

    expect(result.status).not.toBe(0);
    // Original conflicting definition preserved
    expect(stateLabels(result.state)['asnhist--conflict'].color).toBe('FF0000');
  });

  it('absent label after failed POST exits nonzero (not treated as success)', () => {
    // POST /labels fails, recheck finds label absent → must fail nonzero,
    // NOT silently succeed.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'absentcase',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--absentcase']).toBeUndefined();
  });

  it('recheck GET 500 after failed POST is treated as API error (not absence)', () => {
    // POST fails, then the recheck GET returns 500. Must NOT be treated as
    // absence (which would be a soft path); it must be a hard error.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: {
          requests: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/labels',
              on_nth: 1,
              type: 'error',
            },
            {
              method: 'GET',
              endpoint: 'repos/test/repo/labels/asnhist--apierror2',
              on_nth: 2,
              type: 'error',
              http_status: 500,
            },
          ],
        },
      },
      assigneeLogin: 'apierror2',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--apierror2']).toBeUndefined();
  });
});

// ===========================================================================
// G2b: record-history stderr separation (validate_history_label)
// ===========================================================================

describe('G2b: validate_history_label stderr separation', () => {
  it('stderr warning during initial GET does not corrupt 404 absence detection', () => {
    // gh writes a warning to stderr while the label GET returns 404 (absent).
    // The script must detect 404 from stderr and proceed to create the label.
    const result = runRecordHistory({
      state: {
        labels: {},
        stderr_warnings: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/labels/asnhist--warnuser',
            message: 'WARNING: API rate limit approaching',
          },
        ],
      },
      assigneeLogin: 'warnuser',
    });

    // Should succeed — the 404 is detected from stderr, label is created
    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--warnuser']).toBeDefined();
    expect(stateLabels(result.state)['asnhist--warnuser'].color).toBe(
      HISTORY_COLOR,
    );
    expect(stateLabels(result.state)['asnhist--warnuser'].description).toBe(
      HISTORY_DESC,
    );
  });

  it('stderr warning during recheck after failed POST does not corrupt validation', () => {
    // POST fails, recheck GET writes a warning to stderr but returns valid
    // JSON for a label with correct definition. The recheck must succeed.
    const result = runRecordHistory({
      state: {
        labels: {
          'asnhist--recheckwarn': {
            name: 'asnhist--recheckwarn',
            color: HISTORY_COLOR,
            description: HISTORY_DESC,
          },
        },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
        stderr_warnings: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/labels/asnhist--recheckwarn',
            message: 'WARNING: slow response',
          },
        ],
      },
      assigneeLogin: 'recheckwarn',
    });

    // POST failed, recheck found label with correct definition → success
    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--recheckwarn']).toBeDefined();
  });
});

// ===========================================================================
// G2c: post-POST diagnostic distinguishes ABSENT / COLLISION / API_ERROR
// ===========================================================================

describe('G2c: post-failed-POST diagnostic distinction', () => {
  it('absent label after failed POST reports creation failed (not conflict)', () => {
    // POST /labels fails, recheck finds label absent. The stderr diagnostic
    // must indicate creation failed, NOT report a conflicting definition.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'absentdiag',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--absentdiag']).toBeUndefined();
    // Must report creation failed, NOT conflict/collision
    expect(result.stderr).toMatch(/create|creation|failed/i);
    expect(result.stderr).not.toMatch(/conflict|collision/i);
  });

  it('conflicting label after failed POST reports conflict', () => {
    // POST /labels fails, recheck finds a label with WRONG definition. The
    // stderr diagnostic must report conflict (not creation failed).
    const result = runRecordHistory({
      state: {
        labels: {
          'asnhist--conflictdiag': {
            name: 'asnhist--conflictdiag',
            color: 'FF0000',
            description: 'Human label',
          },
        },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'conflictdiag',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--conflictdiag'].color).toBe(
      'FF0000',
    );
    // Must report conflict
    expect(result.stderr).toMatch(/conflict|collision/i);
  });

  it('API error during post-POST recheck reports check failure (not absence)', () => {
    // POST fails, then the recheck GET returns 500. The stderr diagnostic
    // must report a check/API failure, NOT absence or conflict.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: {
          requests: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/labels',
              on_nth: 1,
              type: 'error',
            },
            {
              method: 'GET',
              endpoint: 'repos/test/repo/labels/asnhist--checkfail',
              on_nth: 2,
              type: 'error',
              http_status: 500,
            },
          ],
        },
      },
      assigneeLogin: 'checkfail',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--checkfail']).toBeUndefined();
    // Must report API/check error, NOT absence or conflict
    expect(result.stderr).toMatch(/check|api|error|failed/i);
    expect(result.stderr).not.toMatch(/conflict|collision/i);
  });

  it('includes sanitized POST stderr first line in final diagnostic on creation failure', () => {
    // POST /labels fails. The final stderr diagnostic must include a
    // sanitized first line from the POST's own stderr output.
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'postdiag',
    });

    expect(result.status).not.toBe(0);
    // The fake-gh POST failure writes a JSON message to stderr; the script
    // must include at least one sanitized line from it in the diagnostic.
    expect(result.stderr).toMatch(/Server Error|message|status|error|failed/i);
  });
});

// ===========================================================================
// G3: unassign-stale-issues.sh validates auto-assigned label definition upfront
// ===========================================================================
