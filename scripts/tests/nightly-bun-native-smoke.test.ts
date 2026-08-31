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
import { describe, expect, it } from 'bun:test';
import { asRecord, parseWorkflowYaml, jobSteps } from './typed-test-helpers.ts';
import type { WorkflowJob, WorkflowStep } from './typed-test-helpers.ts';
import { beforeAll } from 'bun:test';
import {
  resolveHarnessTimeoutMs,
  resolveSmokeTimeoutRetries,
  smokeTestFileTimeoutMs,
  runSmokeHarnessWithTimeoutRetry,
  SmokeHarnessRunError,
  type SmokeHarnessCommand,
} from '../lib/bun-smoke-harness.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);
const FIXTURE_PATH = path.join(
  ROOT,
  'scripts/tests/fixtures/bun-smoke-harness-fixture.ts',
);
const FIXTURE_TIMEOUT_MS = 1_500;

/**
 * The Bun native-module smoke harness spawns a real `bun` subprocess. In
 * isolation it completes in well under a second, but under the full
 * `npm run test:scripts` fanout (~1900 tests competing for CPU) the subprocess
 * can be starved of scheduler time and exceed a tight fixed timeout, producing
 * spurious failures that mask the real (passing) result.
 *
 * The harness timeout is configurable via
 * LLXPRT_BUN_SMOKE_TIMEOUT_MS (non-positive / non-finite falls back to the
 * default). The default is deliberately generous so genuine hangs still
 * fail-closed without flapping under load.
 */

const HARNESS_TIMEOUT_MS = resolveHarnessTimeoutMs();
const SMOKE_TIMEOUT_RETRIES = resolveSmokeTimeoutRetries();
const TEST_TIMEOUT_MS = smokeTestFileTimeoutMs();

function stepNamed(job: WorkflowJob | undefined, name: string): WorkflowStep {
  expect(
    job,
    `workflow should define the job containing step: ${name}`,
  ).toBeDefined();
  expect(job?.steps, 'job should have a steps array').toBeDefined();
  const step = jobSteps(job).find((candidate) => candidate.name === name);
  expect(step, `job should contain step: ${name}`).toBeTruthy();
  if (!step) throw new Error(`job should contain step: ${name}`);
  return step;
}

function fixtureCommand(
  mode: 'pass' | 'fail' | 'hang' | 'hang-once',
  marker?: string,
): SmokeHarnessCommand {
  const env =
    marker === undefined
      ? { ...process.env, SMOKE_FIXTURE_MODE: mode }
      : {
          ...process.env,
          SMOKE_FIXTURE_MODE: mode,
          SMOKE_FIXTURE_MARKER: marker,
        };
  return {
    executable: 'bun',
    args: [FIXTURE_PATH],
    env,
  };
}

async function captureHarnessError(
  operation: Promise<unknown>,
): Promise<SmokeHarnessRunError> {
  let captured: unknown;
  try {
    await operation;
  } catch (error: unknown) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(SmokeHarnessRunError);
  if (!(captured instanceof SmokeHarnessRunError)) {
    throw new Error('Expected the smoke harness operation to fail');
  }
  return captured;
}

