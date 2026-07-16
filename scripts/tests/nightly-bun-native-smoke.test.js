/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import yaml from 'js-yaml';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

function stepNamed(job, name) {
  expect(
    job,
    `workflow should define the job containing step: ${name}`,
  ).toBeDefined();
  expect(job.steps, 'job should have a steps array').toBeDefined();
  const step = job.steps.find((candidate) => candidate.name === name);
  expect(step, `job should contain step: ${name}`).toBeTruthy();
  return step;
}

describe('nightly Windows Bun native-module smoke', () => {
  let smokeJob;
  let notifyJob;
  let notifyStep;

  beforeAll(() => {
    try {
      const workflowPath = path.join(ROOT, '.github/workflows/nightly.yml');
      const workflow = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
      smokeJob = workflow.jobs?.windows_bun_native_smoke;
      notifyJob = workflow.jobs?.notify_failure;
      expect(
        smokeJob,
        'workflow should define windows_bun_native_smoke',
      ).toBeDefined();
      expect(notifyJob, 'workflow should define notify_failure').toBeDefined();
      notifyStep = stepNamed(notifyJob, 'Create Issue on Failure');
    } catch (error) {
      throw new Error(`Failed to load nightly workflow: ${error.message}`, {
        cause: error,
      });
    }
  });

  it('runs the committed native-module harness in a bounded least-privilege Windows job', () => {
    expect(smokeJob['runs-on']).toBe('windows-latest');
    expect(smokeJob.permissions).toEqual({ contents: 'read' });
    expect(smokeJob['timeout-minutes']).toBe(15);
    expect(stepNamed(smokeJob, 'Checkout').with?.['persist-credentials']).toBe(
      false,
    );
    expect(stepNamed(smokeJob, 'Setup Bun').with?.['bun-version-file']).toBe(
      '.bun-version',
    );
    expect(String(stepNamed(smokeJob, 'Install dependencies').run).trim()).toBe(
      'npm ci',
    );

    const smokeStep = stepNamed(smokeJob, 'Run Bun native-modules smoke');
    expect(smokeStep.shell).toBe('bash');
    expect(String(smokeStep.run)).toContain(
      'bun scripts/bun-native-modules-smoke.mjs',
    );
    expect(String(smokeStep.run)).toContain('exit "${SMOKE_EXIT}"');
  });

  it('retains both ends of oversized diagnostics within the issue-body budget', async () => {
    const captureStep = stepNamed(smokeJob, 'Capture smoke output');
    expect(captureStep.if).toBe('always()');
    expect(smokeJob.outputs?.smoke_output).toBe(
      '${{ steps.capture_smoke.outputs.smoke_output }}',
    );

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-smoke-output-'),
    );
    const githubOutput = path.join(tempDir, 'github-output.txt');
    const oversizedLog = `BEGIN-DIAGNOSTIC\n${'x'.repeat(70_000)}\nEND-DIAGNOSTIC\n`;

    try {
      fs.writeFileSync(path.join(tempDir, 'smoke_output.txt'), oversizedLog);
      await execFileAsync('bash', ['-c', String(captureStep.run)], {
        cwd: tempDir,
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
      });

      const outputLine = fs
        .readFileSync(githubOutput, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('smoke_output='));
      expect(outputLine).toBeDefined();
      const decoded = Buffer.from(
        outputLine.slice('smoke_output='.length),
        'base64',
      );
      expect(decoded.byteLength).toBeLessThanOrEqual(60_000);
      expect(decoded.toString('utf8')).toContain('BEGIN-DIAGNOSTIC');
      expect(decoded.toString('utf8')).toContain('output truncated:');
      expect(decoded.toString('utf8')).toContain('END-DIAGNOSTIC');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('reports smoke failures with captured output and the workflow run URL', () => {
    const needs = Array.isArray(notifyJob.needs)
      ? notifyJob.needs
      : [notifyJob.needs];
    expect(needs).toContain('windows_bun_native_smoke');
    expect(notifyJob.permissions).toEqual({ issues: 'write' });
    expect(notifyStep.env?.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}');
    expect(notifyStep.env?.WINDOWS_BUN_NATIVE_SMOKE_RESULT).toBe(
      '${{ needs.windows_bun_native_smoke.result }}',
    );
    expect(notifyStep.env?.SMOKE_OUTPUT_B64).toBe(
      '${{ needs.windows_bun_native_smoke.outputs.smoke_output }}',
    );

    const run = String(notifyStep.run).replace(/\s+/g, ' ').trim();
    expect(run).toContain(
      'if [[ "${WINDOWS_BUN_NATIVE_SMOKE_RESULT}" =~ ^(failure|cancelled)$ ]]',
    );
    expect(run).toContain(
      'if [[ "${INCLUDE_SMOKE_OUTPUT}" == true && -n "${SMOKE_OUTPUT_B64}" ]]',
    );
    expect(run).toContain('Failed to decode Windows Bun smoke output');
    expect(run).toContain('Windows Bun native-modules smoke output');
    expect(run).toContain('--body-file "${BODY_FILE}"');
    expect(notifyStep.env?.RUN_URL).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
  });
});

describe('Bun native-module smoke harness', () => {
  it('passes its real checks for the current platform', async () => {
    const { stdout } = await execFileAsync(
      'bun',
      ['scripts/bun-native-modules-smoke.mjs'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      },
    );

    expect(stdout).toContain('All native-module smoke checks passed under Bun');
  }, 70_000);
});
