/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useBackendEnv } from '../../recording/__tests__/support/backendEnv.js';
import { exportSummaryRow, sha256 } from './export-summary-test-helpers.js';
import { HistoryService } from './HistoryService.js';

/**
 * The journal twin of history-export-stream.test.ts. The old-store test seeds
 * the recorder file and counts decoded owners; the journal store has no
 * recorder-file seed and reports its decoded rows through the read counters,
 * so the contract here is the exported bytes, the pin on the version the
 * export started on, and the release of the reader on every way out. The
 * journal stamps chronology on every row it takes in, so the oracle is the
 * rows as the history stores them.
 */
describe('streamed history JSON export on the journal store', () => {
  const selectBackendForTest = useBackendEnv();
  let history: HistoryService;
  beforeEach(() => {
    selectBackendForTest('journal');
    history = new HistoryService();
  });
  afterEach(async () => {
    await history.dispose();
  });

  async function exported(): Promise<string> {
    let text = '';
    await history.writeJSON(async (chunk) => {
      text += chunk;
    });
    return text;
  }

  /** The legacy document: the stored rows as one JSON array with two-space indent. */
  async function oracle(): Promise<string> {
    return JSON.stringify(
      await Array.fromAsync(history.streamRawHistory()),
      null,
      2,
    );
  }

  async function seed(size: number): Promise<void> {
    await history.addBatch(
      Array.from({ length: size }, (_, index) => exportSummaryRow(index)),
    );
    await history.waitForCommit();
  }

  it.each([512, 2048])(
    'writes exact legacy bytes for %i mixed rows',
    async (size) => {
      await seed(size);
      const hash = createHash('sha256');
      let bytes = 0;

      await history.writeJSON(async (chunk) => {
        bytes += Buffer.byteLength(chunk);
        hash.update(chunk);
      });

      const expected = await oracle();
      expect(bytes).toBe(Buffer.byteLength(expected));
      expect(hash.digest('hex')).toBe(sha256(expected));
      expect('toJSON' in history).toBe(false);
    },
    180000,
  );

  it('does not pull another row while the sink is stalled and pins the version it started on', async () => {
    await seed(3);
    const snapshot = await oracle();
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const reachedSink = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let text = '';
    let writes = 0;
    const output = history.writeJSON(async (chunk) => {
      text += chunk;
      writes++;
      if (writes === 2) {
        entered();
        await stalled;
      }
    });
    await reachedSink;
    const writesWhileStalled = writes;
    await new Promise<void>((resolve) => setImmediate(resolve));
    history.add(exportSummaryRow(3));
    await history.waitForCommit();
    expect(writes).toBe(writesWhileStalled);
    release();
    await output;

    expect(text).toBe(snapshot);
    expect(history.length()).toBe(4);
  });

  it('releases the reader on sink error, early close and cancellation of a stalled sink', async () => {
    await seed(3);
    await expect(
      history.writeJSON(async () => {
        throw new Error('sink failed');
      }),
    ).rejects.toThrow('sink failed');
    const iterator = history.streamJSON();
    await iterator.next();
    await iterator.next();
    await iterator.return();
    const controller = new AbortController();
    let entered!: () => void;
    const reachedSink = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let neverResolved!: () => void;
    const never = new Promise<void>((resolve) => {
      neverResolved = resolve;
    });
    const output = history.writeJSON(async () => {
      entered();
      await never;
    }, controller.signal);
    await reachedSink;
    controller.abort(new Error('export aborted'));
    await expect(output).rejects.toThrow('export aborted');
    neverResolved();

    expect(await exported()).toBe(await oracle());
  });

  it('exports an empty history and a valid row larger than 8 MiB', async () => {
    expect(await exported()).toBe('[]');
    const row = exportSummaryRow(0, 9 * 1024 * 1024);
    await history.addBatch([row]);
    await history.waitForCommit();
    const hash = createHash('sha256');

    await history.writeJSON(async (chunk) => {
      hash.update(chunk);
    });

    expect(hash.digest('hex')).toBe(sha256(await oracle()));
  }, 180000);
});