describe('nightly Windows Bun native-module smoke', () => {
  let smokeJob: WorkflowJob | undefined;
  let notifyJob: WorkflowJob | undefined;
  let notifyStep: WorkflowStep | undefined;

  beforeAll(() => {
    try {
      const workflowPath = path.join(ROOT, '.github/workflows/nightly.yml');
      const workflow = parseWorkflowYaml(fs.readFileSync(workflowPath, 'utf8'));
      const jobs = workflow['jobs'];
      if (!jobs) throw new Error('nightly.yml must define jobs');
      smokeJob = jobs['windows_bun_native_smoke'];
      notifyJob = jobs['notify_failure'];
      expect(
        smokeJob,
        'workflow should define windows_bun_native_smoke',
      ).toBeDefined();
      expect(notifyJob, 'workflow should define notify_failure').toBeDefined();
      notifyStep = stepNamed(notifyJob, 'Create Issue on Failure');
    } catch (error: unknown) {
      throw new Error(
        `Failed to load nightly workflow: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  });

  it('runs the committed native-module harness in a bounded least-privilege Windows job', () => {
    expect(smokeJob?.['runs-on']).toBe('windows-latest');
    expect(smokeJob?.permissions).toEqual({ contents: 'read' });
    expect(smokeJob?.['timeout-minutes']).toBe(15);
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
      'bun scripts/bun-native-modules-smoke.ts',
    );
    expect(String(smokeStep.run)).toContain('exit "${SMOKE_EXIT}"');
  });

  it('retains both ends of oversized diagnostics within the issue-body budget', async () => {
    const captureStep = stepNamed(smokeJob, 'Capture smoke output');
    expect(captureStep['if']).toBe('always()');
    expect(asRecord(smokeJob?.outputs)?.['smoke_output']).toBe(
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
        (outputLine ?? '').slice('smoke_output='.length),
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
    const needs = Array.isArray(notifyJob?.needs)
      ? notifyJob?.needs
      : [notifyJob?.needs].filter((n): n is string => typeof n === 'string');
    expect(needs).toContain('windows_bun_native_smoke');
    expect(notifyJob?.permissions).toEqual({
      issues: 'write',
      contents: 'read',
    });
    expect(notifyStep?.env?.['GH_TOKEN']).toBe('${{ secrets.GITHUB_TOKEN }}');
    expect(notifyStep?.env?.['GH_REPO']).toBe('${{ github.repository }}');
    expect(notifyStep?.env?.['WINDOWS_BUN_NATIVE_SMOKE_RESULT']).toBe(
      '${{ needs.windows_bun_native_smoke.result }}',
    );
    expect(notifyStep?.env?.['SMOKE_OUTPUT_B64']).toBe(
      '${{ needs.windows_bun_native_smoke.outputs.smoke_output }}',
    );

    const run = String(notifyStep?.run).replace(/\s+/g, ' ').trim();
    expect(run).toContain('--repo "${GH_REPO}"');
    expect(run).toContain(
      'if [[ "${WINDOWS_BUN_NATIVE_SMOKE_RESULT}" =~ ^(failure|cancelled)$ ]]',
    );
    expect(run).toContain(
      'if [[ "${INCLUDE_SMOKE_OUTPUT}" == true && -n "${SMOKE_OUTPUT_B64}" ]]',
    );
    expect(run).toContain('Failed to decode Windows Bun smoke output');
    expect(run).toContain('Windows Bun native-modules smoke output');
    expect(run).toContain('--body-file "${BODY_FILE}"');
    expect(notifyStep?.env?.['RUN_URL']).toBe(
      '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    );
  });
});

describe('Bun native-module smoke harness', () => {
  it(
    'passes its real checks for the current platform',
    async () => {
      const { stdout } = await runSmokeHarnessWithTimeoutRetry(
        {
          executable: 'bun',
          args: ['scripts/bun-native-modules-smoke.ts'],
        },
        {
          cwd: ROOT,
          timeoutMs: HARNESS_TIMEOUT_MS,
          retries: SMOKE_TIMEOUT_RETRIES,
        },
      );

      expect(stdout).toContain(
        'All native-module smoke checks passed under Bun',
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('Bun native-module smoke timeout retry', () => {
  it('retries a timed-out attempt once and passes when the next attempt succeeds', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-smoke-retry-'),
    );
    const marker = path.join(tempDir, 'attempt.marker');

    try {
      const result = await runSmokeHarnessWithTimeoutRetry(
        fixtureCommand('hang-once', marker),
        {
          cwd: ROOT,
          timeoutMs: FIXTURE_TIMEOUT_MS,
          retries: 1,
        },
      );

      expect(result.attempts).toBe(2);
      expect(result.stdout).toContain(
        'All native-module smoke checks passed under Bun.',
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 10_000);

  it('fails closed when every attempt times out', async () => {
    const error = await captureHarnessError(
      runSmokeHarnessWithTimeoutRetry(fixtureCommand('hang'), {
        cwd: ROOT,
        timeoutMs: FIXTURE_TIMEOUT_MS,
        retries: 1,
      }),
    );

    expect(error.attempts).toBe(2);
    expect(error.message).toContain(`${FIXTURE_TIMEOUT_MS}ms`);
    expect(error.message).toContain('2 attempts');
    expect(error.message).toContain('Attempt 1:');
    expect(error.message).toContain('Attempt 2:');
    expect(error.message.split('[HANG] fixture remains alive')).toHaveLength(3);
  }, 10_000);

  it('never retries a non-timeout failure', async () => {
    const error = await captureHarnessError(
      runSmokeHarnessWithTimeoutRetry(fixtureCommand('fail'), {
        cwd: ROOT,
        timeoutMs: FIXTURE_TIMEOUT_MS,
        retries: 3,
      }),
    );

    expect(error.attempts).toBe(1);
    expect(error.message).toContain('failed with exit code 1');
    expect(error.message).toContain('[FAIL] fixture check failed');
  });

  it('never retries ENOENT', async () => {
    const error = await captureHarnessError(
      runSmokeHarnessWithTimeoutRetry(
        { executable: 'llxprt-definitely-missing-bun', args: [] },
        {
          cwd: ROOT,
          timeoutMs: FIXTURE_TIMEOUT_MS,
          retries: 3,
        },
      ),
    );

    expect(error.attempts).toBe(1);
    expect(error.message).toBe(
      'Bun is required to run the native-module smoke harness; install the version pinned in .bun-version and ensure bun is on PATH.',
    );
  });

  it('preserves single-attempt behavior when retries is zero', async () => {
    const error = await captureHarnessError(
      runSmokeHarnessWithTimeoutRetry(fixtureCommand('hang'), {
        cwd: ROOT,
        timeoutMs: FIXTURE_TIMEOUT_MS,
        retries: 0,
      }),
    );

    expect(error.attempts).toBe(1);
    expect(error.message).toContain('1 attempt');
  }, 10_000);

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid programmatic retries %s before running any attempt',
    async (retries) => {
      await expect(
        runSmokeHarnessWithTimeoutRetry(fixtureCommand('pass'), {
          cwd: ROOT,
          timeoutMs: FIXTURE_TIMEOUT_MS,
          retries,
        }),
      ).rejects.toThrow('retries must be a non-negative safe integer');
    },
  );
});

describe('smokeTestFileTimeoutMs', () => {
  it('uses the default retry and harness timeout knobs', () => {
    expect(smokeTestFileTimeoutMs({})).toBe(620_000);
  });

  it('scales with non-default retry and harness timeout knobs', () => {
    expect(
      smokeTestFileTimeoutMs({
        LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES: '3',
        LLXPRT_BUN_SMOKE_TIMEOUT_MS: '400000',
      }),
    ).toBe(1_640_000);
  });

  it('rejects a harness timeout that pushes the file budget past the Bun maximum', () => {
    expect(() =>
      smokeTestFileTimeoutMs({
        LLXPRT_BUN_SMOKE_TIMEOUT_MS: '2147473648',
      }),
    ).toThrow(/LLXPRT_BUN_SMOKE_TIMEOUT_MS.*LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES/);
  });

  it('rejects a retry count that pushes the file budget past the Bun maximum', () => {
    expect(() =>
      smokeTestFileTimeoutMs({
        LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES: '13854',
      }),
    ).toThrow(/LLXPRT_BUN_SMOKE_TIMEOUT_MS.*LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES/);
  });

  it('accepts a file budget below the Bun maximum', () => {
    expect(
      smokeTestFileTimeoutMs({
        LLXPRT_BUN_SMOKE_TIMEOUT_MS: '2147463647',
      }),
    ).toBe(4_294_947_294);
  });
});

describe('resolveHarnessTimeoutMs', () => {
  it('defaults when the setting is absent or empty', () => {
    expect(resolveHarnessTimeoutMs({})).toBe(300_000);
    expect(resolveHarnessTimeoutMs({ LLXPRT_BUN_SMOKE_TIMEOUT_MS: '' })).toBe(
      300_000,
    );
  });

  it('accepts a positive finite timeout', () => {
    expect(
      resolveHarnessTimeoutMs({ LLXPRT_BUN_SMOKE_TIMEOUT_MS: '450000' }),
    ).toBe(450_000);
  });

  it.each(['abc', '-1', '0'])(
    'defaults for the invalid timeout setting %s',
    (raw) => {
      expect(
        resolveHarnessTimeoutMs({ LLXPRT_BUN_SMOKE_TIMEOUT_MS: raw }),
      ).toBe(300_000);
    },
  );

  it('floors a positive fractional timeout', () => {
    expect(
      resolveHarnessTimeoutMs({ LLXPRT_BUN_SMOKE_TIMEOUT_MS: '1.5' }),
    ).toBe(1);
  });

  it('clamps a sub-millisecond positive timeout to 1ms so the attempt cannot abort instantly', () => {
    expect(
      resolveHarnessTimeoutMs({ LLXPRT_BUN_SMOKE_TIMEOUT_MS: '0.5' }),
    ).toBe(1);
  });
});

describe('resolveSmokeTimeoutRetries', () => {
  it('defaults to one retry when the setting is absent or empty', () => {
    expect(resolveSmokeTimeoutRetries({})).toBe(1);
    expect(
      resolveSmokeTimeoutRetries({ LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES: '' }),
    ).toBe(1);
  });

  it.each([
    ['0', 0],
    ['3', 3],
  ])('accepts the non-negative integer %s', (raw, expected) => {
    expect(
      resolveSmokeTimeoutRetries({
        LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES: raw,
      }),
    ).toBe(expected);
  });

  it.each(['abc', '-1', '1.5'])(
    'rejects the invalid retry setting %s',
    (raw) => {
      expect(() =>
        resolveSmokeTimeoutRetries({
          LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES: raw,
        }),
      ).toThrow('expected a non-negative integer');
    },
  );
});
