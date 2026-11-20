/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3185: verify the `test_shard` job in `.github/workflows/ci.yml`
 * passes the partition identity through to the CLI runner and includes it in
 * display, reporter, and artifact names — while retaining the logical shard
 * command, JUnit glob, and existing conditions.
 *
 * Uses the existing typed workflow YAML helper (typed-test-helpers.ts) to
 * parse the committed workflow, so the tests pin the real wiring, not a
 * re-implementation.
 */

import { describe, expect, it, beforeAll } from 'bun:test';
import {
  asString,
  asRecord,
  parseWorkflowYaml,
  workflowJob,
  type WorkflowDocument,
} from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';
import { PARTITION_ENV_VAR } from '../../packages/cli/run-bun-tests.js';
import {
  buildMatrix,
  SHARD_PARTITION_COUNTS,
} from '../affected-test-shards.ts';

function loadCiWorkflow(): WorkflowDocument {
  const source = readRootFile('.github/workflows/ci.yml');
  return parseWorkflowYaml(source);
}

describe('Issue #3185: test_shard partition wiring', () => {
  let workflow: WorkflowDocument;

  beforeAll(() => {
    workflow = loadCiWorkflow();
  });

  it('includes partition identity in the job display name', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const name = asString(testShard['name']);
    expect(name).toContain('matrix.partition');
  });

  it('passes the exact partition env var to the shard test step', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(testShard, 'Run shard tests (issue #2707)');
    const env = asRecord(step['env']);
    // The YAML env key is looked up via the runner's PARTITION_ENV_VAR
    // constant, so a workflow/runner name mismatch fails here (no drift).
    expect(env[PARTITION_ENV_VAR]).toBe('${{ matrix.partition }}');
  });

  it('retains the logical shard command (bun scripts/test.ts --shard)', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(testShard, 'Run shard tests (issue #2707)');
    expect(asString(step['run'])).toContain(
      'bun scripts/test.ts --shard "${{ matrix.shard }}"',
    );
  });

  it('includes partition identity in the reporter check name', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(testShard, 'Publish Test Report (for non-forks)');
    const withBlock = asRecord(step['with']);
    const name = asString(withBlock['name']);
    expect(name).toContain('matrix.partition');
  });

  it('includes partition identity in the fork artifact name', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(
      testShard,
      'Upload Test Results Artifact (for forks)',
    );
    const withBlock = asRecord(step['with']);
    const name = asString(withBlock['name']);
    expect(name).toContain('matrix.partition');
  });

  it('retains the packages/*/junit.xml JUnit glob in the reporter step', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(testShard, 'Publish Test Report (for non-forks)');
    const withBlock = asRecord(step['with']);
    expect(asString(withBlock['path'])).toBe('packages/*/junit.xml');
  });

  it('retains the packages/*/junit.xml JUnit glob in the fork artifact step', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const step = stepNamed(
      testShard,
      'Upload Test Results Artifact (for forks)',
    );
    const withBlock = asRecord(step['with']);
    expect(asString(withBlock['path'])).toBe('packages/*/junit.xml');
  });

  it('retains the cli smoke step condition (matrix.shard == cli)', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    const steps = testShard['steps'] ?? [];
    const smokeStep = steps.find((s) => {
      const name = s['name'];
      return typeof name === 'string' && name.includes('Smoke test CLI entry');
    });
    expect(smokeStep).toBeDefined();
    expect(asString(smokeStep?.['if'])).toContain("matrix.shard == 'cli'");
  });

  it('retains the job-level if condition referencing shard_selector outputs', () => {
    const testShard = workflowJob(workflow, 'test_shard');
    expect(asString(testShard['if'])).toContain(
      'needs.shard_selector.outputs.has_tests',
    );
  });
});

describe('Issue #854: shell tests run on the first scripts partition only', () => {
  const SHELL_TESTS_STEP = 'Run shell-script behavioral tests (#2606)';
  const FIRST_PARTITION_PREFIX = '1of';

  function shellTestsCondition(): string {
    const testShard = workflowJob(loadCiWorkflow(), 'test_shard');
    return asString(stepNamed(testShard, SHELL_TESTS_STEP)['if']);
  }

  it('selects the first partition by index, not by a hard-coded partition count', () => {
    const condition = shellTestsCondition();
    expect(condition).toBe(
      `matrix.shard == 'scripts' && startsWith(matrix.partition, '${FIRST_PARTITION_PREFIX}')`,
    );
    expect(condition).not.toMatch(/[0-9]of[0-9]/);
  });

  it('matches exactly one scripts row today, the first one', () => {
    const rows = buildMatrix(['scripts']);
    const matching = rows.filter((row) =>
      row.partition.startsWith(FIRST_PARTITION_PREFIX),
    );
    expect(matching.map((row) => row.partition)).toEqual([
      `1of${SHARD_PARTITION_COUNTS['scripts']}`,
    ]);
    expect(rows[0]?.partition).toBe(matching[0]?.partition);
  });

  it('matches exactly one leg whatever the partition count', () => {
    for (let count = 1; count <= 25; count += 1) {
      const partitions = Array.from(
        { length: count },
        (_, i) => `${i + 1}of${count}`,
      );
      const matching = partitions.filter((partition) =>
        partition.startsWith(FIRST_PARTITION_PREFIX),
      );
      expect(matching).toEqual([`1of${count}`]);
    }
  });
});
