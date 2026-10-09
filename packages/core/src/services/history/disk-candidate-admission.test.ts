/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { HistoryService } from './HistoryService.js';
import { ownerFixtureRow } from './chronology-rollback-owner-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
  rollbackRow,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

async function compensationPressure(size: number): Promise<{
  readonly pending: number;
  readonly bytes: number;
}> {
  const root = mkdtempSync(
    join(import.meta.dir, '../../../../../tmp/candidate-admission-'),
  );
  let release: (() => void) | undefined;
  let reached: (() => void) | undefined;
  let compensating = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const recorder = new SessionRecordingService({
    sessionId: 'candidate-admission',
    projectHash: 'candidate-admission',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    maxQueueBytes: Number.POSITIVE_INFINITY,
    io: {
      appendFile: async (filePath, data, encoding): Promise<void> => {
        if (compensating) {
          reached?.();
          await gate;
        }
        await appendFile(filePath, data, encoding);
      },
    },
  });
  const history = new HistoryService({ recording: recorder });
  history.setTokenizerFactory(exactTokenizer());
  try {
    for (let index = 0; index < size; index++) {
      await recorder.commit('content', {
        content: ownerFixtureRow(index, 2048),
      });
    }
    const primary = new Error('force compensation');
    history.once('tokensUpdated', () => {
      compensating = true;
      throw primary;
    });
    const operation = rejectedValue(
      history.applyDensityResult({
        replacements: new Map(),
        removals: [size - 1],
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 1,
        },
      }),
    );
    await ready;
    const pending = recorder.getPendingRecordCount();
    const bytes = recorder.getPendingByteCount();
    release?.();
    expect(await operation).toBe(primary);
    await history.waitForCommit();
    let restored = 0;
    for await (const row of history.getRecent(0)) {
      expect(row).toStrictEqual(ownerFixtureRow(restored++, 2048));
    }
    expect(restored).toBe(size);
    return { pending, bytes };
  } finally {
    release?.();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('disk candidate journal admission under writer backpressure', () => {
  it('preserves pending source identities and rollback settlement while the writer is blocked', async () => {
    await withRollbackFixture(async (history, _recorder, releaseWriter) => {
      const before = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
      await history.addBatch(before);
      const primary = new Error('pending density publication');
      history.once('tokensUpdated', () => {
        throw primary;
      });
      let settled = false;
      const operation = rejectedValue(
        history.applyDensityResult({
          replacements: new Map(),
          removals: [2],
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 1,
          },
        }),
      ).then((error) => {
        settled = true;
        return error;
      });
      await Bun.sleep(0);
      const settledWhileBlocked = settled;
      const restored = await collectRawHistory(history);
      releaseWriter();
      expect(await operation).toBe(primary);
      expect(settledWhileBlocked).toBe(true);
      for (const [index, row] of restored.entries())
        expect(row).toBe(before[index]);
      expect(restored).toHaveLength(3);
      expect(history.getTotalTokens()).toBe(12);
    }, true);
  });

  for (const size of [512, 8192]) {
    it(`bounds compensation admissions while restoring all ${size} source rows`, async () => {
      const result = await compensationPressure(size);
      const output = process.env.CHRONOLOGY_CANDIDATE_OUTPUT;
      if (output !== undefined)
        appendFileSync(
          output,
          JSON.stringify({ kind: 'admission', size, ...result }) +
            String.fromCharCode(10),
        );
      expect(result.pending).toBeLessThanOrEqual(2);
      expect(result.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    }, 120_000);
  }
});
