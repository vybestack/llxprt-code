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
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reportError } from './errorReporting.js';

// Constants restated from the specification (tests are the specification)
const MAX_REPORT_FILES = 20;
const MAX_REPORT_TOTAL_BYTES = 1_048_576;
const REPORT_FILE_PATTERN = /^llxprt-client-error-.*\.json$/;

async function seedReport(
  dir: string,
  ordinal: number,
  content: string,
): Promise<string> {
  const padded = String(ordinal).padStart(2, '0');
  const name = `llxprt-client-error-seed-${padded}-2026-08-07T00-00-${padded}-000Z.json`;
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

async function listMatchingFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir);
  return entries.filter((name) => REPORT_FILE_PATTERN.test(name)).sort();
}

async function sumMatchingBytes(dir: string): Promise<number> {
  const files = await listMatchingFiles(dir);
  let total = 0;
  for (const name of files) {
    const stat = await fs.stat(path.join(dir, name));
    total += stat.size;
  }
  return total;
}

describe('errorReport rotation (issue 3113)', () => {
  let testDir: string;
  let stderrSpy: ReturnType<typeof spyOn>;
  let stderrCalls: string[];

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-rotation-'));
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
    setSystemTime();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function mtimeForIndex(
    i: number,
    oldestMtime: Date,
    tiedMtime: Date,
    newerMtime: Date,
  ): Date {
    if (i === 19) {
      return oldestMtime;
    }
    if (i <= 1) {
      return tiedMtime;
    }
    return newerMtime;
  }

  async function regularReportNames(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir);
    const regularReports: string[] = [];
    for (const name of entries) {
      if (!REPORT_FILE_PATTERN.test(name)) {
        continue;
      }
      const stat = await fs.stat(path.join(dir, name));
      if (stat.isFile()) {
        regularReports.push(name);
      }
    }
    return regularReports;
  }

  // R1: 20 files + 1 more -> exactly 20 remain
  it('R1: caps matching file count at MAX_REPORT_FILES after one more write', async () => {
    for (let i = 0; i < 20; i++) {
      await seedReport(testDir, i, `seed-${i}`);
    }

    await reportError(
      new Error('R1 rotation test error'),
      'R1 base',
      undefined,
      'r1-type',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(MAX_REPORT_FILES);
  });

  it('R2: orders by mtime first and filename for equal mtimes', async () => {
    const oldestMtime = new Date('2026-08-04T00:00:00.000Z');
    const tiedMtime = new Date('2026-08-05T00:00:00.000Z');
    const newerMtime = new Date('2026-08-06T00:00:00.000Z');
    for (let i = 0; i < 21; i++) {
      const seededPath = await seedReport(testDir, i, `seed-${i}`);
      const mtime = mtimeForIndex(i, oldestMtime, tiedMtime, newerMtime);
      await fs.utimes(seededPath, mtime, mtime);
    }

    await reportError(
      new Error('R2 oldest-first test error'),
      'R2 base',
      undefined,
      'r2-type',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(MAX_REPORT_FILES);
    expect(files.some((name) => name.includes('seed-19-'))).toBe(false);
    expect(files.some((name) => name.includes('seed-00-'))).toBe(false);
    expect(files.some((name) => name.includes('seed-01-'))).toBe(true);
    const newReportFile = files.find((name) => name.includes('r2-type'));
    expect(newReportFile).toBeDefined();
    const raw = await fs.readFile(path.join(testDir, newReportFile!), 'utf-8');
    const parsed = JSON.parse(raw);
    expect((parsed.error as { message: string }).message).toBe(
      'R2 oldest-first test error',
    );
  });

  // R3: 8 files whose total exceeds the byte budget after one more write
  it('R3: enforces total-byte budget, deleting oldest to stay under limit', async () => {
    const content128KiB = 'r'.repeat(131_072);
    for (let i = 0; i < 8; i++) {
      await seedReport(testDir, i, content128KiB);
    }

    await reportError(
      new Error('R3 byte cap test error'),
      'R3 base',
      undefined,
      'r3-type',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(8);
    const seed00Name = files.find((f) => f.includes('seed-00-'));
    expect(seed00Name).toBeUndefined();
    const totalBytes = await sumMatchingBytes(testDir);
    expect(totalBytes).toBeLessThanOrEqual(MAX_REPORT_TOTAL_BYTES);
  });

  it('R3b: does not rotate at exact total-byte equality', async () => {
    const error = new Error('R3b equality boundary');
    error.stack = 'R3b stack';
    const newReport = JSON.stringify({
      error: { message: error.message, stack: error.stack },
    });
    const newReportBytes = Buffer.byteLength(newReport, 'utf8');
    const seedPath = await seedReport(
      testDir,
      0,
      'e'.repeat(MAX_REPORT_TOTAL_BYTES - newReportBytes),
    );

    await reportError(error, 'R3b base', undefined, 'r3b-type', testDir);

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(2);
    expect(files).toContain(path.basename(seedPath));
    expect(await sumMatchingBytes(testDir)).toBe(MAX_REPORT_TOTAL_BYTES);
  });

  // R4: Non-matching files survive; directories named like reports excluded
  it('R4: preserves unrelated files and excludes directories from rotation', async () => {
    for (let i = 0; i < 20; i++) {
      await seedReport(testDir, i, `seed-${i}`);
    }
    // Unrelated files
    await fs.writeFile(path.join(testDir, 'unrelated.json'), 'unrelated');
    await fs.writeFile(
      path.join(testDir, 'llxprt-client-error-x.json.tmp'),
      'tmp',
    );
    await fs.writeFile(path.join(testDir, 'notes.txt'), 'notes');
    // Directory named like a report
    await fs.mkdir(path.join(testDir, 'llxprt-client-error-dir.json'));

    await reportError(
      new Error('R4 unrelated files test error'),
      'R4 base',
      undefined,
      'r4-type',
      testDir,
    );

    const matchingRegularFiles = await regularReportNames(testDir);
    expect(matchingRegularFiles.length).toBe(MAX_REPORT_FILES);
    // All non-matching entries survive
    expect(await fs.stat(path.join(testDir, 'unrelated.json'))).toBeDefined();
    expect(
      await fs.stat(path.join(testDir, 'llxprt-client-error-x.json.tmp')),
    ).toBeDefined();
    expect(await fs.stat(path.join(testDir, 'notes.txt'))).toBeDefined();
    expect(
      await fs.stat(path.join(testDir, 'llxprt-client-error-dir.json')),
    ).toBeDefined();
  });

  // R6: 3 files under both budgets -> all 4 exist after one more write
  it('R6: does not rotate when under both budgets', async () => {
    for (let i = 0; i < 3; i++) {
      await seedReport(testDir, i, `seed-${i}`);
    }

    await reportError(
      new Error('R6 no rotation test error'),
      'R6 base',
      undefined,
      'r6-type',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(4);
  });

  // R7: Write failure -> no rotation, all seeded files survive
  it('R7: does not rotate after a failed write', async () => {
    for (let i = 0; i < 25; i++) {
      await seedReport(testDir, i, `seed-${i}`);
    }
    setSystemTime(new Date('2026-08-07T12:34:56.789Z'));
    const blockedName =
      'llxprt-client-error-r7-type-2026-08-07T12-34-56-789Z.json';
    await fs.mkdir(path.join(testDir, blockedName));

    await reportError(
      new Error('R7 no rotate on fail test error'),
      'R7 base',
      ['R7 context'],
      'r7-type',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBe(26);
    const regularReports = await regularReportNames(testDir);
    expect(regularReports.length).toBe(25);
    const stderr = stderrCalls.join('');
    expect(stderr).toContain(
      'Additionally, failed to write detailed error report:',
    );
    expect(stderr).toContain(
      'Original error that triggered report generation:',
    );
    expect(stderr).toContain('Original context:');
  });

  it('R8: protects an overlapping cohort until a sequential write restores both budgets', async () => {
    for (let i = 0; i < 5; i++) {
      await seedReport(testDir, i, `seed-${i}`);
    }
    await fs.writeFile(path.join(testDir, 'unrelated.json'), 'unrelated');
    const largeContext = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`field-${i}`, 'x'.repeat(4_000)]),
    );
    const concurrentTypes = Array.from(
      { length: 25 },
      (_, i) => `r8-concurrent-${i}`,
    );

    await Promise.all(
      concurrentTypes.map((type) =>
        reportError(
          new Error(`R8 concurrent ${type}`),
          'R8 base',
          largeContext,
          type,
          testDir,
        ),
      ),
    );

    const concurrentFiles = await listMatchingFiles(testDir);
    for (const type of concurrentTypes) {
      expect(
        concurrentFiles.some((name) =>
          name.startsWith(`llxprt-client-error-${type}-`),
        ),
      ).toBe(true);
    }
    expect(await sumMatchingBytes(testDir)).toBeGreaterThan(
      MAX_REPORT_TOTAL_BYTES,
    );
    expect(await fs.stat(path.join(testDir, 'unrelated.json'))).toBeDefined();

    await reportError(
      new Error('R8 final sequential'),
      'R8 base',
      undefined,
      'r8-final',
      testDir,
    );

    const files = await listMatchingFiles(testDir);
    expect(files.length).toBeLessThanOrEqual(MAX_REPORT_FILES);
    expect(await sumMatchingBytes(testDir)).toBeLessThanOrEqual(
      MAX_REPORT_TOTAL_BYTES,
    );
    expect(files.some((name) => name.includes('r8-final'))).toBe(true);
  });
});
