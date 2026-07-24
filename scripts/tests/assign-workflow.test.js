/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural/config tests for the /assign automation.
 *
 * Behavioral tests (executing the real scripts against a fake gh) live in
 * assign-workflow-behaviors.test.js. This file validates workflow YAML
 * structure, script presence, and documentation consistency.
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

function loadWorkflow(relPath) {
  const source = readRootFile(relPath);
  const parsed = yaml.load(source);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${relPath} did not parse to a YAML object`);
  }
  return { source, workflow: parsed };
}

describe('.github/workflows/assign.yml', () => {
  const { source, workflow } = loadWorkflow('.github/workflows/assign.yml');
  const job = workflow.jobs?.assign;

  it('triggers on issue_comment created and issues assigned', () => {
    expect(workflow.on?.issue_comment?.types).toEqual(['created']);
    expect(workflow.on?.issues?.types).toEqual(['assigned']);
    expect(workflow.on?.pull_request).toBeUndefined();
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
    const condition = normalize(job.if);
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
    expect(job.concurrency).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('passes env vars and runs the script', () => {
    const checkout = job.steps?.find((s) => s.name === 'Checkout repository');
    expect(checkout?.uses).toBe(
      'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8',
    );
    expect(source).toContain(
      'actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8 # ratchet:actions/checkout@v5',
    );

    const runStep = job.steps?.find(
      (s) => s.name === 'Run assign-issue script',
    );
    expect(runStep?.run).toContain('./.github/scripts/assign-issue.sh');
    expect(runStep?.env?.ISSUE_NUMBER).toBe('${{ github.event.issue.number }}');
    expect(runStep?.env?.COMMENTER_LOGIN).toBe(
      '${{ github.event.comment.user.login }}',
    );
    expect(runStep?.env?.GH_TOKEN).toBe('${{ github.token }}');
  });
});

describe('.github/workflows/assign-stale-cleanup.yml', () => {
  const { workflow } = loadWorkflow(
    '.github/workflows/assign-stale-cleanup.yml',
  );
  const job = workflow.jobs?.cleanup;

  it('runs on a daily schedule and workflow_dispatch', () => {
    expect(workflow.on?.schedule?.[0]?.cron).toBe('0 7 * * *');
    expect(workflow.on?.workflow_dispatch).toBeDefined();
  });

  it('guards scheduled runs to the canonical upstream repository', () => {
    expect(normalize(job?.if)).toContain(
      "github.repository == 'vybestack/llxprt-code'",
    );
    expect(normalize(job?.if)).not.toContain('llpxrt-code');
  });

  it('uses least-privilege permissions and runs the cleanup script', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'read',
    });
    const runStep = job.steps?.find(
      (s) => s.name === 'Run unassign-stale-issues script',
    );
    expect(runStep?.run).toContain(
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
