/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import {
  withDetachedFixture,
  detachedRow,
  detachedRows,
  detachedDurableDigest,
  type DetachedFixture,
} from '../../packages/core/src/services/history/detached-rollback-test-helpers.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
  rejectedValue,
} from '../../packages/core/src/services/history/chronology-rollback-test-helpers.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import type { DetachedHistoryOptions } from '../../packages/core/src/services/history/detachedHistoryAPI.js';

type Lane = 'normal' | 'array' | 'pending';
function readLane(value: string | undefined): Lane {
  if (value === undefined || value === 'normal') return 'normal';
  if (value === 'array' || value === 'pending') return value;
  throw new Error('Unknown probe lane');
}
function deferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
interface MemoryFixture extends DetachedFixture {
  readonly writerBlocked: Promise<void>;
  readonly releasePublication: () => void;
}
async function withMemoryFixture(
  action: (fixture: MemoryFixture) => Promise<void>,
  pending: boolean,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'detached-memory-fixture-'));
  const original = deferred();
  const blocked = deferred();
  const publication = deferred();
  let rewound = false;
  let paused = false;
  if (!pending) original.resolve();
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'detached',
    projectHash: 'detached',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        await original.promise;
        if (data.includes('"type":"rewind"')) rewound = true;
        if (rewound && !paused && data.includes('"type":"content"')) {
          paused = true;
          blocked.resolve();
          await publication.promise;
        }
        await appendFile(file, data, encoding);
      },
    },
  });
  const owners = new RowOwnership();
  const history = new HistoryService({
    recording: recorder,
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await action({
      history,
      recorder,
      owners,
      releaseWriter: original.resolve,
      writerBlocked: blocked.promise,
      releasePublication: publication.resolve,
    });
  } finally {
    original.resolve();
    publication.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}
async function settled(): Promise<{ heap: number; external: number }> {
  await setImmediate();
  gcAndSweep();
  await setImmediate();
  gcAndSweep();
  return { heap: heapSize(), external: process.memoryUsage().external };
}
function submit(
  fixture: DetachedFixture,
  size: number,
  lane: Lane,
  options: DetachedHistoryOptions,
): Promise<void> {
  if (lane === 'array')
    return fixture.history.detachedValues.replace(
      Array.from({ length: size }, (_, index) => detachedRow(index)),
      undefined,
      options,
    );
  return fixture.history.detachedValues.transform(
    async (source, sink) => {
      for await (const row of source.streamRows()) sink.appendValue(row);
    },
    undefined,
    options,
  );
}
async function pendingRows(
  fixture: DetachedFixture,
  size: number,
): Promise<void> {
  for (let index = 0; index < size; index++)
    fixture.history.add(detachedRow(index));
  await fixture.history.waitForTokenUpdates();
}
async function sampleOperation(
  fixture: MemoryFixture,
  size: number,
  trap: boolean,
  lane: Lane,
  before: Awaited<ReturnType<typeof settled>>,
  retained: IContent[],
): Promise<void> {
  const { history, recorder, owners, releaseWriter, releasePublication } =
    fixture;
  const ready = deferred();
  const gate = deferred();
  let ackEntered = false;
  const failure = new Error('memory rollback');
  const operation = rejectedValue(
    submit(fixture, size, lane, {
      onAcknowledged: async (): Promise<void> => {
        ackEntered = true;
        ready.resolve();
        await gate.promise;
        throw failure;
      },
    }),
  );
  const unexpected = operation.then((error): never => {
    throw error ?? new Error('Early completion');
  });
  try {
    if (lane === 'pending')
      while (owners.snapshot().liveRows === 0) await setImmediate();
    const pre = owners.snapshot();
    releaseWriter();
    await Promise.race([fixture.writerBlocked, unexpected]);
    await settled();
    const writer = owners.snapshot();
    const writerAckEntered = ackEntered;
    const writerVisibleRows = history.getContextRange().totalEntries;
    const writerDurableRows = (await detachedDurableDigest(recorder)).count;
    releasePublication();
    await Promise.race([ready.promise, unexpected]);
    const held = await settled();
    const stats = owners.snapshot();
    process.stdout.write(
      JSON.stringify({
        size,
        trap,
        lane,
        preRows: pre.liveRows,
        preBytes: pre.liveSerializedBytes,
        writerRows: writer.liveRows,
        writerBytes: writer.liveSerializedBytes,
        writerAckEntered,
        writerVisibleRows,
        writerDurableRows,
        heap: held.heap - before.heap,
        external: held.external - before.external,
        heldRows: stats.liveRows,
        heldBytes: stats.liveSerializedBytes,
        trapRows: retained.length,
      }) + '\n',
    );
  } finally {
    releaseWriter();
    releasePublication();
    gate.resolve();
    await operation;
    for (const row of retained) owners.release(row);
    retained.length = 0;
  }
  if ((await operation) !== failure) throw new Error('Lost rollback failure');
  if (owners.snapshot().liveRows !== 0)
    throw new Error('Leaked registered owners');
  if (owners.snapshot().liveSerializedBytes !== 0)
    throw new Error('Leaked registered bytes');
}
async function probe(size: number, trap: boolean, lane: Lane): Promise<void> {
  await withMemoryFixture(async (fixture) => {
    const { history, recorder, owners } = fixture;
    if (lane !== 'pending')
      for (let index = 0; index < size; index++)
        await recorder.commit('content', { content: detachedRow(index) });
    const before = await settled();
    if (lane === 'pending') await pendingRows(fixture, size);
    const retained: IContent[] = [];
    if (trap)
      for await (const row of history.streamRawHistory()) {
        retained.push(row);
        owners.retain(row);
      }
    await sampleOperation(fixture, size, trap, lane, before, retained);
  }, lane === 'pending');
}
const pin = readFileSync(
  new URL('../../.bun-version', import.meta.url),
  'utf8',
).trim();
if (Bun.version !== pin)
  throw new Error(`Expected Bun ${pin}; got ${Bun.version}`);
const size = Number(process.argv[2]);
if (!Number.isSafeInteger(size) || size < 1)
  throw new Error('Expected positive row count');
await withDetachedFixture(async ({ history }) => {
  await history.detachedValues.replace(detachedRows(32));
  await history.detachedValues.transform(async (source, sink) => {
    for await (const row of source.streamRows()) sink.appendValue(row);
  });
});
await probe(size, process.argv[3] === 'trap', readLane(process.argv[4]));
