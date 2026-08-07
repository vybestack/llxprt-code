/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reportError } from './errorReporting.js';

// Constants restated from the specification (tests are the specification)
const MAX_REPORT_STRING_CHARS = 4096;
const MAX_REPORT_BYTES = 131072;
const REPORT_FILE_PATTERN = /^llxprt-client-error-.*\.json$/;

function clampExpectedString(value: string): string {
  if (value.length <= MAX_REPORT_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_REPORT_STRING_CHARS)} [truncated: ${value.length} chars]`;
}

function stringifyExpected(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'string' ? clampExpectedString(value) : value,
  );
}

describe('errorReport bounding and compact output (issue 3113)', () => {
  let testDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;
  let stderrCalls: string[];

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-bounding-'));
    stderrCalls = [];
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
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function expectStderrContaining(fragment: string): void {
    const found = stderrCalls.some((call) => call.includes(fragment));
    expect(found, `Expected stderr to contain "${fragment}"`).toBe(true);
  }

  async function listReportFiles(): Promise<string[]> {
    const entries = await fs.readdir(testDir);
    return entries.filter((name) => REPORT_FILE_PATTERN.test(name)).sort();
  }

  async function readReport(name: string): Promise<Record<string, unknown>> {
    const content = await fs.readFile(path.join(testDir, name), 'utf-8');
    return JSON.parse(content);
  }

  // B1: Compact JSON — no newlines in main report
  it('B1: writes compact JSON with no newlines in the main report', async () => {
    const error = new Error('B1 compact report test');
    error.stack = 'B1 stack';
    await reportError(
      error,
      'B1 base',
      { data: 'B1 context' },
      'b1-type',
      testDir,
    );

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const raw = await fs.readFile(path.join(testDir, files[0]), 'utf-8');
    expect(raw.includes('\n')).toBe(false);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      error: { message: 'B1 compact report test', stack: 'B1 stack' },
      context: { data: 'B1 context' },
    });
  });

  // B2: Compact minimal fallback report
  it('B2: writes compact minimal fallback report on serialization failure', async () => {
    const error = new Error('B2 bigint test');
    error.stack = 'B2 stack';
    await reportError(error, 'B2 base', { big: BigInt(1) }, 'b2-type', testDir);

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    const raw = await fs.readFile(path.join(testDir, files[0]), 'utf-8');
    expect(raw.includes('\n')).toBe(false);
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      error: { message: 'B2 bigint test', stack: 'B2 stack' },
    });
  });

  // B3: Per-string clamp
  it('B3: clamps strings exceeding MAX_REPORT_STRING_CHARS with marker', async () => {
    const longString = 'a'.repeat(10_000);
    await reportError(
      new Error('B3 clamp test'),
      'B3 base',
      { blob: longString },
      'b3-type',
      testDir,
    );

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    const context = parsed.context as { blob: string };
    const expectedMarker = ` [truncated: ${longString.length} chars]`;
    expect(context.blob.startsWith('a'.repeat(MAX_REPORT_STRING_CHARS))).toBe(
      true,
    );
    expect(context.blob.endsWith(expectedMarker)).toBe(true);
    expect(context.blob.length).toBe(
      MAX_REPORT_STRING_CHARS + expectedMarker.length,
    );
  });

  it('B3b: clamps error.message at 4096 chars with the exact marker', async () => {
    const message = 'm'.repeat(MAX_REPORT_STRING_CHARS + 1);
    await reportError(
      new Error(message),
      'B3b base',
      undefined,
      'b3b-type',
      testDir,
    );

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    const reportedError = parsed.error as { message: string };
    expect(reportedError.message).toBe(
      `${'m'.repeat(MAX_REPORT_STRING_CHARS)} [truncated: 4097 chars]`,
    );
  });

  // B4: Boundary — exactly 4096 chars stored verbatim
  it('B4: stores strings of exactly MAX_REPORT_STRING_CHARS verbatim', async () => {
    const exactString = 'b'.repeat(MAX_REPORT_STRING_CHARS);
    await reportError(
      new Error('B4 boundary test'),
      'B4 base',
      { blob: exactString },
      'b4-type',
      testDir,
    );

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    const context = parsed.context as { blob: string };
    expect(context.blob).toBe(exactString);
    expect(context.blob.includes('truncated')).toBe(false);
  });

  // B5: Array-context tail clamp
  it('B5: clamps array context to last 8 entries with contextTruncated', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      text: 'x'.repeat(3_000),
      index: i,
    }));
    await reportError(
      new Error('B5 array tail test'),
      'B5 base',
      entries,
      'b5-type',
      testDir,
    );

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    const context = parsed.context as unknown[];
    expect(context.length).toBe(8);
    expect(context).toEqual(entries.slice(-8));
    const truncated = parsed.contextTruncated as { omittedEntries: number };
    expect(truncated.omittedEntries).toBe(192);
  });

  // B5b: File is at most 131072 bytes
  it('B5b: array-clamped report file stays under MAX_REPORT_BYTES', async () => {
    const entries = Array.from({ length: 200 }, (_, i) => ({
      text: 'x'.repeat(3_000),
      index: i,
    }));
    await reportError(
      new Error('B5b size bound test'),
      'B5b base',
      entries,
      'b5b-type',
      testDir,
    );

    const files = await listReportFiles();
    const stat = await fs.stat(path.join(testDir, files[0]));
    expect(stat.size).toBeLessThanOrEqual(MAX_REPORT_BYTES);
  });

  // B6: Hard payload cap — array context with huge last 8 entries
  it('B6: drops context entirely when array tail still exceeds limit', async () => {
    const makeHugeEntry = (i: number): Record<string, string> => {
      const obj: Record<string, string> = {};
      for (let k = 0; k < 40; k++) {
        obj[`key${k}`] = 'z'.repeat(4_000);
      }
      obj.index = String(i);
      return obj;
    };
    const entries = Array.from({ length: 200 }, (_, i) => makeHugeEntry(i));
    const error = new Error('B6 hard cap array test');
    error.stack = 'B6 stack';
    await reportError(error, 'B6 base', entries, 'b6-type', testDir);

    const files = await listReportFiles();
    const stat = await fs.stat(path.join(testDir, files[0]));
    expect(stat.size).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const parsed = await readReport(files[0]);
    expect(parsed.context).toBeUndefined();
    const omitted = parsed.contextOmitted as {
      reason: string;
      serializedBytes: number;
      limitBytes: number;
    };
    expect(omitted.reason).toBe('payload-exceeded-limit');
    expect(omitted.limitBytes).toBe(MAX_REPORT_BYTES);
    const kept = entries.slice(-8);
    const oversizedTail = stringifyExpected({
      error: { message: error.message, stack: error.stack },
      context: kept,
      contextTruncated: { omittedEntries: entries.length - kept.length },
    });
    expect(omitted.serializedBytes).toBe(
      Buffer.byteLength(oversizedTail, 'utf8'),
    );
  });

  // B7: Non-array context hard cap
  it('B7: drops non-array context when it exceeds the limit', async () => {
    const hugeContext: Record<string, string> = {};
    for (let k = 0; k < 200; k++) {
      hugeContext[`key${k}`] = 'w'.repeat(4_000);
    }
    await reportError(
      new Error('B7 hard cap object test'),
      'B7 base',
      hugeContext,
      'b7-type',
      testDir,
    );

    const files = await listReportFiles();
    const stat = await fs.stat(path.join(testDir, files[0]));
    expect(stat.size).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const parsed = await readReport(files[0]);
    expect(parsed.context).toBeUndefined();
    const omitted = parsed.contextOmitted as {
      reason: string;
      serializedBytes: number;
      limitBytes: number;
    };
    expect(omitted.reason).toBe('payload-exceeded-limit');
    expect(omitted.limitBytes).toBe(MAX_REPORT_BYTES);
    const oversizedPayload = stringifyExpected({
      error: parsed.error,
      context: hugeContext,
    });
    expect(omitted.serializedBytes).toBe(
      Buffer.byteLength(oversizedPayload, 'utf8'),
    );
  });

  // B8: Small context — exactly { error, context } with no extra keys
  it('B8: writes exactly { error, context } for small context with no truncation keys', async () => {
    await reportError(
      new Error('B8 small context test'),
      'B8 base',
      { data: 'test context' },
      'b8-type',
      testDir,
    );

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    expect(Object.keys(parsed).sort()).toEqual(['context', 'error']);
    expect(parsed.context).toEqual({ data: 'test context' });
  });

  // B9: Stack clamping
  it('B9: clamps error.stack with the same marker as context strings', async () => {
    const error = new Error('B9 stack clamp test');
    error.stack = 's'.repeat(10_000);
    await reportError(error, 'B9 base', undefined, 'b9-type', testDir);

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    const err = parsed.error as { message: string; stack: string };
    const expectedMarker = ` [truncated: ${10_000} chars]`;
    expect(err.stack.startsWith('s'.repeat(MAX_REPORT_STRING_CHARS))).toBe(
      true,
    );
    expect(err.stack.endsWith(expectedMarker)).toBe(true);
    expect(err.stack.length).toBe(
      MAX_REPORT_STRING_CHARS + expectedMarker.length,
    );
  });

  // B10: Write failure fallback — preserved contract
  it('B10: emits write-failure stderr messages for non-existent reportingDir', async () => {
    const error = new Error('B10 write fail test');
    const nonExistentDir = path.join(testDir, 'does-not-exist');
    await reportError(
      error,
      'B10 base',
      ['B10 context'],
      'b10-type',
      nonExistentDir,
    );

    expectStderrContaining(
      'B10 base Additionally, failed to write detailed error report:',
    );
    expectStderrContaining('Original error that triggered report generation:');
    expectStderrContaining('Original context:');
  });

  // B11: BigInt serialization failure fallback
  it('B11: emits serialization-failure stderr messages for BigInt context', async () => {
    const error = new Error('B11 bigint fail test');
    error.stack = 'B11 stack';
    await reportError(
      error,
      'B11 base',
      { big: BigInt(1) },
      'b11-type',
      testDir,
    );

    expectStderrContaining(
      'B11 base Could not stringify report content (likely due to context):',
    );
    expectStderrContaining('Original error that triggered report generation:');
    expectStderrContaining(
      'Original context could not be stringified or included in report.',
    );
    expectStderrContaining('Partial report (excluding context) available at:');
  });

  // B12: Filename format preserved
  it('B12: writes file matching the frozen filename pattern', async () => {
    await reportError(
      new Error('B12 filename test'),
      'B12 base',
      undefined,
      'contract-check',
      testDir,
    );

    const files = await listReportFiles();
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^llxprt-client-error-contract-check-.*\.json$/);
  });

  // B13: No context — exactly { error: { message, stack } }
  it('B13: writes exactly { error } with no context keys when context is omitted', async () => {
    const error = new Error('B13 no context test');
    error.stack = 'B13 stack';
    await reportError(error, 'B13 base', undefined, 'b13-type', testDir);

    const files = await listReportFiles();
    const parsed = await readReport(files[0]);
    expect(Object.keys(parsed).sort()).toEqual(['error']);
    expect(parsed.error).toEqual({
      message: 'B13 no context test',
      stack: 'B13 stack',
    });
  });
});
