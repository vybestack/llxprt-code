/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { JournalRecordingService } from '../../packages/core/src/recording/journalRecordingService.js';
import { RecordingIntegration } from '../../packages/core/src/recording/RecordingIntegration.js';
import { RecordingFailureReport } from '../../packages/core/src/recording/recording-failure-report.js';
import { testJournalSeams } from '../../packages/core/src/journal/__tests__/support/journalFixtures.js';

async function settled(): Promise<{ heap: number; external: number }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}

async function failures(
  integration: RecordingIntegration,
  count: number,
): Promise<RecordingFailureReport> {
  let report: RecordingFailureReport | undefined;
  for (let generation = 1; generation <= count; generation += 1) {
    await report?.close();
    try {
      await integration.flushAtTurnBoundary();
      throw new Error('Expected native failure');
    } catch (error: unknown) {
      if (!(error instanceof RecordingFailureReport)) throw error;
      if (error.count !== 1 || error.firstGeneration !== generation + 1)
        throw new Error('Native failure generation lost');
      report = error;
    }
  }
  if (report === undefined) throw new Error('Missing native report');
  return report;
}

const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const count = Number(process.argv[2]);
const trap = process.argv[3] === 'trap';
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error('Expected positive failure count');
const root = mkdtempSync(join(tmpdir(), 'recording-failure-native-memory-'));
const seams = testJournalSeams({}, 1, false);
let fail = false;
const row = { text: randomBytes(1536).toString('base64') };
const original = new Error('native failed write', { cause: { row } });
const recording = JournalRecordingService.create({
  sessionId: 'memory-native',
  projectHash: 'memory-native',
  chatsDir: join(root, 'chats'),
  provider: 'test',
  model: 'test',
  workspaceDirs: [],
  journal: {
    journal: {
      ...seams.dependencies,
      open: async (path, flags) => {
        const handle = await seams.dependencies.open(path, flags);
        return {
          ...handle,
          writev: (buffers, position) => {
            if (fail) return Promise.reject(original);
            return handle.writev(buffers, position);
          },
        };
      },
    },
  },
});
const history = new HistoryService({ backend: 'journal' });
const integration = new RecordingIntegration(
  recording,
  undefined,
  join(root, 'reports'),
);
try {
  await integration.subscribeToJournal(history);
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'baseline' }],
  });
  await integration.flushAtTurnBoundary();
  const before = await settled();
  const probes: Array<WeakRef<{ text: string }>> = [new WeakRef(row)];
  const retained: Error[] = [];
  for (let generation = 1; generation <= count; generation += 1) {
    const payload = { text: randomBytes(1536).toString('base64') };
    probes.push(new WeakRef(payload));
    if (trap)
      retained.push(
        new Error(`trap-${generation}`, { cause: { row: payload } }),
      );
  }
  const trappedSummary = trap
    ? new AggregateError(retained, 'Independent eager-report trap')
    : undefined;
  retained.length = 0;
  fail = true;
  history.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'failed row' }],
  });
  const report = await failures(integration, count);
  if (report.cause !== original)
    throw new Error('Native failure identity lost');
  const cursor = report.details();
  let heldDetail = await cursor.next();
  while (!heldDetail.done) {
    if (
      heldDetail.value.kind === 'string' &&
      heldDetail.value.path === '$.cause.row.text'
    )
      break;
    heldDetail = await cursor.next();
  }
  if (heldDetail.done) throw new Error('Missing native row diagnostic');
  const held = await settled();
  let liveRows = 0;
  let liveBytes = 0;
  for (const probe of probes) {
    const payload = probe.deref();
    if (payload !== undefined) {
      liveRows += 1;
      liveBytes += Buffer.byteLength(payload.text);
    }
  }
  process.stdout.write(
    JSON.stringify({
      count,
      heldReportCount: report.count,
      heap: held.heap - before.heap,
      external: held.external - before.external,
      liveRows,
      liveBytes,
      decodedDetails: 1,
      diagnosticBytes: Buffer.byteLength(JSON.stringify(heldDetail.value)),
      trap,
      retainedErrors: trappedSummary?.errors.length ?? 0,
    }) + '\n',
  );
  await report.close();
  if (!(await cursor.next()).done)
    throw new Error('Closed native cursor kept producing details');
  if (trap && trappedSummary?.errors.length !== count)
    throw new Error('Independent trap lost owners');
} finally {
  await integration.dispose();
  await history.dispose();
  await recording.dispose();
}
