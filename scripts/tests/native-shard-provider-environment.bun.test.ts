/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  asRecord,
  parseWorkflowYaml,
  workflowJob,
} from './typed-test-helpers.ts';
import { readRootFile, stepNamed } from './ocr-review-workflow-helpers.ts';

const paidProviderEnvironment = [
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_2',
  'KEY_VAR_NAME',
  'OPENAI_BASE_URL',
  'LLXPRT_DEFAULT_MODEL',
  'LLXPRT_DEFAULT_PROVIDER',
  'LLXPRT_AUTH_TYPE',
  'LLXPRT_RUN_REAL_PROVIDER_TESTS',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'OPENROUTER_API_KEY',
  'ZAI_API_KEY',
] as const;

function expectFixtureShardWithoutPaidProviderEnvironment(
  workflowPath: string,
  jobName: string,
  stepName: string,
): void {
  const workflow = parseWorkflowYaml(readRootFile(workflowPath));
  const job = workflowJob(workflow, jobName);
  const step = stepNamed(job, stepName);
  const envRecord = (value: unknown) =>
    value === undefined ? {} : asRecord(value);
  const env = {
    ...envRecord(workflow['env']),
    ...envRecord(job['env']),
    ...envRecord(step['env']),
  };

  for (const variable of paidProviderEnvironment) {
    expect(
      env,
      `${workflowPath}:${jobName} must not inject ${variable}`,
    ).not.toHaveProperty(variable);
  }
  expect(JSON.stringify(env)).not.toMatch(
    /secrets\[vars\.|api\.z\.ai|glm-5\.3-flash/i,
  );
}

describe('native fixture test shard provider environment', () => {
  it('keeps Windows and macOS nightly shards independent of paid provider configuration', () => {
    for (const jobName of ['windows_ci', 'macos_ci']) {
      expectFixtureShardWithoutPaidProviderEnvironment(
        '.github/workflows/nightly.yml',
        jobName,
        'Run shard tests (issue #3153)',
      );
    }
  });

  it('keeps the CI test-shard matrix independent of paid provider configuration', () => {
    expectFixtureShardWithoutPaidProviderEnvironment(
      '.github/workflows/ci.yml',
      'test_shard',
      'Run shard tests (issue #2707)',
    );
  });
});
