/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { readRootFile } from './ocr-review-workflow-helpers.ts';
import {
  parseWorkflowYaml,
  asOptionalRecord,
  jobSteps,
} from './typed-test-helpers.ts';

describe('production local prereview migration', () => {
  it('uses the existing production marker and script without a separate pilot', () => {
    const workflow = parseWorkflowYaml(
      readRootFile('.github/workflows/pr-review.yml'),
    );
    const steps = jobSteps(workflow.jobs?.review);
    expect(
      asOptionalRecord(
        steps.find((step) => step.name === 'Post walkthrough comment')?.env,
      )?.COMMENT_MARKER,
    ).toBe('<!-- llxprt-walkthrough -->');
    expect(steps.find((step) => step.id === 'walkthrough')?.run).toContain(
      'bun scripts/pr-review-walkthrough.ts',
    );
    expect(workflow.on).toHaveProperty('pull_request_target');
    expect(readRootFile('.github/workflows/pr-review.yml')).not.toContain(
      'pr-review-local-pilot',
    );
  });
  it('replaces hosted quota selection with credential-free runner inference', () => {
    const source = readRootFile('.github/workflows/pr-review.yml');
    expect(source).not.toContain('ci-quota-check.ts');
    expect(source).not.toContain('secrets[');
    expect(source).not.toContain('vars.LLXPRT');
    expect(source.match(/nohup[^\n]*ollama serve/g)).toHaveLength(1);
    expect(source).toContain(
      '2a654d98e6fba55d452b7043684e9b57a947e393bbffa62485a7aac05ee4eefd',
    );
  });
  it('validates a trusted implementation ref through registered CI dispatch without changing required CI jobs', () => {
    const workflow = parseWorkflowYaml(
      readRootFile('.github/workflows/ci.yml'),
    );
    const job = workflow.jobs?.prereview_validation;
    expect(job?.uses).toBe('./.github/workflows/pr-review.yml');
    expect(job?.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(asOptionalRecord(job?.with)?.expected_head_sha).toContain(
      'inputs.prereview_head',
    );
    expect(workflow.jobs).toHaveProperty('lint_javascript');
    expect(workflow.jobs).toHaveProperty('shard_selector');
  });
});
