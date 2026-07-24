/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for fake-gh fidelity improvements (OCR Finding 10).
 *
 *   - issue PATCH drops configured unassignable assignees consistently
 *     with assignee POST
 *   - invalid state query/search values must fail instead of returning all
 *   - invalid type/is search qualifiers must fail
 *   - non-array labels/assignees fields in POST endpoints must fail through
 *     validation
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as nodePath from 'path';
import { createFakeRepo, defaultState, makeIssue } from './assign-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

describe('F10: fake-gh fidelity', () => {
  it('issue PATCH drops configured unassignable assignees consistently with POST', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [], labels: [] }),
        },
        unassignable_logins: ['alice'],
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api --method PATCH 'repos/test/repo/issues/42' ` +
            `-f 'assignees[]=alice' -f 'assignees[]=bob' --silent`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    // The PATCH should succeed (HTTP 200) — GitHub returns 200 even when
    // some assignees are silently dropped.
    expect(exitCode).toBe(0);
    const state = repo.readState();
    // alice must be dropped (unassignable), bob must be kept
    expect(state.issues['42']._assignees).not.toContain('alice');
    expect(state.issues['42']._assignees).toContain('bob');
  });

  it('invalid state query value on /issues fails (not returns all)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          1: makeIssue({ number: 1, assignees: [], state: 'open' }),
          2: makeIssue({ number: 2, assignees: [], state: 'closed' }),
        },
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api 'repos/test/repo/issues?state=invalid&per_page=100'`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    // Must fail — invalid state value should not return all issues
    expect(exitCode).not.toBe(0);
  });

  it('invalid type: search qualifier fails', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api 'search/issues?q=repo:test/repo+type:invalid&per_page=1'`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    expect(exitCode).not.toBe(0);
  });

  it('invalid is: search qualifier fails', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api 'search/issues?q=repo:test/repo+is:invalid&per_page=1'`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    expect(exitCode).not.toBe(0);
  });

  it('non-array labels field in POST /issues/N/labels fails through validation', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api --method POST 'repos/test/repo/issues/42/labels' ` +
            `-F 'labels=not-an-array' --silent`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    // Must fail — labels field must be an array
    expect(exitCode).not.toBe(0);
  });

  it('non-array assignees field in POST /issues/N/assignees fails through validation', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );

    let exitCode = 0;
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
            `GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api --method POST 'repos/test/repo/issues/42/assignees' ` +
            `-F 'assignees=not-an-array' --silent`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err) {
      exitCode = err.status ?? 1;
    }

    // Must fail — assignees field must be an array
    expect(exitCode).not.toBe(0);
  });
});
