/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { withBatchFixture, batchGate } from './addbatch-stream-test-helpers.js';
import { HistoryService } from './HistoryService.js';
import {
  assertOwnerBound,
  oracleExport,
  seedRows,
  sha256,
  exportSummaryRow,
  recordExportSummaryOwners,
} from './export-summary-test-helpers.js';

describe('streamed history JSON export', () => {
  it.each([512, 8192])(
    'writes exact legacy bytes for %i mixed durable rows without retaining the document',
    async (size) => {
      await withBatchFixture(async ({ history, recorder, owners }) => {
        await seedRows(recorder, size);
        const root = mkdtempSync(join(process.cwd(), 'tmp/history-export-'));
        const path = join(root, 'history.json');
        writeFileSync(path, '');
        const hash = createHash('sha256');
        let bytes = 0;
        try {
          await history.writeJSON(async (chunk) => {
            bytes += Buffer.byteLength(chunk);
            hash.update(chunk);
            appendFileSync(path, chunk);
          });
          const expected = oracleExport(size);
          expect(bytes).toBe(Buffer.byteLength(expected));
          expect(hash.digest('hex')).toBe(sha256(expected));
          expect(readFileSync(path, 'utf8')).toBe(expected);
          expect('toJSON' in history).toBe(false);
          recordExportSummaryOwners('export', size, owners);
          assertOwnerBound(owners);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    },
    180000,
  );

  it('does not pull another row while the sink is backpressured and pins membership', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      await history.addBatch(
        Array.from({ length: 3 }, (_, index) => exportSummaryRow(index)),
      );
      await recorder.flush();
      const entered = batchGate();
      const release = batchGate();
      let text = '';
      let writes = 0;
      const output = history.writeJSON(async (chunk) => {
        text += chunk;
        writes++;
        if (writes === 2) {
          entered.resolve();
          await release.promise;
        }
      });
      await entered.promise;
      const before = owners.snapshot().acquisitions;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(owners.snapshot().acquisitions - before).toBe(0);
      history.add(exportSummaryRow(3));
      release.resolve();
      await output;
      await history.waitForTokenUpdates();
      expect(text).toBe(oracleExport(3));
      expect(history.length()).toBe(4);
      assertOwnerBound(owners);
    });
  });
});

describe('history JSON export lifecycle', () => {
  it('releases the cursor on sink error, early close, and cancellation of a stalled sink', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      await seedRows(recorder, 3);
      await expect(
        history.writeJSON(async () => {
          throw new Error('sink failed');
        }),
      ).rejects.toThrow('sink failed');
      expect(owners.snapshot().liveRows).toBe(0);
      const iterator = history.streamJSON();
      await iterator.next();
      await iterator.next();
      await iterator.return();
      assertOwnerBound(owners);
      const controller = new AbortController();
      const entered = batchGate();
      const never = batchGate();
      const output = history.writeJSON(async () => {
        entered.resolve();
        await never.promise;
      }, controller.signal);
      await entered.promise;
      controller.abort(new Error('export aborted'));
      await expect(output).rejects.toThrow('export aborted');
      never.resolve();
      assertOwnerBound(owners);
      let observed = '';
      await history.writeJSON(async (chunk) => {
        observed += chunk;
      });
      expect(observed).toBe(oracleExport(3));
    });
  });

  it('exports empty history and a valid row larger than 8 MiB', async () => {
    const empty = new HistoryService();
    let output = '';
    try {
      await empty.writeJSON(async (chunk) => {
        output += chunk;
      });
      expect(output).toBe('[]');
    } finally {
      empty.dispose();
    }
    await withBatchFixture(async ({ history, recorder, owners }) => {
      const row = exportSummaryRow(0, 9 * 1024 * 1024);
      await recorder.commit('content', { content: row });
      const hash = createHash('sha256');
      await history.writeJSON(async (chunk) => {
        hash.update(chunk);
      });
      expect(hash.digest('hex')).toBe(sha256(JSON.stringify([row], null, 2)));
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180000);
});
