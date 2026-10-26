/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stat, writeFile } from 'node:fs/promises';
import { JournalStore } from '../../journalStore.js';
import { JournalArrivalRecorder } from '../../arrival-recorder.js';
import { draftRow, storeDeps } from './storeFixtures.js';
import { testJournalSeams } from './journalFixtures.js';
import {
  realisticSessionRows,
  realisticSessionSummary,
} from '@vybestack/llxprt-code-test-utils/core/realistic-session.js';
import {
  assertSessionMemory,
  assertWholeHistoryControl,
  createWholeHistoryBufferingControl,
  measureRealisticSession,
  type SessionProbe,
  type SessionPayloadOwner,
  type SessionRouteAdapter,
} from '@vybestack/llxprt-code-test-utils/core/session-memory-protocol.js';

const [mode, root] = process.argv.slice(2);
if (!['positive', 'small', 'control'].includes(mode))
  throw new Error('Expected positive/small/control and output directory');
const small = mode === 'small';
const options = small ? { rowCount: 3124, payloadBytes: 8 * 1024 * 1024 } : {};
const path = join(root, `${mode}.llxj`);
const encoder = new TextEncoder();

async function record(
  store: JournalStore,
  probe: SessionProbe,
  owner: SessionPayloadOwner,
): Promise<{ bytes: number; sha256: string }> {
  const recorder = new JournalArrivalRecorder(store);
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  const total = small ? 3124 : 25000;
  try {
    for (const item of realisticSessionRows(options)) {
      owner.retain(item.text);
      const row = await recorder.beginRow(
        { ...draftRow(), blocks: [] },
        { id: item.id, submissionId: 'scale' },
      );
      const block = await recorder.beginBlock(row, 0);
      const payload = encoder.encode(item.text);
      for (let at = 0; at < payload.length; at += 64 * 1024)
        await recorder.appendField(block, payload.subarray(at, at + 64 * 1024));
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      count++;
      if (count === Math.floor(total / 4)) await probe.checkpoint('quarter');
      if (count === Math.floor(total / 2)) await probe.checkpoint('half');
      if (count === Math.floor((total * 3) / 4))
        await probe.checkpoint('three-quarter');
      if (count % 1024 === 0) probe.sample('record-append');
    }
    await probe.checkpoint('record-append');
    await recorder.flush();
    await probe.checkpoint('record-ack');
    await probe.checkpoint('terminal-publication');
    if (recorder.census.peakBytes > 256 * 1024)
      throw new Error('Recording charge exceeded');
    const snapshot = await store.snapshot();
    try {
      for await (const entry of snapshot.entries()) {
        const stored = await snapshot.readRow(entry);
        hash.update(stored.blocks[0]);
        bytes += stored.blocks[0].length;
      }
    } finally {
      await snapshot.close();
    }
    return { bytes, sha256: hash.digest('hex') };
  } finally {
    await recorder.close();
  }
}
const adapter: SessionRouteAdapter = {
  routeId: 'core-arrival-writer',
  operation: 'record',
  warmup: async () => {
    const store = await JournalStore.create(
      join(root, `warm-${mode}.llxj`),
      storeDeps({
        seams: testJournalSeams({}, 1, false),
        compactionDue: () => false,
      }),
    );
    const recorder = new JournalArrivalRecorder(store);
    try {
      for (let i = 0; i < 16; i++) {
        const row = await recorder.beginRow(
          { ...draftRow(), blocks: [] },
          { id: `warm-${i}`, submissionId: 'warm' },
        );
        const block = await recorder.beginBlock(row, 0);
        await recorder.appendField(block, encoder.encode('warmup'));
        await recorder.endBlock(block);
        await recorder.sealRow(row);
      }
    } finally {
      await recorder.close();
      await store.close();
    }
  },
  prepare: async () => {
    const summary = realisticSessionSummary(options);
    const store = await JournalStore.create(
      path,
      storeDeps({
        seams: testJournalSeams({}, 1, false),
        compactionDue: () => false,
      }),
    );
    let journalBytes = (await stat(path)).size;
    return {
      corpus: {
        rowCount: summary.rowCount,
        selectedRowCount: summary.rowCount,
        neutralPayloadBytes: summary.neutralPayloadBytes,
        selectedPayloadBytes: summary.neutralPayloadBytes,
        get journalBytes() {
          return journalBytes;
        },
        largestUnitBytes: summary.largestUnitBytes,
      },
      reference: { bytes: summary.neutralPayloadBytes, sha256: summary.sha256 },
      run: async (probe, owner) => {
        const digest = await record(store, probe, owner);
        journalBytes = (await stat(path)).size;
        await writeFile(
          join(root, `${mode}-disk.json`),
          JSON.stringify({ journalBytes: (await stat(path)).size }),
        );
        return digest;
      },
      close: () => store.close(),
    };
  },
};
const control =
  mode === 'control' ? createWholeHistoryBufferingControl() : undefined;
try {
  const measurement = await measureRealisticSession(adapter, control);
  await writeFile(
    join(root, `${mode}-measurement.json`),
    JSON.stringify(measurement),
  );
  if (control !== undefined) assertWholeHistoryControl(measurement, control);
  else if (!small) assertSessionMemory(measurement);
  process.stdout.write(JSON.stringify(measurement));
} finally {
  control?.release();
}
