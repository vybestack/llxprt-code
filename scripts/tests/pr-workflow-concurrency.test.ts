/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  asOptionalRecord,
  asOptionalString,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.ts';

function loadWorkflow(path: string) {
  const source = readRootFile(path);
  try {
    const parsed = parseWorkflowYaml(source);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`${path} did not parse to a YAML object`);
    }
    return parsed;
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function expectConcurrencyGroup(
  concurrency: Record<string, unknown> | undefined,
  expectedFragments: string[],
) {
  expect(concurrency?.['cancel-in-progress']).toBe(true);
  const group = normalize(asOptionalString(concurrency?.['group']));
  for (const fragment of expectedFragments) {
    expect(group).toContain(normalize(fragment));
  }
}

describe('PR workflow concurrency cancellation', () => {
  it('scopes CI cancellation by workflow and PR number or ref', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml');
    const ciConcurrency = asOptionalRecord(workflow['concurrency']);

    expectConcurrencyGroup(ciConcurrency, [
      '${{ github.workflow }}',
      'github.event.pull_request.number || github.ref',
    ]);
    expect(normalize(asOptionalString(ciConcurrency?.['group']))).toBe(
      '${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}',
    );
  });

  it('uses E2E job-level concurrency for only the jobs that run E2E work', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml');
    const linuxJob = workflowJob(workflow, 'e2e_linux');
    const macJob = workflowJob(workflow, 'e2e_mac');

    expect(workflow['concurrency']).toBeUndefined();
    expect(linuxJob, 'workflow should contain e2e_linux').toBeTruthy();
    expect(macJob, 'workflow should contain e2e_mac').toBeTruthy();
    expectConcurrencyGroup(asOptionalRecord(linuxJob?.['concurrency']), [
      '${{ github.workflow }}',
      'github.event.pull_request.number || inputs.branch_ref || github.ref',
      '${{ matrix.sandbox }}',
    ]);
    expectConcurrencyGroup(asOptionalRecord(macJob?.['concurrency']), [
      '${{ github.workflow }}',
      'github.event.pull_request.number || inputs.branch_ref || github.ref',
      '-macos',
    ]);
    expect(workflowJob(workflow, 'skip_check').concurrency).toBeUndefined();
    expect(
      workflowJob(workflow, 'e2e_doc_change_filter').concurrency,
    ).toBeUndefined();
  });
});
