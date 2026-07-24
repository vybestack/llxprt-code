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

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as nodePath from 'path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  daysAgo,
  failOnNth,
  runRecordHistory,
} from './assign-helpers.js';

const HISTORY_COLOR = '0E8A16';
const HISTORY_DESC = 'Issue assignment history index';

function defaultStateWith(overrides) {
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
    expect(result.state.issues['42']._assignees).toContain('prioruser');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
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
    const nums = JSON.parse(out).map((i) => i.number);
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
    const nums = JSON.parse(out).map((i) => i.number);
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
    const events = JSON.parse(out);
    // Both issue #42 and PR #100 events must be present
    expect(events.length).toBeGreaterThanOrEqual(2);
    const issueNums = events.map((e) => e.issue?.number);
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
    expect(result.state.labels['asnhist--newuser']).toBeUndefined();
    // Verify via op_log that no POST /labels occurred
    const postLabels = (result.state._op_log || []).filter(
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
    expect(result.state.labels['asnhist--racer']).toBeDefined();
    expect(result.state.labels['asnhist--racer'].color).toBe(HISTORY_COLOR);
    expect(result.state.labels['asnhist--racer'].description).toBe(
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
    expect(result.state.labels['asnhist--conflict'].color).toBe('FF0000');
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
    expect(result.state.labels['asnhist--absentcase']).toBeUndefined();
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
    expect(result.state.labels['asnhist--apierror2']).toBeUndefined();
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
    expect(result.state.labels['asnhist--warnuser']).toBeDefined();
    expect(result.state.labels['asnhist--warnuser'].color).toBe(HISTORY_COLOR);
    expect(result.state.labels['asnhist--warnuser'].description).toBe(
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
    expect(result.state.labels['asnhist--recheckwarn']).toBeDefined();
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
    expect(result.state.labels['asnhist--absentdiag']).toBeUndefined();
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
    expect(result.state.labels['asnhist--conflictdiag'].color).toBe('FF0000');
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
    expect(result.state.labels['asnhist--checkfail']).toBeUndefined();
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

describe('G3: Cleanup validates auto-assigned label definition upfront', () => {
  it('missing auto-assigned label is a clean no-op', () => {
    // The auto-assigned label does not exist in the repo at all.
    // discover_candidates would find no issues anyway, but the label definition
    // validation must be a clean no-op (exit 0, no mutation).
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {},
        issues: {},
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
  });

  it('conflicting auto-assigned definition fails with no mutation', () => {
    // The auto-assigned label exists but with a WRONG definition (color/desc).
    // Even with candidate issues present, cleanup must fail closed (nonzero)
    // and perform NO mutation — matching assign-issue.sh's fail-closed policy.
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: 'FF0000', // wrong color
            description: 'Human label', // wrong description
          },
        },
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    // No mutation — state preserved
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('conflicting definition on unassigned issue fails with no mutation', () => {
    // Conflicting auto-assigned label definition, issue has NO assignees
    // (just the stale label). Must still fail closed (no label-only removal).
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: '0000FF', // wrong color
            description: 'Assigned via /assign automation', // correct desc
          },
        },
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {},
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    // No mutation — stale label must NOT be removed under conflicting definition
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('conflicting definition on human-assigned issue fails with no mutation', () => {
    // Conflicting auto-assigned label definition, issue has a HUMAN assignee.
    // Must fail closed (no label-only removal, no unassign).
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: '0E8A16', // correct color
            description: 'Wrong description', // wrong description
          },
        },
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['human-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeAssignedEvent({
              number: 42,
              assignee: 'human-user',
              actor: 'human-admin',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('human-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('marker-label GET failure exits nonzero with no mutation', () => {
    // The GET to validate the auto-assigned label definition fails (500).
    // Must fail closed (nonzero), no mutation.
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/labels/auto-assigned',
          on_nth: 1,
          type: 'error',
          http_status: 500,
        }),
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });
});

// ===========================================================================
// G4: fake-gh 404 on DELETE of non-attached label; cleanup race resilience
// ===========================================================================

describe('G4: fake-gh 404 label DELETE + cleanup race resilience', () => {
  it('fake-gh: DELETE of non-attached issue label returns 404', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['u'],
            labels: ['bug'],
          }),
        },
      }),
    );

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api --method DELETE 'repos/test/repo/issues/42/labels/nonexistent' --silent`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/404/);
  });

  it('cleanup race: label removed after read but before DELETE succeeds cleanly', () => {
    // A race: cleanup reads the issue (label present), decides to DELETE the
    // label, but the label is removed by a concurrent actor AFTER the read
    // and BEFORE the DELETE. The DELETE returns 404. Cleanup must treat this
    // as the desired state (label is gone) and succeed cleanly with no
    // unrelated mutation.
    //
    // The side_effect fires on the pre-delete assignee GET (the verifying
    // issue read that confirms the label is still present), removing the label
    // so the subsequent DELETE gets a 404.
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        // Race: on the 2nd GET of the issue (the mid-delete verification read),
        // remove the auto-assigned label so the subsequent label DELETE gets 404.
        side_effects: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42',
            on_nth: 2,
            action: 'remove_label',
            issue: 42,
            label: 'auto-assigned',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    // Must succeed cleanly — the 404 on label DELETE is the desired state
    expect(result.status).toBe(0);
    // stale-user was unassigned (assignee DELETE happened before the race)
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    // Label is absent (removed by race)
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('cleanup: targeted marker deletion persistent failure hits exact endpoint', () => {
    // Verify that failure injection targets the exact DELETE label endpoint.
    // Uses flat fail_config to fail ALL DELETE attempts to the label endpoint
    // (retry_gh retries 4 times; each must fail for a persistent server error).
    // Other endpoints (GET issue, DELETE assignee) must succeed.
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        // Flat fail_config: fails ALL DELETE to the label endpoint
        fail_config: {
          'repos/test/repo/issues/42/labels/auto-assigned': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    // Assignee was removed (DELETE assignee succeeded)
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    // Label DELETE failed → nonzero, label remains for retry
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });
});

// ===========================================================================
// G5: discover_candidates diagnostics (captures and prints sanitized stderr)
// ===========================================================================

describe('G5: discover_candidates failure diagnostics', () => {
  it('candidate discovery failure includes sanitized stderr in output', () => {
    // The /issues endpoint fails during candidate discovery. The script must
    // fail (via pipefail) and include a sanitized first line from gh stderr
    // in its own diagnostic — NOT a bare "Candidate discovery failed" with
    // no context. The fake-gh error message is "Server Error".
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {},
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 1,
          type: 'error',
          http_status: 500,
        }),
      }),
    );

    const result = repo.runCleanup();

    // Must fail — no partial results
    expect(result.status).not.toBe(0);
    // The combined stderr+stdout must include the sanitized gh error detail
    // (the actual error message from the API, not just a generic "failed").
    const combined = (result.stderr || '') + (result.stdout || '');
    expect(combined).toMatch(/Server Error|status.*500/i);
  });

  it('candidate discovery failure does NOT return partial results', () => {
    // Even with some valid issues present, if the paginated GET fails, no
    // candidates should be processed (no mutations occur).
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runCleanup();

    // Must fail
    expect(result.status).not.toBe(0);
    // No mutation occurred — stale-user still assigned
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });
});
