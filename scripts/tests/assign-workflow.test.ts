/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural/config tests for the /assign automation.
 *
 * Behavioral tests (executing the real scripts against a fake gh) live in
 * assign-workflow-behaviors.test.ts. This file validates workflow YAML
 * structure, script presence, and documentation consistency.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  asOptionalRecord,
  asOptionalRecordArray,
  asOptionalString,
  asRecord,
  jobSteps,
  parseWorkflowYaml,
  workflowJobOptional,
  workflowOn,
} from './typed-test-helpers.ts';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

function loadWorkflow(relPath: string) {
  const source = readRootFile(relPath);
  const workflow = parseWorkflowYaml(source);
  return { source, workflow };
}

describe('.github/workflows/assign.yml', () => {
  const { source, workflow } = loadWorkflow('.github/workflows/assign.yml');
  const job = workflowJobOptional(workflow, 'assign');

  it('triggers on issue_comment created and issues assigned', () => {
    const triggers = workflowOn(workflow);
    const issueComment = asOptionalRecord(triggers['issue_comment']);
    const issuesTrigger = asOptionalRecord(triggers['issues']);
    expect(issueComment?.['types']).toEqual(['created']);
    expect(issuesTrigger?.['types']).toEqual(['assigned']);
    expect(triggers['pull_request']).toBeUndefined();
  });

  it('uses least-privilege permissions including pull-requests read', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'read',
    });
  });

  it('gates on exact /assign for issues (not PRs) and rejects bots', () => {
    expect(job, 'assign job should exist').toBeTruthy();
    const condition = normalize(asOptionalString(job?.['if']));
    expect(condition).toContain('github.event.issue.pull_request == null');
    expect(condition).toContain("github.event.comment.user.type != 'Bot'");
    expect(condition).toContain("github.event.comment.body == '/assign'");
    expect(condition).toContain(
      `toJSON(github.event.comment.body) == '"/assign\\n"'`,
    );
    expect(condition).toContain(
      `toJSON(github.event.comment.body) == '"/assign\\r\\n"'`,
    );
    expect(source).not.toMatch(
      /startsWith\(toJSON\(github\.event\.comment\.body\)/,
    );
  });

  it('groups concurrency by actor+issue to allow independent distinct issues', () => {
    // GitHub retains only one pending job per concurrency group. Commenter-
    // ID-only grouping would cancel a valid /assign on a distinct issue.
    // Grouping by actor+issue allows distinct-issue commands to run
    // independently while still bounding same-actor-same-issue fan-out.
    // The real-script post-mutation cap enforcement/election remains
    // authoritative for bounding total assignments.
    expect(job?.['concurrency']).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('passes env vars and runs the script', () => {
    const steps = jobSteps(job);
    const checkout = steps.find((s) => s['name'] === 'Checkout repository');
    expect(checkout?.['uses']).toBe(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    expect(source).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # ratchet:actions/checkout@v7',
    );

    const runStep = steps.find((s) => s['name'] === 'Run assign-issue script');
    expect(String(runStep?.['run'] ?? '')).toContain(
      './.github/scripts/assign-issue.sh',
    );
    const runEnv = asRecord(runStep?.['env'] ?? {});
    expect(runEnv['ISSUE_NUMBER']).toBe('${{ github.event.issue.number }}');
    expect(runEnv['COMMENTER_LOGIN']).toBe(
      '${{ github.event.comment.user.login }}',
    );
    expect(runEnv['GH_TOKEN']).toBe('${{ github.token }}');
  });
});

describe('.github/workflows/assign-stale-cleanup.yml', () => {
  const { workflow } = loadWorkflow(
    '.github/workflows/assign-stale-cleanup.yml',
  );
  const job = workflowJobOptional(workflow, 'cleanup');

  it('runs on a daily schedule and workflow_dispatch', () => {
    const triggers = workflowOn(workflow);
    const schedule = asOptionalRecordArray(triggers['schedule']);
    expect(schedule?.[0]?.cron).toBe('0 7 * * *');
    expect(triggers['workflow_dispatch']).toBeDefined();
  });

  it('guards scheduled runs to the canonical upstream repository', () => {
    expect(normalize(asOptionalString(job?.['if']))).toContain(
      "github.repository == 'vybestack/llxprt-code'",
    );
    expect(normalize(asOptionalString(job?.['if']))).not.toContain(
      'llpxrt-code',
    );
  });

  it('uses least-privilege permissions and runs the cleanup script', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'read',
    });
    const steps = jobSteps(job);
    const runStep = steps.find(
      (s) => s['name'] === 'Run unassign-stale-issues script',
    );
    expect(String(runStep?.['run'] ?? '')).toContain(
      './.github/scripts/unassign-stale-issues.sh',
    );
  });
});

describe('.github/scripts assign automation', () => {
  it('assign-issue.sh uses gh api exclusively with fail-closed guards', () => {
    const script = fs.readFileSync(
      path.join(ROOT, '.github/scripts/assign-issue.sh'),
      'utf8',
    );
    expect(script).toContain("MARKER='<!-- llxprt-assign-feedback -->'");
    expect(script).toContain("AUTO_ASSIGNED_LABEL='auto-assigned'");
    expect(script).toContain('MAX_ASSIGNMENTS=3');
    expect(script).toContain('gh api');
    expect(script).toContain('merged');
    expect(script).toContain('github-actions[bot]');
  });

  it('unassign-stale-issues.sh contains required structural markers (constants, provenance, exemption)', () => {
    const script = fs.readFileSync(
      path.join(ROOT, '.github/scripts/unassign-stale-issues.sh'),
      'utf8',
    );
    expect(script).toContain('STALE_DAYS=14');
    expect(script).toContain("EXEMPT_LOGIN='acoliver'");
    expect(script).toContain("AUTO_ASSIGNED_LABEL='auto-assigned'");
    expect(script).toContain('retry_gh');
    expect(script).toContain('github-actions[bot]');
    expect(script).toContain('timeline');
  });
});

describe('CONTRIBUTING.md self-assign docs', () => {
  it('documents /assign eligibility, cap, and stale cleanup', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    expect(docs).toContain('/assign');
    expect(docs).toContain('merged PR');
    expect(docs).toContain('3');
    expect(docs).toContain('auto-assigned');
    expect(docs).toContain('2 weeks');
  });
});
