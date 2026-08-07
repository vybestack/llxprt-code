/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  spyOn,
  setSystemTime,
} from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reportError } from './errorReporting.js';

// Constants restated from the specification (tests are the specification)
const REPORT_FILE_PATTERN = /^llxprt-client-error-.*\.json$/;

const EPOCH_ORIGIN = new Date('2026-08-07T00:00:00.000Z').getTime();
const TEST_EPOCH_STRIDE_MS = 180_000;
let nextTestEpochMs = EPOCH_ORIGIN;

describe('errorReport duplicate coalescing (issue 3113)', () => {
  let testDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;
  let stderrCalls: string[];
  let testEpochMs: number;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-dedupe-'));
    stderrCalls = [];
    testEpochMs = nextTestEpochMs;
    nextTestEpochMs += TEST_EPOCH_STRIDE_MS;
    setSystemTime(new Date(testEpochMs));
    stderrSpy = spyOn(process.stderr, 'write').mockImplementation(
      (data: unknown) => {
        if (typeof data === 'string') {
          stderrCalls.push(data);
        }
        return true;
      },
    );
  });

  afterEach(async () => {
    stderrSpy.mockRestore();
    setSystemTime();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function advanceTo(offsetMs: number): void {
    setSystemTime(new Date(testEpochMs + offsetMs));
  }

  function reportName(type: string, offsetMs: number): string {
    const timestamp = new Date(testEpochMs + offsetMs)
      .toISOString()
      .replace(/[:.]/g, '-');
    return `llxprt-client-error-${type}-${timestamp}.json`;
  }

  function expectStderrContaining(fragment: string): void {
    const found = stderrCalls.some((c) => c.includes(fragment));
    expect(found, `Expected stderr to contain "${fragment}"`).toBe(true);
  }

  function expectStderrNotContaining(fragment: string): void {
    const found = stderrCalls.some((c) => c.includes(fragment));
    expect(found, `Expected stderr NOT to contain "${fragment}"`).toBe(false);
  }

  async function listMatchingFiles(dir: string = testDir): Promise<string[]> {
    const entries = await fs.readdir(dir);
    return entries.filter((n) => REPORT_FILE_PATTERN.test(n)).sort();
  }

  function latestFullReportPath(): string {
    const marker = ' Full report available at: ';
    for (let index = stderrCalls.length - 1; index >= 0; index--) {
      const call = stderrCalls[index];
      const markerIndex = call.indexOf(marker);
      if (markerIndex >= 0) {
        return call.slice(markerIndex + marker.length).trim();
      }
    }
    throw new Error('Expected a Full report available stderr line');
  }

  it('D1: emits one stderr line per suppression with cumulative counts', async () => {
    const error = new Error('D1 duplicate message');
    await reportError(error, 'D1 base', undefined, 'd1-type', testDir);
    const filesAfterFirst = await listMatchingFiles();
    expect(filesAfterFirst.length).toBe(1);
    const originalName = filesAfterFirst[0];
    const originalPath = path.join(testDir, originalName);
    const originalBytes = await fs.readFile(originalPath, 'utf-8');

    advanceTo(1_000);
    const firstSuppressionStart = stderrCalls.length;
    await reportError(error, 'D1 base', undefined, 'd1-type', testDir);
    expect(stderrCalls.slice(firstSuppressionStart)).toEqual([
      `D1 base Duplicate error report suppressed (1 within 60s). Previous report: ${originalPath}
`,
    ]);

    advanceTo(2_000);
    const secondSuppressionStart = stderrCalls.length;
    await reportError(error, 'D1 base', undefined, 'd1-type', testDir);
    expect(stderrCalls.slice(secondSuppressionStart)).toEqual([
      `D1 base Duplicate error report suppressed (2 within 60s). Previous report: ${originalPath}
`,
    ]);

    expect(await listMatchingFiles()).toEqual([originalName]);
    expect(await fs.readFile(originalPath, 'utf-8')).toBe(originalBytes);
  });

  // D2: different error messages -> two files, no suppression
  it('D2: does not coalesce different error messages', async () => {
    await reportError(
      new Error('D2 message alpha'),
      'D2 base',
      undefined,
      'd2-type',
      testDir,
    );
    advanceTo(1_000);
    await reportError(
      new Error('D2 message beta'),
      'D2 base',
      undefined,
      'd2-type',
      testDir,
    );

    const files = await listMatchingFiles();
    expect(files.length).toBe(2);
    expectStderrNotContaining('Duplicate error report suppressed');
  });

  // D3: same message, different type -> two files
  it('D3: does not coalesce identical messages with different types', async () => {
    const error = new Error('D3 same message');
    await reportError(error, 'D3 base', undefined, 'd3-type-a', testDir);
    advanceTo(1_000);
    await reportError(error, 'D3 base', undefined, 'd3-type-b', testDir);

    const files = await listMatchingFiles();
    expect(files.length).toBe(2);
  });

  // D4: same type and message, different baseMessage -> two files
  it('D4: does not coalesce identical type+message with different baseMessage', async () => {
    const error = new Error('D4 same message');
    await reportError(
      error,
      'Error when talking to claudecode API',
      undefined,
      'd4-type',
      testDir,
    );
    advanceTo(1_000);
    await reportError(
      error,
      'Error when talking to codex API',
      undefined,
      'd4-type',
      testDir,
    );

    const files = await listMatchingFiles();
    expect(files.length).toBe(2);
  });

  // D5: window boundary — 59999ms suppressed, 60000ms written
  it('D5: window boundary at exactly 60000ms opens a new window', async () => {
    const error = new Error('D5 boundary message');
    await reportError(error, 'D5 base', undefined, 'd5-type', testDir);
    const t0Files = await listMatchingFiles();
    expect(t0Files.length).toBe(1);

    advanceTo(59_999);
    await reportError(error, 'D5 base', undefined, 'd5-type', testDir);
    const after59999 = await listMatchingFiles();
    expect(after59999.length).toBe(1);

    advanceTo(60_000);
    await reportError(error, 'D5 base', undefined, 'd5-type', testDir);
    const after60000 = await listMatchingFiles();
    expect(after60000).toEqual([
      reportName('d5-type', 0),
      reportName('d5-type', 60_000),
    ]);
  });

  // D6: Fixed window — suppressed occurrences don't extend the window
  it('D6: suppressed occurrences do not extend the fixed window', async () => {
    const error = new Error('D6 fixed window message');
    await reportError(error, 'D6 base', undefined, 'd6-type', testDir);
    const t0Files = await listMatchingFiles();
    expect(t0Files.length).toBe(1);
    const t0Name = t0Files[0];

    advanceTo(30_000);
    await reportError(error, 'D6 base', undefined, 'd6-type', testDir);
    expect((await listMatchingFiles()).length).toBe(1);

    advanceTo(59_000);
    await reportError(error, 'D6 base', undefined, 'd6-type', testDir);
    expect((await listMatchingFiles()).length).toBe(1);

    advanceTo(60_000);
    await reportError(error, 'D6 base', undefined, 'd6-type', testDir);
    const files = await listMatchingFiles();
    expect(files).toEqual([t0Name, reportName('d6-type', 60_000)]);
  });

  // D7: Suppressed call does not write a new file or rewrite the existing one
  it('D7: suppressed call leaves original file byte-for-byte unchanged', async () => {
    const error = new Error('D7 unchanged bytes message');
    await reportError(error, 'D7 base', undefined, 'd7-type', testDir);
    const t0Files = await listMatchingFiles();
    expect(t0Files.length).toBe(1);
    const t0Name = t0Files[0];
    const originalBytes = await fs.readFile(
      path.join(testDir, t0Name),
      'utf-8',
    );

    advanceTo(1_000);
    await reportError(error, 'D7 base', undefined, 'd7-type', testDir);

    const files = await listMatchingFiles();
    expect(files.length).toBe(1);
    expect(files[0]).toBe(t0Name);
    expect(files).not.toContain(reportName('d7-type', 1_000));
    const afterBytes = await fs.readFile(path.join(testDir, t0Name), 'utf-8');
    expect(afterBytes).toBe(originalBytes);
  });

  // D8: Failed write does not silence the next attempt
  it('D8: failing write does not suppress the next identical attempt', async () => {
    const error = new Error('D8 fail then succeed message');
    const nonExistentDir = path.join(testDir, 'does-not-exist');
    await reportError(error, 'D8 base', undefined, 'd8-type', nonExistentDir);

    advanceTo(1_000);
    await reportError(error, 'D8 base', undefined, 'd8-type', testDir);
    const files = await listMatchingFiles();
    expect(files.length).toBe(1);
  });

  it('D9: pins the registry at 64 entries and evicts entry 0 first', async () => {
    const messages = Array.from({ length: 65 }, (_, i) => `D9 message ${i}`);
    for (let i = 0; i < messages.length; i++) {
      advanceTo(i * 10);
      await reportError(
        new Error(messages[i]),
        'D9 base',
        undefined,
        'd9-type',
        testDir,
      );
    }

    stderrCalls = [];
    advanceTo(650);
    await reportError(
      new Error(messages[1]),
      'D9 base',
      undefined,
      'd9-type',
      testDir,
    );
    expect(stderrCalls).toHaveLength(1);
    expectStderrContaining('Duplicate error report suppressed');

    const listingBeforeEvictedRetry = await listMatchingFiles();
    stderrCalls = [];
    advanceTo(660);
    await reportError(
      new Error(messages[0]),
      'D9 base',
      undefined,
      'd9-type',
      testDir,
    );
    expectStderrContaining('Full report available at:');
    expectStderrNotContaining('Duplicate error report suppressed');
    const newReportPath = latestFullReportPath();
    expect(path.basename(newReportPath)).toBe(reportName('d9-type', 660));
    expect(await fs.readFile(newReportPath, 'utf-8')).toContain(messages[0]);
    expect(await listMatchingFiles()).not.toEqual(listingBeforeEvictedRetry);
  });

  it('D10: retains the newest fingerprint at the exact capacity boundary', async () => {
    const messages = Array.from({ length: 65 }, (_, i) => `D10 message ${i}`);
    for (let i = 0; i < messages.length; i++) {
      advanceTo(i * 10);
      await reportError(
        new Error(messages[i]),
        'D10 base',
        undefined,
        'd10-type',
        testDir,
      );
    }
    const newestPath = latestFullReportPath();
    const newestBytes = await fs.readFile(newestPath, 'utf-8');

    stderrCalls = [];
    advanceTo(650);
    await reportError(
      new Error(messages[64]),
      'D10 base',
      undefined,
      'd10-type',
      testDir,
    );

    expect(stderrCalls).toEqual([
      `D10 base Duplicate error report suppressed (1 within 60s). Previous report: ${newestPath}
`,
    ]);
    expect(await fs.readFile(newestPath, 'utf-8')).toBe(newestBytes);
  });

  // D11: Long-prefix distinct errors are not coalesced
  it('D11: distinct errors sharing a 1024-char prefix are not coalesced', async () => {
    const prefix = 'a'.repeat(1_024);
    const messageAlpha = prefix + '-alpha';
    const messageBeta = prefix + '-beta';

    await reportError(
      new Error(messageAlpha),
      'D11 base',
      undefined,
      'd11-type',
      testDir,
    );
    advanceTo(1_000);
    await reportError(
      new Error(messageBeta),
      'D11 base',
      undefined,
      'd11-type',
      testDir,
    );

    const files = await listMatchingFiles();
    expect(files.length).toBe(2);
    expectStderrNotContaining('Duplicate error report suppressed');
    // Both messages should be readable verbatim (1024 < 4096, no clamping)
    const report1 = JSON.parse(
      await fs.readFile(path.join(testDir, files[0]), 'utf-8'),
    ) as { error: { message: string } };
    const report2 = JSON.parse(
      await fs.readFile(path.join(testDir, files[1]), 'utf-8'),
    ) as { error: { message: string } };
    const msgs = [report1.error.message, report2.error.message].sort();
    expect(msgs).toEqual([messageAlpha, messageBeta].sort());
  });

  it('D12: length framing distinguishes triples that alias under NUL joining', async () => {
    const type = 'd12-type';
    const first = { baseMessage: 'a\0b', message: 'c' };
    const second = { baseMessage: 'a', message: 'b\0c' };
    expect(type.includes('\0')).toBe(false);
    expect([type, first.baseMessage, first.message].join('\0')).toBe(
      [type, second.baseMessage, second.message].join('\0'),
    );

    await reportError(
      new Error(first.message),
      first.baseMessage,
      undefined,
      type,
      testDir,
    );
    advanceTo(1_000);
    await reportError(
      new Error(second.message),
      second.baseMessage,
      undefined,
      type,
      testDir,
    );

    expect(await listMatchingFiles()).toHaveLength(2);
    expectStderrNotContaining('Duplicate error report suppressed');
  });
});
