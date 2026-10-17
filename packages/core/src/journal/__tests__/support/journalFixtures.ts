/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import type { FlushRecords } from '../../flushRecords.js';
import type {
  CommitAck,
  CommitGroup,
  GroupRecord,
  TrailerState,
} from '../../groupWriter.js';
import {
  createJournal,
  type JournalOpenDependencies,
} from '../../journalWriterOpen.js';
import type { JournalFileHandle } from '../../positionalFile.js';
import { MUTATION, RECORD_KIND } from '../../recordKinds.js';
import { randomTrailer } from './randomRecords.js';
import { SeededRandom } from './seededRandom.js';

/** What the writer asked of the file and of the flush, in the order it asked. */
export type JournalEvent =
  | {
      readonly type: 'write';
      readonly position: number;
      readonly length: number;
    }
  | { readonly type: 'flush'; readonly fd: number }
  | { readonly type: 'truncate'; readonly length: number }
  | { readonly type: 'open'; readonly flags: string };

export interface Failures {
  /** Zero-based index of the flush call that throws. */
  failFlushAt?: number;
  /** Zero-based index of the write call that throws. */
  failWriteAt?: number;
  failTruncate?: boolean;
  /** Holds the write at this index until `release` is called. */
  gateWriteAt?: number;
  /** Counts the positional reads that reach the file. */
  readCounter?: { reads: number };
  /** Holds every positional read until `promise` settles; `hits` counts the reads that arrived. */
  readGate?: { promise: Promise<void>; hits: number };
}

export interface TestJournalSeams {
  readonly events: JournalEvent[];
  readonly dependencies: JournalOpenDependencies;
  /** Lets a gated write proceed. */
  readonly release: () => void;
}

export const FAKE_NOW_MS = 1_900_000_000_000;

function wrapHandle(
  real: fsp.FileHandle,
  events: JournalEvent[],
  failures: Failures,
  gate: { promise: Promise<void> },
): JournalFileHandle {
  let writes = 0;
  const admit = async (position: number, length: number): Promise<void> => {
    const index = writes++;
    events.push({ type: 'write', position, length });
    if (failures.failWriteAt === index)
      throw new Error('injected write failure');
    if (failures.gateWriteAt === index) await gate.promise;
  };
  return {
    fd: real.fd,
    read: async (buffer, offset, length, position) => {
      if (failures.readCounter !== undefined) failures.readCounter.reads += 1;
      if (failures.readGate !== undefined) {
        failures.readGate.hits += 1;
        await failures.readGate.promise;
      }
      return real.read(buffer, offset, length, position);
    },
    write: async (buffer, offset, length, position) => {
      await admit(position, length);
      return real.write(buffer, offset, length, position);
    },
    writev: async (buffers, position) => {
      await admit(
        position,
        buffers.reduce((total, buffer) => total + buffer.length, 0),
      );
      const { bytesWritten } = await real.writev(buffers, position);
      return { bytesWritten };
    },
    stat: () => real.stat(),
    truncate: async (length) => {
      events.push({ type: 'truncate', length });
      if (failures.failTruncate === true) {
        throw new Error('injected truncate failure');
      }
      await real.truncate(length);
    },
    close: () => real.close(),
  };
}

