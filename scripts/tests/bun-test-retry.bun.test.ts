/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyAttempt,
  resolveRunnerTimeouts,
  runTimeoutRetry,
  runCoreTimeoutRetry,
  runEntryRetries,
  type CoreRetryOutcome,
} from '../lib/bun-test-retry.js';
describe('shared runner retry and timeout policy', () => {
  it('selects finite runner-specific budgets and validates CLI overrides', () => {
    expect(
      resolveRunnerTimeouts({ runner: 'cli', integration: false, env: {} }),
    ).toEqual({ perTestMs: 180_000, perFileMs: 300_000 });
    expect(
      resolveRunnerTimeouts({
        runner: 'cli',
        integration: true,
        env: { LLXPRT_TEST_FILE_TIMEOUT_MS: '1234' },
      }),
    ).toEqual({ perTestMs: 360_000, perFileMs: 900_000 });
    expect(
      resolveRunnerTimeouts({
        runner: 'agents',
        env: { LLXPRT_TEST_FILE_TIMEOUT_MS: '1234' },
      }).perFileMs,
    ).toBe(1234);
    expect(resolveRunnerTimeouts({ runner: 'core', timeoutMs: 42 })).toEqual({
      perTestMs: 180_000,
      perFileMs: 42,
    });
    expect(resolveRunnerTimeouts({ runner: 'auth' }).perFileMs).toBe(300_000);
    expect(
      resolveRunnerTimeouts({ runner: 'shared', testTimeoutMs: 80_000 })
        .perFileMs,
    ).toBe(160_000);
    expect(() =>
      resolveRunnerTimeouts({
        runner: 'cli',
        integration: false,
        env: { LLXPRT_TEST_FILE_TIMEOUT_MS: '0' },
      }),
    ).toThrow();
  });
  it('retries a fixed timeout once and retains the second attempt payload', async () => {
    const outcomes = [
      { timedOut: true, passed: false, detail: 1 },
      { timedOut: false, passed: true, detail: 2 },
    ];
    const logs: string[] = [];
    let index = 0;
    const result = await runTimeoutRetry(
      'spec.ts',
      async () => outcomes[index++]!,
      (message) => logs.push(message),
    );
    expect(result).toEqual(outcomes[1]);
    expect(logs).toEqual(['RETRY (2/2): spec.ts after per-file timeout']);
  });
  it('reduces a recovered core reap failure without losing its cause', async () => {
    const outcomes = [
      {
        passed: false,
        timedOut: true,
        timeoutMs: 30,
        reapFailed: true,
        reapError: 'first reap',
      },
      { passed: true, timedOut: false, timeoutMs: 30, reapFailed: false },
    ];
    let index = 0;
    const logs: string[] = [];
    expect(
      await runCoreTimeoutRetry(
        'core.ts',
        async () => outcomes[index++]!,
        (message) => logs.push(message),
      ),
    ).toEqual({
      ...outcomes[1],
      passed: false,
      timedOut: true,
      reapFailed: false,
      reapError: 'first reap',
    });
    expect(logs).toEqual(['RETRY (2/2): core.ts after per-file timeout']);
  });
  it('prioritizes timeout retries and shares an absolute failure attempt bound', async () => {
    const outcomes = [
      { passed: false, timedOut: true, diagnostic: ': timeout' },
      { passed: false, timedOut: false, diagnostic: ': assertion' },
      { passed: false, timedOut: false, diagnostic: ': assertion' },
      { passed: true, timedOut: false, diagnostic: '' },
    ];
    const logs: string[] = [];
    let index = 0;
    const result = await runEntryRetries(
      'entry.ts',
      2,
      async () => outcomes[index++]!,
      (message) => logs.push(message),
      { LLXPRT_BUN_TEST_TIMEOUT_RETRIES: '1' },
    );
    expect(result).toEqual(outcomes[2]);
    expect(index).toBe(3);
    expect(logs).toEqual([
      'Native Bun test timed out (attempt 1), retrying: entry.ts: timeout',
      'Native Bun test failed (attempt 2/3), retrying: entry.ts: assertion',
    ]);
  });
  it('accepts only completed shared summaries after timeout signals', () => {
    expect(
      classifyAttempt({
        runner: 'shared',
        exitCode: null,
        signalCode: 'SIGTERM',
        stdout: '(pass) x',
        stderr: '0 fail\nRan 1 tests',
      }).passed,
    ).toBe(true);
    expect(
      classifyAttempt({
        runner: 'shared',
        exitCode: null,
        signalCode: 'SIGTERM',
        stdout: '(pass) x',
        stderr: 'Ran 1 tests',
      }).passed,
    ).toBe(false);
    expect(
      classifyAttempt({ runner: 'auth', exitCode: null, killedByTimer: false })
        .passed,
    ).toBe(false);
  });
});
describe('classification boundaries', () => {
  for (const runner of ['cli', 'agents', 'auth'] as const) {
    for (const code of [0, 1, null]) {
      for (const timer of [false, true]) {
        it(`${runner} code ${code} with timer ${timer}`, () => {
          expect(
            classifyAttempt({ runner, exitCode: code, killedByTimer: timer }),
          ).toEqual({
            passed: !timer && code === 0,
            timedOut: timer,
            timeoutMs: null,
          });
        });
      }
    }
  }
  it.each([
    {
      exitCode: 1,
      perTestTimeout: false,
      spawnFailed: false,
      killedByTimer: false,
      passed: false,
      timedOut: false,
      timeoutMs: 123,
    },
    {
      exitCode: null,
      perTestTimeout: false,
      spawnFailed: false,
      killedByTimer: false,
      passed: false,
      timedOut: false,
      timeoutMs: 123,
    },
    {
      exitCode: 1,
      perTestTimeout: true,
      spawnFailed: false,
      killedByTimer: false,
      passed: false,
      timedOut: true,
      timeoutMs: null,
    },
    {
      exitCode: 0,
      perTestTimeout: false,
      spawnFailed: false,
      killedByTimer: false,
      passed: true,
      timedOut: false,
      timeoutMs: 123,
    },
    {
      exitCode: 0,
      perTestTimeout: false,
      spawnFailed: false,
      killedByTimer: true,
      passed: false,
      timedOut: true,
      timeoutMs: 123,
    },
    {
      exitCode: -1,
      perTestTimeout: false,
      spawnFailed: true,
      killedByTimer: false,
      passed: false,
      timedOut: false,
      timeoutMs: 123,
    },
  ])('core close/report classification: %j', (row) => {
    expect(
      classifyAttempt({ runner: 'core', ...row, fileTimeoutMs: 123 }),
    ).toEqual({
      passed: row.passed,
      timedOut: row.timedOut,
      timeoutMs: row.timeoutMs,
    });
  });
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    it.each([
      { stdout: '0 fail', stderr: 'Ran 1 test', passed: true },
      { stdout: 'Ran 42 tests', stderr: '0 fail', passed: true },
      { stdout: '10 fail', stderr: 'Ran 2 tests', passed: false },
      { stdout: '0 failure', stderr: 'Ran 2 tests', passed: false },
      { stdout: '0 fail', stderr: 'Ran 2 testsuite', passed: false },
      { stdout: '0 fail', stderr: '', passed: false },
      { stdout: '(pass) first', stderr: 'Ran 1 tests', passed: false },
    ])(`shared summary after ${signal}: %j`, (row) => {
      expect(
        classifyAttempt({
          runner: 'shared',
          exitCode: null,
          signalCode: signal,
          ...row,
        }),
      ).toEqual({ passed: row.passed, timedOut: !row.passed, timeoutMs: null });
    });
  }
  it('rejects complete output after other signals and assertion failures', () => {
    for (const signalCode of ['SIGABRT', null]) {
      expect(
        classifyAttempt({
          runner: 'shared',
          exitCode: 1,
          signalCode,
          stdout: '0 fail\nRan 1 test',
        }),
      ).toEqual({ passed: false, timedOut: false, timeoutMs: null });
    }
  });
});
describe('retry boundaries', () => {
  it.each([
    { sequence: [false], attempts: 1 },
    { sequence: [true, false], attempts: 2 },
    { sequence: [true, true, false], attempts: 2 },
  ])('fixed attempt bound: %j', async ({ sequence, attempts }) => {
    let count = 0;
    const logs: string[] = [];
    const result = await runTimeoutRetry(
      'fixed.ts',
      async () => ({
        timedOut: sequence[count++],
        passed: false,
        ordinal: count,
      }),
      (line) => logs.push(line),
    );
    expect(result.ordinal).toBe(attempts);
    expect(count).toBe(attempts);
    expect(logs).toEqual(
      attempts === 1 ? [] : ['RETRY (2/2): fixed.ts after per-file timeout'],
    );
  });
  it('propagates attempt rejection without another attempt', async () => {
    const error = new Error('scan failure');
    let count = 0;
    await expect(
      runTimeoutRetry(
        'reject.ts',
        async () => {
          count++;
          throw error;
        },
        () => {},
      ),
    ).rejects.toBe(error);
    expect(count).toBe(1);
  });
  it('core retains retry budget and exit code on first-reap recovery', async () => {
    let count = 0;
    const logs: string[] = [];
    const result = await runCoreTimeoutRetry(
      'per-test.ts',
      async (): Promise<CoreRetryOutcome & { readonly exitCode: number }> =>
        count++ === 0
          ? {
              passed: false,
              timedOut: true,
              timeoutMs: null,
              reapFailed: true,
              reapError: 'first',
              exitCode: 1,
            }
          : {
              passed: true,
              timedOut: false,
              timeoutMs: 456,
              reapFailed: false,
              reapError: null,
              exitCode: 0,
            },
      (line) => logs.push(line),
    );
    expect(result).toEqual({
      passed: false,
      timedOut: true,
      timeoutMs: 456,
      reapFailed: false,
      reapError: 'first',
      exitCode: 0,
    });
    expect(logs).toEqual(['RETRY (2/2): per-test.ts after per-test timeout']);
  });
  it('core does not retry a passing attempt with failed cleanup', async () => {
    let count = 0;
    const result = await runCoreTimeoutRetry(
      'cleanup.ts',
      async () => ({
        passed: true,
        timedOut: false,
        timeoutMs: 3,
        reapFailed: true,
        ordinal: ++count,
      }),
      () => {},
    );
    expect(result).toEqual({
      passed: true,
      timedOut: false,
      timeoutMs: 3,
      reapFailed: true,
      ordinal: 1,
    });
    expect(count).toBe(1);
  });
  it('shared snapshots env before the first attempt, once', async () => {
    const env = { LLXPRT_BUN_TEST_TIMEOUT_RETRIES: '1' };
    let count = 0;
    const result = await runEntryRetries(
      'timing.ts',
      0,
      async () => {
        count++;
        env.LLXPRT_BUN_TEST_TIMEOUT_RETRIES = 'invalid';
        return {
          passed: false,
          timedOut: true,
          diagnostic: '',
          ordinal: count,
        };
      },
      () => {},
      env,
    );
    expect(result.ordinal).toBe(2);
    expect(count).toBe(2);
  });
  it.each([
    {
      retries: 2,
      timeoutRetries: 1,
      sequence: [false, true, false],
      attempts: 3,
      logs: [
        'Native Bun test failed (attempt 1/3), retrying: mixed.ts!',
        'Native Bun test timed out (attempt 2), retrying: mixed.ts!',
      ],
    },
    {
      retries: 2,
      timeoutRetries: 0,
      sequence: [true, true, true],
      attempts: 3,
      logs: [
        'Native Bun test failed (attempt 1/3), retrying: mixed.ts!',
        'Native Bun test failed (attempt 2/3), retrying: mixed.ts!',
      ],
    },
    {
      retries: 0,
      timeoutRetries: 2,
      sequence: [true, true, true],
      attempts: 3,
      logs: [
        'Native Bun test timed out (attempt 1), retrying: mixed.ts!',
        'Native Bun test timed out (attempt 2), retrying: mixed.ts!',
      ],
    },
    { retries: 0, timeoutRetries: 0, sequence: [false], attempts: 1, logs: [] },
  ])(
    'shared absolute budgets and priority: %j',
    async ({ retries, timeoutRetries, sequence, attempts, logs }) => {
      let count = 0;
      const observed: string[] = [];
      const result = await runEntryRetries(
        'mixed.ts',
        retries,
        async () => ({
          passed: false,
          timedOut: sequence[count++],
          diagnostic: '!',
          ordinal: count,
        }),
        (line) => observed.push(line),
        { LLXPRT_BUN_TEST_TIMEOUT_RETRIES: String(timeoutRetries) },
      );
      expect(result.ordinal).toBe(attempts);
      expect(count).toBe(attempts);
      expect(observed).toEqual([...logs]);
    },
  );
});
import fc from 'fast-check';
import { afterEach } from 'bun:test';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {
  buildCliJUnitCases,
  buildCoreJUnitCases,
  buildAuthJUnitCases,
  renderJUnitReport,
  cleanupAttemptDirectory,
  observeChildClose,
  killChildTreeAndWait,
  junitReportContainsPerTestTimeout,
  JUNIT_SCAN_CHUNK_BYTES,
} from '../lib/bun-test-retry.js';
const cliDocument =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="3" failures="2">\n  <testsuite name="cli" tests="3" failures="2">\n    <testcase classname="src/a&amp;&lt;&quot;" name="src/a&amp;&lt;&quot;"></testcase>\n    <testcase classname="x.bun.ts" name="x.bun.ts"><failure message="Exit code 2">A&amp;B</failure></testcase>\n    <testcase classname="x.integration" name="x.integration"><failure message="Timed out after 900s">TIMEOUT</failure></testcase>\n  </testsuite>\n</testsuites>';
const coreDocument =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="3" failures="2">\n  <testsuite name="core" tests="3" failures="2">\n    <testcase classname="a&amp;&lt;&quot;" name="a&amp;&lt;&quot;"></testcase>\n    <testcase classname="test" name="test" time="0"><failure message="Timed out: per-test timeout">TIMEOUT</failure></testcase>\n    <testcase classname="test/reap" name="test/reap" time="0"><failure message="failed &amp; &lt;&quot;">TIMEOUT+REAP_FAILED</failure></testcase>\n  </testsuite>\n</testsuites>';
const authDocument =
  '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="7" failures="4">\n  <testsuite name="auth" tests="7" failures="4">\n    <testcase classname="a&amp;&lt;&quot;" name="a&amp;&lt;&quot;"></testcase>\n    <testcase classname="signal" name="signal" time="0"><failure message="Killed by signal SIGTERM">FAILED</failure></testcase>\n    <testcase classname="test/timeout" name="test/timeout" time="0"><failure message="Timed out after 300s">FAILED</failure></testcase>\n  </testsuite>\n</testsuites>';
