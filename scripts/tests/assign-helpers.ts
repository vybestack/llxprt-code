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

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { FakeIssue } from './typed-test-helpers.ts';

interface ScriptResult {
  stdout: string;
  stderr: string;
  status: number;
}

interface FakeState {
  now?: string;
  next_comment_id?: number;
  page_size?: number;
  issues: Record<string, unknown>;
  prs: Record<string, unknown>;
  comments: unknown[];
  labels: Record<string, unknown>;
  events: Record<string, unknown>;
  timeline: Record<string, unknown>;
  fail_config: Record<string, unknown>;
  [key: string]: unknown;
}

interface MakeIssueOptions {
  number: number;
  assignees?: string[];
  labels?: string[];
  state?: string;
  title?: string;
  body?: string;
  createdAt?: string;
}

interface MakePROptions {
  number: number;
  author: string;
  merged?: boolean;
  title?: string;
  body?: string;
  mergedAt?: string | null;
  repoUrl?: string | null;
}

interface TimelineEvent {
  id: number;
  event: string;
  actor: { login: string; type: string };
  assignee?: { login: string };
  label?: { name: string };
  source?: { issue: Record<string, unknown> };
  created_at: string;
}

interface MakeLabeledOptions {
  number?: number;
  label: string;
  actor?: string;
  createdAt?: string;
}

interface MakeCrossRefOptions {
  number?: number;
  prNumber: number;
  prAuthor: string;
  createdAt?: string;
  repositoryUrl?: string;
}

interface MakeAssignedOptions {
  number?: number;
  assignee: string;
  actor?: string;
  createdAt?: string;
}

interface MakeClosedOptions {
  createdAt?: string;
}

interface FillerEventsOptions {
  event?: string;
  actor?: string;
  createdAt?: string;
  label?: string;
}

interface FailOnNthOptions {
  method: string;
  endpoint: string;
  on_nth?: number;
  type?: string;
  http_status?: number;
}

interface RunAssignOptions {
  issueNumber: number;
  commenter: string;
  authorAssociation?: string;
  extraEnv?: Record<string, string | undefined>;
}

interface RunCleanupOptions {
  extraEnv?: Record<string, string | undefined>;
}

interface RunRecordHistoryOptions {
  state: Partial<FakeState>;
  assigneeLogin: string;
  extraEnv?: Record<string, string | undefined>;
}

interface RunResult extends ScriptResult {
  state: FakeState;
}

