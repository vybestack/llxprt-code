/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecordingFailureStore,
  RecordingFailureReport,
} from './recording-failure-report.js';

const directories: string[] = [];
function fixture(): { root: string; store: RecordingFailureStore } {
  const root = mkdtempSync(join(tmpdir(), 'recording-failure-contract-'));
  directories.push(root);
  return { root, store: new RecordingFailureStore(root) };
}

async function generations(report: RecordingFailureReport): Promise<number[]> {
  const result: number[] = [];
  for await (const detail of report.details()) {
    if (detail.kind === 'failure') result.push(detail.generation);
  }
  return result;
}

function cleanup(): void {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
}
describe('disk-backed recording failure contract', () => {
  afterEach(cleanup);
  it('closing a suspended cursor terminates it without yielding buffered records', async () => {
    const { root, store } = fixture();
    store.record(1, new Error('large failure', { cause: 'x'.repeat(100000) }));
    const report = store.takeThrough(1, 'flush');
    if (report === undefined) throw new Error('Missing report');
    const cursor = report.details();
    expect((await cursor.next()).done).toBe(false);
    await report.close();
    expect((await cursor.next()).done).toBe(true);
    expect(readdirSync(root)).toStrictEqual([]);
  });
  for (const count of [512, 8192]) {
    it(`delivers all ${count} errors in generation order without an aggregate array`, async () => {
      const { root, store } = fixture();
      for (let generation = count; generation > 0; generation -= 1) {
        store.record(
          generation,
          new Error(`failed-${generation}`, {
            cause: { row: `payload-${generation}` },
          }),
        );
      }
      const report = store.takeThrough(count, 'Persistence failed');
      if (report === undefined) throw new Error('Missing report');
      expect(report).not.toBeInstanceOf(AggregateError);
      expect('errors' in report).toBe(false);
      expect(report.count).toBe(count);
      expect(await generations(report)).toStrictEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
      expect(readdirSync(root)).toStrictEqual([]);
    });
  }

  it('preserves a live single cause and describes arbitrary values without claiming disk identity', async () => {
    const { store } = fixture();
    const cause = { code: 42n, row: 'large'.repeat(20000), callback: () => 7 };
    store.record(1, cause);
    const report = store.takeThrough(1, 'Persistence failed');
    if (report === undefined) throw new Error('Missing report');
    expect(report.cause).toBe(cause);
    const kinds = new Set<string>();
    let row = '';
    let largestRecord = 0;
    for await (const detail of report.details()) {
      kinds.add(detail.kind);
      largestRecord = Math.max(
        largestRecord,
        Buffer.byteLength(JSON.stringify(detail)),
      );
      if (detail.path === '$.row' && detail.kind === 'string')
        row += detail.value;
    }
    expect(row).toBe(cause.row);
    expect(kinds.has('bigint')).toBe(true);
    expect(kinds.has('function')).toBe(true);
    expect(largestRecord).toBeLessThan(32 * 1024);
  });
});
describe('failure cursor terminal ownership', () => {
  afterEach(cleanup);
  it('rejects a missing owned diagnostic file instead of silently dropping a failure', async () => {
    const { root, store } = fixture();
    store.record(1, new Error('must remain observable'));
    const report = store.takeThrough(1, 'flush');
    if (report === undefined) throw new Error('Missing report');
    rmSync(join(root, '1.jsonl'));
    await expect(generations(report)).rejects.toThrow(
      'Incomplete recording failure report',
    );
  });
  it('isolates later generations and closes an abandoned cursor deterministically', async () => {
    const { root, store } = fixture();
    const later = new Error('later cause');
    store.record(1, new Error('first cause'));
    store.record(2, later);
    const first = store.takeThrough(1, 'first');
    if (first === undefined) throw new Error('Missing first report');
    for await (const detail of first.details()) {
      expect(detail.generation).toBe(1);
      break;
    }
    expect(readdirSync(root)).toHaveLength(1);
    expect(store.takeThrough(1, 'duplicate')).toBeUndefined();
    const second = store.takeThrough(2, 'second', later);
    if (second === undefined) throw new Error('Missing second report');
    expect(second.cause).toBe(later);
    await second.close();
    await second.close();
    expect(readdirSync(root)).toStrictEqual([]);
  });

  it('leaves a failed cursor cleanup retryable and preserves the diagnostic files', async () => {
    const { root, store } = fixture();
    store.record(1, new Error('persisted before cleanup failure'));
    const report = store.takeThrough(1, 'cleanup');
    if (report === undefined) throw new Error('Missing report');
    const file = join(root, readdirSync(root)[0]);
    rmSync(file);
    writeFileSync(file, 'not a report\n');
    await expect(generations(report)).rejects.toThrow('Unexpected');
    await report.close();
    expect(readdirSync(root)).toStrictEqual([]);
  });
});
