/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test helpers for the assignment automation behavioral tests.
 *
 * These helpers set up a stateful fake `gh` infrastructure adapter (a Python
 * script that models GitHub REST API state transitions) and execute the REAL
 * bash scripts against it. The fake gh is infrastructure — it models API
 * state, not business logic.
 */

import { execFileSync } from 'child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const FAKE_GH = path.join(import.meta.dirname, 'fake-gh.py');

let eventIdCounter = 200000;

function nextEventId() {
  eventIdCounter += 1;
  return eventIdCounter;
}

// Track temp directories created by createFakeRepo so they can be cleaned up
// when the Vitest worker process exits, preventing resource leaks across tests.
const _fakeRepoDirs = [];
process.on('beforeExit', () => {
  for (const d of _fakeRepoDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // already removed
    }
  }
});

/**
 * Create a temporary directory representing a fake GitHub repo.
 * Returns an object with methods to manage state and run scripts.
 */
export function createFakeRepo(initialState = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'assign-test-'));
  _fakeRepoDirs.push(dir);
  const stateFile = path.join(dir, 'state.json');

  // Create a bin dir with a `gh` wrapper that delegates to fake-gh.py
  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const ghWrapper = path.join(binDir, 'gh');
  writeFileSync(
    ghWrapper,
    `#!/usr/bin/env bash\nexec python3 "${FAKE_GH}" "$@"\n`,
  );
  execFileSync('chmod', ['+x', ghWrapper]);

  const defaultState = {
    now: '2025-07-23T00:00:00Z',
    next_comment_id: 100,
    issues: {},
    prs: {},
    comments: [],
    labels: {},
    events: {},
    timeline: {},
    fail_config: {},
    ...initialState,
  };

  writeFileSync(stateFile, JSON.stringify(defaultState, null, 2));

  const pathWithFakeGh = binDir + path.delimiter + process.env.PATH;

  return {
    dir,
    stateFile,
    binDir,

    readState() {
      return JSON.parse(readFileSync(stateFile, 'utf8'));
    },

    writeState(state) {
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    },

    updateState(updater) {
      const state = this.readState();
      const updated = updater(state);
      this.writeState(updated ?? state);
    },

    /**
     * Run assign-issue.sh against the fake gh.
     * Returns { stdout, stderr, status, state }.
     */
    runAssign({
      issueNumber,
      commenter,
      authorAssociation = 'NONE',
      extraEnv = {},
    }) {
      const env = {
        ...process.env,
        GH_TOKEN: 'fake-token',
        GITHUB_TOKEN: 'fake-token',
        GITHUB_REPOSITORY: 'test/repo',
        ISSUE_NUMBER: String(issueNumber),
        COMMENTER_LOGIN: commenter,
        AUTHOR_ASSOCIATION: authorAssociation,
        GH_FAKE_STATE: stateFile,
        ASSIGN_RETRY_DELAY: '0',
        PATH: pathWithFakeGh,
        ...extraEnv,
      };
      try {
        const stdout = execFileSync(
          'bash',
          [path.join(ROOT, '.github/scripts/assign-issue.sh')],
          {
            encoding: 'utf8',
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        return { stdout, stderr: '', status: 0, state: this.readState() };
      } catch (err) {
        return {
          stdout: err.stdout?.toString() ?? '',
          stderr: err.stderr?.toString() ?? '',
          status: err.status ?? 1,
          state: this.readState(),
        };
      }
    },

    /**
     * Run unassign-stale-issues.sh against the fake gh.
     */
    runCleanup({ extraEnv = {} } = {}) {
      const env = {
        ...process.env,
        GH_TOKEN: 'fake-token',
        GITHUB_TOKEN: 'fake-token',
        GITHUB_REPOSITORY: 'test/repo',
        GH_FAKE_STATE: stateFile,
        ASSIGN_RETRY_DELAY: '0',
        ASSIGN_NOW: '2025-07-23T00:00:00Z',
        PATH: pathWithFakeGh,
        ...extraEnv,
      };
      try {
        const stdout = execFileSync(
          'bash',
          [path.join(ROOT, '.github/scripts/unassign-stale-issues.sh')],
          { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        return { stdout, stderr: '', status: 0, state: this.readState() };
      } catch (err) {
        return {
          stdout: err.stdout?.toString() ?? '',
          stderr: err.stderr?.toString() ?? '',
          status: err.status ?? 1,
          state: this.readState(),
        };
      }
    },
  };
}

/**
 * Run record-assignment-history.sh against a fresh stateful fake gh.
 * Creates its own temp directory, writes the given state, runs the script,
 * reads the final state, and cleans up.
 *
 * Returns { stdout, stderr, status, state }.
 */
export function runRecordHistory({ state, assigneeLogin, extraEnv = {} }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'record-hist-'));
  const stateFile = path.join(dir, 'state.json');
  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const ghWrapper = path.join(binDir, 'gh');
  writeFileSync(
    ghWrapper,
    `#!/usr/bin/env bash
exec python3 "${FAKE_GH}" "$@"
`,
  );
  execFileSync('chmod', ['+x', ghWrapper]);

  const initialState = {
    now: '2025-07-23T00:00:00Z',
    issues: {},
    prs: {},
    comments: [],
    labels: {},
    events: {},
    timeline: {},
    fail_config: {},
    ...state,
  };
  writeFileSync(stateFile, JSON.stringify(initialState, null, 2));

  const env = {
    ...process.env,
    GH_TOKEN: 'fake',
    GITHUB_TOKEN: 'fake',
    GITHUB_REPOSITORY: 'test/repo',
    ASSIGNEE_LOGIN: assigneeLogin,
    GH_FAKE_STATE: stateFile,
    PATH: binDir + path.delimiter + process.env.PATH,
    ...extraEnv,
  };

  try {
    const stdout = execFileSync(
      'bash',
      [path.join(ROOT, '.github/scripts/record-assignment-history.sh')],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const finalState = JSON.parse(readFileSync(stateFile, 'utf8'));
    return { stdout, stderr: '', status: 0, state: finalState };
  } catch (err) {
    let finalState;
    try {
      finalState = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {
      finalState = {
        issues: {},
        labels: {},
        comments: [],
      };
    }
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      status: err.status ?? 1,
      state: finalState,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Create a default state with the auto-assigned label defined.
 */
export function defaultState() {
  return {
    now: '2025-07-23T00:00:00Z',
    next_comment_id: 100,
    issues: {},
    prs: {},
    comments: [],
    labels: {
      'auto-assigned': {
        name: 'auto-assigned',
        color: '0E8A16',
        description: 'Assigned via /assign automation',
      },
    },
    events: {},
    timeline: {},
    fail_config: {},
  };
}

/**
 * Create an issue with the given properties.
 */
export function makeIssue({
  number,
  assignees = [],
  labels = [],
  state = 'open',
  title = `Issue ${number}`,
  body = '',
  createdAt = '2025-06-01T00:00:00Z',
}) {
  return {
    number,
    title,
    body,
    state,
    created_at: createdAt,
    updated_at: createdAt,
    _assignees: assignees,
    _label_names: labels,
    user: { login: 'reporter', type: 'User' },
    pull_request: undefined,
  };
}

/**
 * Create a PR in the fake state.
 */
export function makePR({
  number,
  author,
  merged = false,
  title = '',
  body = '',
  mergedAt = null,
  repoUrl = null,
}) {
  const actualMergedAt = mergedAt ?? (merged ? '2025-06-15T00:00:00Z' : null);
  const repositoryUrl = repoUrl ?? 'https://api.github.com/repos/test/repo';
  return {
    number,
    title,
    body,
    state: merged ? 'closed' : 'open',
    merged_at: actualMergedAt,
    created_at: '2025-06-01T00:00:00Z',
    updated_at: actualMergedAt ?? '2025-06-01T00:00:00Z',
    user: { login: author, type: 'User' },
    _assignees: [],
    _label_names: [],
    pull_request: { url: '' },
    repository_url: repositoryUrl,
  };
}

/**
 * Create an "assigned" timeline event.
 */
export function makeAssignedEvent({
  assignee,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-01T00:00:00Z',
}) {
  return {
    id: nextEventId(),
    event: 'assigned',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    assignee: { login: assignee },
    created_at: createdAt,
  };
}

/**
 * Create a "cross-referenced" timeline event (a linked PR).
 * repositoryUrl defaults to same-repo; use null to test cross-repo scenario
 * (the script must reject cross-repo PRs).
 */
export function makeCrossRefEvent({
  prNumber,
  prAuthor,
  createdAt = '2025-07-05T00:00:00Z',
  repositoryUrl = 'https://api.github.com/repos/test/repo',
}) {
  return {
    id: nextEventId(),
    event: 'cross-referenced',
    actor: { login: prAuthor, type: 'User' },
    source: {
      issue: {
        number: prNumber,
        title: `PR #${prNumber}`,
        pull_request: { url: '' },
        user: { login: prAuthor, type: 'User' },
        repository_url: repositoryUrl,
      },
    },
    created_at: createdAt,
  };
}

/**
 * Create a "labeled" timeline event.
 */
export function makeLabeledEvent({
  label,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-01T00:00:00Z',
}) {
  return {
    id: nextEventId(),
    event: 'labeled',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    label: { name: label },
    created_at: createdAt,
  };
}

/**
 * Create an "unlabeled" timeline event.
 */
export function makeUnlabeledEvent({
  label,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-02T00:00:00Z',
}) {
  return {
    id: nextEventId(),
    event: 'unlabeled',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    label: { name: label },
    created_at: createdAt,
  };
}

/**
 * Create an "unassigned" timeline event.
 */
export function makeUnassignedEvent({
  assignee,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-02T00:00:00Z',
}) {
  return {
    id: nextEventId(),
    event: 'unassigned',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    assignee: { login: assignee },
    created_at: createdAt,
  };
}

/**
 * Create a "closed" timeline event (indicating a linked PR was merged/closed).
 */
export function makeClosedEvent({ createdAt = '2025-07-10T00:00:00Z' }) {
  return {
    id: nextEventId(),
    event: 'closed',
    actor: { login: 'someone', type: 'User' },
    created_at: createdAt,
  };
}

/**
 * ISO timestamp N days before a reference date (default: now=2025-07-23).
 */
export function daysAgo(days, refDate = '2025-07-23T00:00:00Z') {
  const d = new Date(refDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Generate N filler timeline events (to push the event of interest to a later
 * page in paginated output).
 */
export function makeFillerEvents(
  count,
  {
    event = 'labeled',
    actor = 'someone',
    createdAt = '2025-07-01T00:00:00Z',
    label = 'bug',
  } = {},
) {
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push({
      id: 900000 + i,
      event,
      actor: { login: actor, type: 'User' },
      label: { name: `${label}-${i}` },
      created_at: createdAt,
    });
  }
  return events;
}

/**
 * Build a structured fail_config that targets a specific method + endpoint
 * on its nth occurrence (1-indexed).
 *
 *   failOnNth({ method: 'POST', endpoint: 'repos/test/repo/issues/42/labels', on_nth: 1, type: 'error' })
 *   failOnNth({ method: 'GET', endpoint: 'repos/test/repo/labels/foo', type: 'not_found', http_status: 404 })
 */
export function failOnNth({
  method,
  endpoint,
  on_nth = 1,
  type = 'error',
  http_status,
}) {
  const req = { method, endpoint, on_nth, type };
  if (http_status !== undefined) {
    req.http_status = http_status;
  }
  return {
    requests: [req],
  };
}