interface FakeRepo {
  dir: string;
  stateFile: string;
  binDir: string;
  readState(): FakeState;
  writeState(state: FakeState): void;
  updateState(updater: (state: FakeState) => FakeState | void): void;
  runAssign(opts: RunAssignOptions): RunResult;
  runCleanup(opts?: RunCleanupOptions): RunResult;
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const FAKE_GH = path.join(import.meta.dirname, 'fake-gh.py');

function runAutomationScript(
  scriptRelPath: string,
  env: Record<string, string | undefined>,
): ScriptResult {
  const result = spawnSync('bash', [path.join(ROOT, scriptRelPath)], {
    encoding: 'utf8',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  const status = result.status ?? 1;
  const stderr = result.stderr ?? '';

  if (status !== 0 && stderr !== '' && process.env['CI'] !== undefined) {
    console.error(
      `[assign-helpers] ${scriptRelPath} exited ${status}:\n${stderr}`,
    );
  }

  return {
    stdout: result.stdout ?? '',
    stderr,
    status,
  };
}

let eventIdCounter = 200000;

function nextEventId(): number {
  eventIdCounter += 1;
  return eventIdCounter;
}

const _fakeRepoDirs: string[] = [];
process.on('beforeExit', () => {
  for (const d of _fakeRepoDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // already removed
    }
  }
});

export function createFakeRepo(
  initialState: Partial<FakeState> = {},
): FakeRepo {
  const dir = mkdtempSync(path.join(tmpdir(), 'assign-test-'));
  _fakeRepoDirs.push(dir);
  const stateFile = path.join(dir, 'state.json');

  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const ghWrapper = path.join(binDir, 'gh');
  writeFileSync(
    ghWrapper,
    `#!/usr/bin/env bash\nexec python3 "${FAKE_GH}" "$@"\n`,
  );
  execFileSync('chmod', ['+x', ghWrapper]);

  const defaultState: FakeState = {
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

    readState(): FakeState {
      return JSON.parse(readFileSync(stateFile, 'utf8'));
    },

    writeState(state: FakeState): void {
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    },

    updateState(updater: (state: FakeState) => FakeState | void): void {
      const state = this.readState();
      const updated = updater(state);
      this.writeState(updated ?? state);
    },

    runAssign({
      issueNumber,
      commenter,
      authorAssociation = 'NONE',
      extraEnv = {},
    }: RunAssignOptions): RunResult {
      const env: Record<string, string | undefined> = {
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
      const result = runAutomationScript(
        '.github/scripts/assign-issue.sh',
        env,
      );
      return { ...result, state: this.readState() };
    },

    runCleanup({ extraEnv = {} }: RunCleanupOptions = {}): RunResult {
      const env: Record<string, string | undefined> = {
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
      const result = runAutomationScript(
        '.github/scripts/unassign-stale-issues.sh',
        env,
      );
      return { ...result, state: this.readState() };
    },
  };
}

/**
 * Empty-but-typed fake state. Returned when a script run leaves no usable
 * state (it aborted before writing, or the written file was unparseable).
 */
export const EMPTY_FAKE_STATE: FakeState = {
  issues: {},
  prs: {},
  comments: [],
  labels: {},
  events: {},
  timeline: {},
  fail_config: {},
};

/**
 * Read and parse the fake-gh state file, distinguishing a legitimately absent
 * file from a corrupt one (#2698 item 1).
 *
 * A missing file (ENOENT) means the script aborted before writing any state —
 * return a usable empty default with no error. A file that EXISTS but cannot
 * be parsed indicates corruption; surfacing the parse error (via `parseError`)
 * prevents a confusing downstream "expected 1 but got 0" state assertion,
 * which is the same hidden-diagnostic class that made #2688 costly to trace.
 */
export function readFakeState(stateFile: string): {
  state: FakeState;
  parseError: string;
} {
  try {
    return {
      state: JSON.parse(readFileSync(stateFile, 'utf8')),
      parseError: '',
    };
  } catch (err) {
    const isMissing =
      err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isMissing) {
      return { state: EMPTY_FAKE_STATE, parseError: '' };
    }
    // A filesystem error (EACCES, EISDIR, …) is distinct from a JSON parse
    // error (SyntaxError has no `code`); label each accurately so the
    // diagnostic points at the right root cause.
    const isFsError =
      err instanceof Error &&
      typeof (err as NodeJS.ErrnoException).code === 'string';
    const label = isFsError ? 'unreadable' : 'unparseable';
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: EMPTY_FAKE_STATE,
      parseError: `[assign-helpers] State file was ${label}: ${message}`,
    };
  }
}

export function runRecordHistory({
  state,
  assigneeLogin,
  extraEnv = {},
}: RunRecordHistoryOptions): RunResult {
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

  const initialState: FakeState = {
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

  const env: Record<string, string | undefined> = {
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
    const result = runAutomationScript(
      '.github/scripts/record-assignment-history.sh',
      env,
    );
    const { state: finalState, parseError } = readFakeState(stateFile);
    return {
      ...result,
      stderr: parseError
        ? `${result.stderr}
${parseError}`
        : result.stderr,
      state: finalState,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function defaultState(): FakeState {
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

export function makeIssue({
  number,
  assignees = [],
  labels = [],
  state = 'open',
  title = `Issue ${number}`,
  body = '',
  createdAt = '2025-06-01T00:00:00Z',
}: MakeIssueOptions): FakeIssue {
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

export function makePR({
  number,
  author,
  merged = false,
  title = '',
  body = '',
  mergedAt = null,
  repoUrl = null,
}: MakePROptions): FakeIssue {
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

export function makeAssignedEvent({
  assignee,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-01T00:00:00Z',
}: MakeAssignedOptions): TimelineEvent {
  return {
    id: nextEventId(),
    event: 'assigned',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    assignee: { login: assignee },
    created_at: createdAt,
  };
}

export function makeCrossRefEvent({
  prNumber,
  prAuthor,
  createdAt = '2025-07-05T00:00:00Z',
  repositoryUrl = 'https://api.github.com/repos/test/repo',
}: MakeCrossRefOptions): TimelineEvent {
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

export function makeLabeledEvent({
  label,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-01T00:00:00Z',
}: MakeLabeledOptions): TimelineEvent {
  return {
    id: nextEventId(),
    event: 'labeled',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    label: { name: label },
    created_at: createdAt,
  };
}

export function makeUnlabeledEvent({
  label,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-02T00:00:00Z',
}: MakeLabeledOptions): TimelineEvent {
  return {
    id: nextEventId(),
    event: 'unlabeled',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    label: { name: label },
    created_at: createdAt,
  };
}

export function makeUnassignedEvent({
  assignee,
  actor = 'github-actions[bot]',
  createdAt = '2025-07-02T00:00:00Z',
}: MakeAssignedOptions): TimelineEvent {
  return {
    id: nextEventId(),
    event: 'unassigned',
    actor: { login: actor, type: actor.endsWith('[bot]') ? 'Bot' : 'User' },
    assignee: { login: assignee },
    created_at: createdAt,
  };
}

export function makeClosedEvent({
  createdAt = '2025-07-10T00:00:00Z',
}: MakeClosedOptions): TimelineEvent {
  return {
    id: nextEventId(),
    event: 'closed',
    actor: { login: 'someone', type: 'User' },
    created_at: createdAt,
  };
}

export function daysAgo(
  days: number,
  refDate = '2025-07-23T00:00:00Z',
): string {
  const d = new Date(refDate);
  d.setDate(d.getDate() - days);
  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

export function makeFillerEvents(
  count: number,
  {
    event = 'labeled',
    actor = 'someone',
    createdAt = '2025-07-01T00:00:00Z',
    label = 'bug',
  }: FillerEventsOptions = {},
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
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

export function failOnNth({
  method,
  endpoint,
  on_nth = 1,
  type = 'error',
  http_status,
}: FailOnNthOptions): { requests: Array<Record<string, unknown>> } {
  const req: Record<string, unknown> = { method, endpoint, on_nth, type };
  if (http_status !== undefined) {
    req.http_status = http_status;
  }
  return {
    requests: [req],
  };
}
