/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  recordRealProviderRun,
  readLedger,
  type RealProviderRunRecord,
} from './model-request-ledger.js';
import { setEnv, restoreEnv } from './env-test-helpers.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-ledger-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  restoreEnv();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('recordRealProviderRun', () => {
  it('is a no-op when the ledger env var is unset', () => {
    setEnv('LLXPRT_E2E_MODEL_LEDGER', undefined);
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');

    recordRealProviderRun({
      testName: 'unset-env-test',
      testDir: dir,
    });

    expect(existsSync(ledgerPath)).toBe(false);
  });

  it('is a no-op when the ledger env var is an empty string', () => {
    setEnv('LLXPRT_E2E_MODEL_LEDGER', '');
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger-empty.jsonl');

    recordRealProviderRun({
      testName: 'empty-env-test',
      testDir: dir,
    });

    expect(existsSync(ledgerPath)).toBe(false);
  });

  it('is a no-op when the ledger env var is whitespace-only', () => {
    setEnv('LLXPRT_E2E_MODEL_LEDGER', '   ');
    const dir = makeTempDir();

    recordRealProviderRun({
      testName: 'whitespace-env-test',
      testDir: dir,
    });

    expect(existsSync(join(dir, 'ledger.jsonl'))).toBe(false);
  });

  it('creates the parent directory when it does not yet exist', () => {
    const dir = makeTempDir();
    const nestedDir = join(dir, 'nested', 'deep', 'path');
    const ledgerPath = join(nestedDir, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    expect(existsSync(nestedDir)).toBe(false);

    recordRealProviderRun({
      testName: 'mkdir-test',
      testDir: dir,
    });

    expect(existsSync(nestedDir)).toBe(true);
    expect(existsSync(ledgerPath)).toBe(true);
    const content = readFileSync(ledgerPath, 'utf-8').trim();
    expect(content).toBe(
      JSON.stringify({ testName: 'mkdir-test', testDir: dir }),
    );
  });

  it('writes one JSON line per call, preserving order', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    recordRealProviderRun({
      testName: 'first-test',
      testDir: '/tmp/first',
    });
    recordRealProviderRun({
      testName: 'second-test',
      testDir: '/tmp/second',
    });

    const lines = readFileSync(ledgerPath, 'utf-8')
      .split('\n')
      .filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      testName: 'first-test',
      testDir: '/tmp/first',
    });
    expect(JSON.parse(lines[1])).toEqual({
      testName: 'second-test',
      testDir: '/tmp/second',
    });
  });

  it('never truncates prior content on successive appends', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    const count = 20;
    for (let i = 0; i < count; i++) {
      recordRealProviderRun({
        testName: `sequential-test-${i}`,
        testDir: `/tmp/dir-${i}`,
      });
    }

    const records = readLedger(ledgerPath);
    expect(records).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      expect(records[i]?.testName).toBe(`sequential-test-${i}`);
    }
  });

  // The E2E runner executes one process per test file, so several processes
  // append to the same ledger concurrently. Every record must survive.
  it('retains every record when separate processes append concurrently', async () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    const writerPath = join(dir, 'writer.ts');
    const modulePath = join(import.meta.dirname, 'model-request-ledger.ts');
    const writerLines = [
      `import { recordRealProviderRun } from ${JSON.stringify(modulePath)};`,
      'const label = process.argv[2];',
      'for (let i = 0; i < 25; i++) {',
      '  recordRealProviderRun({ testName: label, testDir: "/tmp/" + label });',
      '}',
    ];
    writeFileSync(writerPath, writerLines.join(String.fromCharCode(10)));

    const labels = ['writer-a', 'writer-b', 'writer-c', 'writer-d'];
    const exitCodes = await Promise.all(
      labels.map(async (label) => {
        const child = Bun.spawn([process.execPath, writerPath, label], {
          env: { ...process.env, LLXPRT_E2E_MODEL_LEDGER: ledgerPath },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        return await child.exited;
      }),
    );
    expect(exitCodes).toEqual([0, 0, 0, 0]);

    const records = readLedger(ledgerPath);
    expect(records).toHaveLength(labels.length * 25);
    for (const label of labels) {
      expect(records.filter((r) => r.testName === label)).toHaveLength(25);
    }
  }, 30_000);
});

describe('readLedger', () => {
  it('throws a descriptive error when the file does not exist', () => {
    const missingPath = join(makeTempDir(), 'does-not-exist.jsonl');

    expect(() => readLedger(missingPath)).toThrow(missingPath);
  });

  it('ignores blank lines', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    const record: RealProviderRunRecord = {
      testName: 'blank-line-test',
      testDir: '/tmp/blank',
    };
    writeFileSync(
      ledgerPath,
      `${JSON.stringify(record)}\n\n  \n${JSON.stringify(record)}\n\n`,
    );

    const records = readLedger(ledgerPath);
    expect(records).toHaveLength(2);
  });

  it('throws when a line is not valid JSON, quoting the offending line', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    const badLine = 'this is not json {{{';
    writeFileSync(ledgerPath, `${badLine}\n`);

    expect(() => readLedger(ledgerPath)).toThrow(badLine);
  });

  it('throws when a JSON line is missing testName', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    writeFileSync(ledgerPath, `${JSON.stringify({ testDir: '/tmp/x' })}\n`);

    expect(() => readLedger(ledgerPath)).toThrow('testName');
  });

  it('throws when a JSON line is missing testDir', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    writeFileSync(ledgerPath, `${JSON.stringify({ testName: 'has-name' })}\n`);

    expect(() => readLedger(ledgerPath)).toThrow('testDir');
  });

  it('throws when testName is an empty string', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    writeFileSync(
      ledgerPath,
      `${JSON.stringify({ testName: '', testDir: '/tmp/x' })}\n`,
    );

    expect(() => readLedger(ledgerPath)).toThrow('testName');
  });

  it('round-trips records written by recordRealProviderRun', () => {
    const dir = makeTempDir();
    const ledgerPath = join(dir, 'ledger.jsonl');
    setEnv('LLXPRT_E2E_MODEL_LEDGER', ledgerPath);

    const records: RealProviderRunRecord[] = [
      { testName: 'round-trip-a', testDir: '/tmp/a' },
      { testName: 'round-trip-b', testDir: '/tmp/b' },
    ];
    for (const record of records) {
      recordRealProviderRun(record);
    }

    const read = readLedger(ledgerPath);
    expect(read).toEqual(records);
  });
});
