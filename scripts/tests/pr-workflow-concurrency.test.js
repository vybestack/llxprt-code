/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

function loadWorkflow(path) {
  const source = readRootFile(path);
  try {
    const parsed = yaml.load(source);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} did not parse to a YAML object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

function expectConcurrencyGroup(concurrency, expectedFragments) {
  expect(concurrency?.['cancel-in-progress']).toBe(true);
  const group = normalize(concurrency?.group);
  for (const fragment of expectedFragments) {
    expect(group).toContain(normalize(fragment));
  }
}

describe('PR workflow concurrency cancellation', () => {
  it('scopes CI cancellation by workflow and PR number or ref', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml');

    expectConcurrencyGroup(workflow.concurrency, [
      '${{ github.workflow }}',
      'github.event.pull_request.number || github.ref',
    ]);
    expect(normalize(workflow.concurrency?.group)).toBe(
      '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    );
  });

  it('uses E2E job-level concurrency for only the jobs that run E2E work', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml');
    const linuxJob = workflow.jobs?.e2e_linux;
    const macJob = workflow.jobs?.e2e_mac;

    expect(workflow.concurrency).toBeUndefined();
    expect(linuxJob, 'workflow should contain e2e_linux').toBeTruthy();
    expect(macJob, 'workflow should contain e2e_mac').toBeTruthy();
    expectConcurrencyGroup(linuxJob.concurrency, [
      '${{ github.workflow }}',
      'github.event.pull_request.number || inputs.branch_ref || github.ref',
      '${{ matrix.sandbox }}',
    ]);
    expectConcurrencyGroup(macJob.concurrency, [
      '${{ github.workflow }}',
      'github.event.pull_request.number || inputs.branch_ref || github.ref',
      '-macos',
    ]);
    expect(workflow.jobs?.skip_check?.concurrency).toBeUndefined();
    expect(workflow.jobs?.e2e_doc_change_filter?.concurrency).toBeUndefined();
  });
});