const sharedDocument =
  '<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="bun tests" tests="2" failures="1" errors="0" time="0">\n    <testsuite name="src/a&amp;&lt;&quot;.test.ts" tests="1" failures="0" errors="0" skipped="0" time="0">\n      <testcase classname="src/a&amp;&lt;&quot;.test.ts" name="bun-test (passed)" time="0" />\n    </testsuite>\n    <testsuite name="failed" tests="1" failures="1" errors="0" skipped="0" time="0">\n      <testcase classname="failed" name="bun-test (failed)" time="0"><failure message="failed" /></testcase>\n    </testsuite>\n</testsuites>\n';
const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'retry-policy-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
describe('generated policy boundaries', () => {
  it('preserves positive file overrides and integration budgets', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2147483647 }),
        fc.boolean(),
        (budget, integration) => {
          const result = resolveRunnerTimeouts({
            runner: 'cli',
            integration,
            env: { LLXPRT_TEST_FILE_TIMEOUT_MS: String(budget) },
          });
          expect(result.perFileMs).toBe(integration ? 900000 : budget);
          expect(result.perTestMs).toBe(integration ? 360000 : 180000);
          expect(
            resolveRunnerTimeouts({
              runner: 'agents',
              env: { LLXPRT_TEST_FILE_TIMEOUT_MS: String(budget) },
            }).perFileMs,
          ).toBe(budget);
        },
      ),
    );
  });
  it.each(['0', '-1', '1.2', '1e3', ' 2 ', 'junk', '9007199254740992'])(
    'rejects invalid file override %s even for integration',
    (value) => {
      for (const integration of [false, true])
        expect(() =>
          resolveRunnerTimeouts({
            runner: 'cli',
            integration,
            env: { LLXPRT_TEST_FILE_TIMEOUT_MS: value },
          }),
        ).toThrow('LLXPRT_TEST_FILE_TIMEOUT_MS');
    },
  );
  it('preserves shared floor/scaling on either side of the boundary', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120000 }), (budget) => {
        const result = resolveRunnerTimeouts({
          runner: 'shared',
          testTimeoutMs: budget,
        });
        expect(result.perTestMs).toBe(budget);
        expect(result.perFileMs).toBe(
          budget <= 60000 ? 120000 : budget + budget,
        );
      }),
    );
  });
  it('retains core per-test defaults for generated file overrides', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300000 }), (timeoutMs) => {
        expect(resolveRunnerTimeouts({ runner: 'core', timeoutMs })).toEqual({
          perTestMs: 180000,
          perFileMs: timeoutMs,
        });
      }),
    );
  });
  it('stops fixed retries at two for arbitrary sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 3, maxLength: 20 }),
        async (sequence) => {
          let count = 0;
          const result = await runTimeoutRetry(
            'generated.ts',
            async () => ({ timedOut: sequence[count++], payload: count }),
            () => {},
          );
          expect(count).toBe(sequence[0] ? 2 : 1);
          expect(result.payload).toBe(count);
          expect(result.timedOut).toBe(sequence[count - 1]);
        },
      ),
    );
  });
  it('shares absolute failure bounds for generated assertion-only sequences', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (retries) => {
        let count = 0;
        const logs: string[] = [];
        await runEntryRetries(
          'assert.ts',
          retries,
          async () => ({
            passed: false,
            timedOut: false,
            diagnostic: '',
            payload: ++count,
          }),
          (line) => logs.push(line),
          {},
        );
        expect(count).toBe(retries + 1);
        expect(logs.length).toBe(retries);
        expect(logs.at(-1)).toBe(
          retries === 0
            ? undefined
            : 'Native Bun test failed (attempt ' +
                retries +
                '/' +
                (retries + 1) +
                '), retrying: assert.ts',
        );
      }),
    );
  });
});
describe('report documents captured before extraction', () => {
  const file = 'src/a&<".test.ts';
  it('retains the complete CLI document including controls and integration budget', () => {
    const cases = buildCliJUnitCases(
      [
        { file, passed: true, exitCode: 0, timedOut: false, output: '' },
        {
          file: 'x.bun.ts',
          passed: false,
          exitCode: 2,
          timedOut: false,
          output:
            String.fromCharCode(27) +
            '[31mA&B' +
            String.fromCharCode(27) +
            '[0m' +
            String.fromCharCode(1),
        },
        {
          file: 'x.integration.spec.tsx',
          passed: false,
          exitCode: null,
          timedOut: true,
          output: '',
        },
      ],
      (path) => (path.includes('integration') ? 900000 : 300000),
    );
    expect(
      renderJUnitReport({
        kind: 'workspace-summary',
        workspace: 'cli',
        cases,
        totalFiles: 3,
        failedCount: 2,
      }),
    ).toBe(cliDocument);
  });
  it('retains complete core document and final reap labels', () => {
    const cases = buildCoreJUnitCases([
      {
        file,
        passed: true,
        exitCode: 0,
        timedOut: false,
        timeoutMs: 3000,
        reapFailed: false,
        reapError: null,
      },
      {
        file: 'src/test.spec.ts',
        passed: false,
        exitCode: 1,
        timedOut: true,
        timeoutMs: null,
        reapFailed: false,
        reapError: null,
      },
      {
        file: 'test/reap.test.ts',
        passed: false,
        exitCode: null,
        timedOut: true,
        timeoutMs: 3000,
        reapFailed: true,
        reapError: 'failed & <"',
      },
    ]);
    expect(
      renderJUnitReport({
        kind: 'workspace-summary',
        workspace: 'core',
        cases,
        totalFiles: 3,
        failedCount: 2,
      }),
    ).toBe(coreDocument);
  });
  it('retains auth caller totals and signal/timeout messages', () => {
    const cases = buildAuthJUnitCases(
      [
        { file, passed: true, exitCode: 0, timedOut: false, signal: null },
        {
          file: 'src/signal.spec.ts',
          passed: false,
          exitCode: null,
          timedOut: false,
          signal: 'SIGTERM',
        },
        {
          file: 'test/timeout.test.ts',
          passed: false,
          exitCode: null,
          timedOut: true,
          signal: null,
        },
      ],
      300000,
    );
    expect(
      renderJUnitReport({
        kind: 'workspace-summary',
        workspace: 'auth',
        cases,
        totalFiles: 7,
        failedCount: 4,
      }),
    ).toBe(authDocument);
  });
  it('retains shared per-file suites and trailing newline', () => {
    expect(
      renderJUnitReport({
        kind: 'shared-files',
        files: [
          { name: file, passed: true },
          { name: 'failed', passed: false },
        ],
      }),
    ).toBe(sharedDocument);
  });
  it('merges agents child detail and synthesizes missing/unusable reports', () => {
    const directory = temporaryDirectory();
    const reportPath = join(directory, 'child.xml');
    writeFileSync(
      reportPath,
      `<?xml version="1.0"?><testsuites tests="3" failures="1" skipped="1">
  <testsuite name="nested"><testcase name="real" /></testsuite>
</testsuites>`,
    );
    const malformed = join(directory, 'bad.xml');
    writeFileSync(malformed, '<invalid />');
    expect(
      renderJUnitReport({
        kind: 'agents-detail',
        files: [
          { file: 'real.ts', failureReason: 'exit code 1', reportPath },
          {
            file: 'bad&.ts',
            failureReason: 'TIMEOUT after 4ms',
            reportPath: malformed,
          },
          {
            file: 'missing.ts',
            failureReason: 'killed by signal SIGKILL',
            reportPath: join(directory, 'missing.xml'),
          },
        ],
      }),
    ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="agents" tests="5" failures="3" skipped="1">
  <testsuite name="nested"><testcase name="real" /></testsuite>
  <testsuite name="bad&amp;.ts" file="bad&amp;.ts" tests="1" failures="1" skipped="0" time="0">
    <testcase name="bad&amp;.ts (no test report produced)" classname="bad&amp;.ts" time="0">
      <failure message="TIMEOUT after 4ms">The bun test process produced no JUnit report.</failure>
    </testcase>
  </testsuite>
  <testsuite name="missing.ts" file="missing.ts" tests="1" failures="1" skipped="0" time="0">
    <testcase name="missing.ts (no test report produced)" classname="missing.ts" time="0">
      <failure message="killed by signal SIGKILL">The bun test process produced no JUnit report.</failure>
    </testcase>
  </testsuite>
</testsuites>
`);
  });
});
describe('mechanical composition', () => {
  it('scans a marker split across chunks and keeps missing reports non-timeout', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'report.xml');
    writeFileSync(
      path,
      'x'.repeat(JUNIT_SCAN_CHUNK_BYTES - 8) + '<failure type="TimeoutError"',
    );
    expect(junitReportContainsPerTestTimeout(path)).toBe(true);
    expect(
      junitReportContainsPerTestTimeout(join(directory, 'missing.xml')),
    ).toBe(false);
    writeFileSync(path, '<failure type="AssertionError"');
    expect(junitReportContainsPerTestTimeout(path)).toBe(false);
  });
  it('removes only the attempt directory', async () => {
    const directory = temporaryDirectory();
    const attempt = mkdtempSync(join(directory, 'attempt-'));
    const sentinel = join(directory, 'sentinel');
    writeFileSync(sentinel, 'keep');
    await cleanupAttemptDirectory(attempt, {});
    expect(existsSync(attempt)).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('keep');
  });
  it('retries a lock error but preserves a non-lock error identity', async () => {
    const directory = temporaryDirectory();
    let attempts = 0;
    await cleanupAttemptDirectory(directory, {
      cleanupRetryDelayMs: 0,
      removeAttemptDir: () => {
        if (++attempts < 3)
          throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
    });
    expect(attempts).toBe(3);
    const error = Object.assign(new Error('bad path'), { code: 'ENOENT' });
    await expect(
      cleanupAttemptDirectory(directory, {
        removeAttemptDir: () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });
  it('reaps a real detached child and observes close', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { detached: process.platform !== 'win32', stdio: 'ignore' },
    );
    const closed = observeChildClose(child);
    await killChildTreeAndWait(child, closed, { reapTimeoutMs: 8000 });
    expect(child.signalCode).not.toBeNull();
    expect(child.exitCode).toBeNull();
  });
});