/** Real files, with every write, flush and truncate recorded and single ones failable. */
export function testJournalSeams(
  failures: Failures = {},
  seed = 1,
): TestJournalSeams {
  const events: JournalEvent[] = [];
  const random = new SeededRandom(seed);
  let flushes = 0;
  let release: () => void = () => undefined;
  const gate = {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  const flush: FlushRecords = (fd) => {
    const index = flushes++;
    events.push({ type: 'flush', fd });
    if (failures.failFlushAt === index)
      throw new Error('injected flush failure');
  };
  const dependencies: JournalOpenDependencies = {
    open: async (path, flags) => {
      events.push({ type: 'open', flags });
      return wrapHandle(await fsp.open(path, flags), events, failures, gate);
    },
    flush,
    nowMs: () => FAKE_NOW_MS,
    random: (length) => random.bytes(length),
  };
  return { events, dependencies, release: () => release() };
}

/** A record of any kind with a deterministic kind header and body. */
export function plainRecord(
  kind: number,
  seed: number,
  bodyBytes: number,
  headerBytes = 24,
): GroupRecord {
  const random = new SeededRandom(seed);
  return {
    kind,
    kindHeader: random.bytes(headerBytes),
    body: { length: bodyBytes, chunks: [random.bytes(bodyBytes)] },
  };
}

const ROW = RECORD_KIND.ROW;

/**
 * The trailer state of a test group. The four roots name records of the group,
 * so a reader has something to verify; any other field is arbitrary.
 */
export function trailerStateFor(
  seed: number,
  roots: Partial<
    Pick<TrailerState, 'rowRoot' | 'idRoot' | 'metaRoot' | 'stateRoot'>
  >,
): TrailerState {
  const random = new SeededRandom(seed);
  const {
    selfOffset: _selfOffset,
    commitSeq: _commitSeq,
    groupTag: _groupTag,
    durableEnd: _durableEnd,
    syncMarker: _syncMarker,
    ...state
  } = randomTrailer(random, 0, new Uint8Array(8));
  return {
    ...state,
    mutation: MUTATION.append,
    rowRoot: 0,
    idRoot: 0,
    metaRoot: 0,
    stateRoot: 0,
    ...roots,
  };
}

export interface StandardGroupOptions {
  readonly rowBodyBytes?: number;
}

/**
 * One ROW, one RTNODE and one ITNODE, with `rowRoot` on the RTNODE and
 * `idRoot` on the ITNODE. Offsets inside the group are what the writer reports.
 */
export function standardGroup(
  seed: number,
  options: StandardGroupOptions = {},
): CommitGroup {
  return {
    records: [
      plainRecord(ROW, seed * 10 + 1, options.rowBodyBytes ?? 100),
      plainRecord(RECORD_KIND.RTNODE, seed * 10 + 2, 40),
      plainRecord(RECORD_KIND.ITNODE, seed * 10 + 3, 30),
    ],
    trailer: (offsets) =>
      trailerStateFor(seed, { rowRoot: offsets[1], idRoot: offsets[2] }),
  };
}

/** One RTNODE and three ITNODEs, each named by one of the four roots of the trailer. */
export function fourRootGroup(seed: number): CommitGroup {
  return {
    records: [
      plainRecord(RECORD_KIND.RTNODE, seed * 10 + 1, 40),
      plainRecord(RECORD_KIND.ITNODE, seed * 10 + 2, 40),
      plainRecord(RECORD_KIND.ITNODE, seed * 10 + 3, 40),
      plainRecord(RECORD_KIND.ITNODE, seed * 10 + 4, 40),
    ],
    trailer: (offsets) =>
      trailerStateFor(seed, {
        rowRoot: offsets[0],
        idRoot: offsets[1],
        metaRoot: offsets[2],
        stateRoot: offsets[3],
      }),
  };
}

export interface BuiltJournal {
  readonly file: string;
  readonly acks: readonly CommitAck[];
  /** The whole file as the writer left it. */
  readonly bytes: Uint8Array;
  readonly syncMarker: Uint8Array;
}

/** Writes the groups through the real writer with a no-op flush and returns the file's bytes. */
export async function buildJournal(
  file: string,
  groups: readonly CommitGroup[],
  seams: TestJournalSeams = testJournalSeams(),
): Promise<BuiltJournal> {
  const writer = await createJournal(file, seams.dependencies);
  const acks: CommitAck[] = [];
  for (const group of groups) acks.push(await writer.commitGroup(group));
  await writer.close();
  const bytes = new Uint8Array(await fsp.readFile(file));
  return {
    file,
    acks,
    bytes,
    syncMarker: bytes.slice(SYNC_MARKER_AT, SYNC_MARKER_AT + 8),
  };
}

const SYNC_MARKER_AT = 32;

/** A copy of `bytes` with one bit flipped. */
export function withBitFlipped(
  bytes: Uint8Array,
  byteIndex: number,
  bit: number,
): Uint8Array {
  const copy = bytes.slice();
  copy[byteIndex] ^= 1 << bit;
  return copy;
}

/** A copy of `bytes` with `[start, end)` zeroed. */
export function withZeroed(
  bytes: Uint8Array,
  start: number,
  end: number,
): Uint8Array {
  const copy = bytes.slice();
  copy.fill(0, start, end);
  return copy;
}

/**
 * Runs the groups through a writer and stops at the first commit that fails,
 * keeping the uncommitted tail that group left behind.
 */
export async function buildJournalKeepingTail(
  file: string,
  seams: TestJournalSeams,
  groups: readonly CommitGroup[],
): Promise<BuiltJournal> {
  const writer = await createJournal(file, seams.dependencies);
  const acks: CommitAck[] = [];
  let failed = false;
  for (const group of groups) {
    if (failed) break;
    try {
      acks.push(await writer.commitGroup(group));
    } catch {
      failed = true;
    }
  }
  await writer.close();
  if (!failed) throw new Error('no commit failed; the journal has no tail');
  const bytes = new Uint8Array(await fsp.readFile(file));
  return {
    file,
    acks,
    bytes,
    syncMarker: bytes.slice(SYNC_MARKER_AT, SYNC_MARKER_AT + 8),
  };
}
