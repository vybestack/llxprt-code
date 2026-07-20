/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const nightlyWorkflow = yaml.load(
  readFileSync(resolve(root, '.github/workflows/nightly.yml'), 'utf8'),
);
let notifyFailureJob;

beforeAll(() => {
  expect(
    nightlyWorkflow,
    'nightly workflow must parse as an object',
  ).toBeTypeOf('object');
  expect(nightlyWorkflow?.jobs, 'workflow must define jobs').toBeDefined();
  expect(
    nightlyWorkflow?.jobs?.notify_failure,
    'workflow must define job: notify_failure',
  ).toBeDefined();
  notifyFailureJob = nightlyWorkflow.jobs.notify_failure;
});

function failureNotificationStep() {
  expect(
    notifyFailureJob?.steps,
    'notify_failure must define steps',
  ).toBeTypeOf('object');
  const step = notifyFailureJob.steps.find(
    (candidate) => candidate.name === 'Create Issue on Failure',
  );
  expect(
    step,
    'workflow must define step named: Create Issue on Failure',
  ).toBeDefined();
  return step;
}

function logicalShellLines(script) {
  return String(script)
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function commandFor(lines, operation) {
  const escapedOperation = operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const invocation = escapedOperation.replace(/\s+/g, '\\s+');
  const pattern = new RegExp(
    `(?:^\\s*(?:if\\s+!?\\s+)?(?:retry_gh\\s+)?|\\$\\()${invocation}(?:\\s|$)`,
  );
  const command = lines.find((line) => pattern.test(line));
  expect(command, `${operation} should be present`).toBeDefined();
  return command;
}

describe('nightly failure notifier repository targeting', () => {
  it('does not mistake comments for command invocations', () => {
    expect(
      commandFor(
        [
          '# gh issue list is required by the notifier',
          'gh issue list --repo "${GH_REPO}"',
        ],
        'gh issue list',
      ),
    ).toBe('gh issue list --repo "${GH_REPO}"');
  });

  it('targets every checkout-free notification operation at github.repository', () => {
    const notifyFailureStep = failureNotificationStep();
    const run = String(notifyFailureStep.run);
    const logicalLines = logicalShellLines(run);
    const normalizedRun = run.replace(/\s+/g, ' ').trim();

    expect(notifyFailureStep.env?.GH_REPO).toBe('${{ github.repository }}');
    for (const operation of [
      'gh label create',
      'gh label list',
      'gh issue list',
      'gh issue comment',
    ]) {
      expect(commandFor(logicalLines, operation)).toMatch(
        /--repo\s+"\$\{GH_REPO\}"/,
      );
    }
    expect(normalizedRun).toMatch(
      /CREATE_ARGS\s*=\s*\([^)]*--repo\s+"\$\{GH_REPO\}"[^)]*\)/,
    );
    expect(normalizedRun).toMatch(
      /gh\s+issue\s+create\s+"\$\{CREATE_ARGS\[@\]\}"/,
    );
    expect(
      notifyFailureJob.steps.some((step) =>
        String(step.uses ?? '').startsWith('actions/checkout@'),
      ),
    ).toBe(false);

    expect(notifyFailureJob.permissions).toMatchObject({ issues: 'write' });
    const elevatedPermissions = Object.fromEntries(
      Object.entries(notifyFailureJob.permissions).filter(
        ([, permission]) => permission === 'write' || permission === 'read-all',
      ),
    );
    expect(
      elevatedPermissions,
      'no elevated permissions beyond issues: write',
    ).toEqual({ issues: 'write' });
  });
});
