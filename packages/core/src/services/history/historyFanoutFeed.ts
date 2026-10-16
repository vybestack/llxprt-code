/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  contentTxId,
  requireTxId,
} from '../../recording/replaceTransaction.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import type {
  SessionEventType,
  SessionRecordLine,
} from '../../recording/types.js';
import {
  scanJournalRecords,
  type JournalRecordScan,
  type ScannedJournalRecord,
} from './historyJournalRecordScan.js';
import { envelopeToEvent } from './historyJournalFold.js';
import { JournalRowReader } from './historyJournalRowReader.js';
import { planMirrors } from './historyMirrorTranslation.js';
import { writeMirrorPlan } from './historyMirrorWrites.js';
import { SharedRowIndex } from './historySharedRowIndex.js';
import { acceptsHistoryOrigin, payloadOrigin } from './historyOriginId.js';
import {
  rethrow,
  type HistoryRecorderFanout,
} from './historyRecorderFanout.js';

/**
 * How the pump treats the records up to a sequence:
 * - `deliver`: hand them to the mirrors;
 * - `advance`: they already reached the mirrors directly, only move past them;
 * - `drop`: their publication failed, so neither they nor the compensation
 *   that undid them may reach a mirror.
 */
export type FanoutFeedMode = 'deliver' | 'advance' | 'drop';

type DirectLine = Pick<SessionRecordLine, 'seq' | 'type' | 'payload'>;

/** Record types whose effect depends on the rows around them. */
const POSITIONAL_TYPES: ReadonlySet<string> = new Set([
  'rewind',
  'compressed',
  'density_mutation',
  'synthetic_insert',
  'semantic_media_purge',
  'chronology_bind',
]);

const TRANSACTION_TYPES: ReadonlySet<string> = new Set([
  'replace_begin',
  'replace_commit',
  'replace_abort',
]);

/** A row appended on its own reaches a mirror unchanged; nothing else does. */
function isAppendedRow(line: Pick<DirectLine, 'type' | 'payload'>): boolean {
  return line.type === 'content' && contentTxId(line.payload) === undefined;
}

/** Rows below this byte offset of the primary are owned by `origin`, whatever their records say. */
export interface BaselineOwner {
  readonly origin: string;
  readonly end: number;
}

interface OpenTransaction {
  readonly txId: string;
  /** Rows each mirror received for the transaction. */
  readonly rows: Map<string, number>;
}

/**
 * Publish-time pump from the hidden primary journal to the mirrors.
 *
 * Nothing is staged in memory. After a publication succeeds,
 * `schedule(..., 'deliver')` waits until the primary has committed the
 * publication's last record, then streams the committed records after the
 * cursor one at a time, up to and including that record and no further. The
 * bound is the record sequence, never the commit watermark: the watermark of
 * an already acknowledged sequence is the latest one, which may already cover
 * later records of other publications. A failed publication schedules
 * `drop`, which moves the cursor past its records without delivering them.
 *
 * A mirror holds exactly the shared rows its origin owns, so a record whose
 * meaning depends on position (a rewind, an insert, a density pass, a
 * compression) is translated to the mirror's own rows. The pump keeps a
 * {@link SharedRowIndex}: one fixed-width disk row per shared row with its
 * owner, folded incrementally from the records the pump consumes. A batch
 * reads only the bytes appended since the previous one and holds only the
 * record it is working on; the one exception is the first batch after
 * `reset`, which folds the journal the pump was pointed past.
 */
export class HistoryFanoutFeed {
  private cursor = 0;
  private consumedSeq = 0;
  private primary: RecordingPort | undefined;
  private baseline: BaselineOwner | undefined;
  private index: SharedRowIndex | undefined;
  /** Journal offset the index has folded through. */
  private foldedTo = 0;
  private openTransaction: OpenTransaction | undefined;
  private chain: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private scheduled = 0;

  constructor(
    private readonly fanout: HistoryRecorderFanout,
    private readonly scan: JournalRecordScan = scanJournalRecords,
  ) {}

  /**
   * Point the pump at a new primary journal; callers settle first. Rows of
   * the primary below `baseline.end` belong to `baseline.origin`.
   */
  reset(
    primary: RecordingPort,
    cursor: number,
    baseline?: BaselineOwner,
  ): void {
    this.primary = primary;
    this.cursor = cursor;
    this.consumedSeq = 0;
    this.baseline = baseline;
    this.index?.close();
    this.index = new SharedRowIndex();
    this.foldedTo = 0;
    this.openTransaction = undefined;
  }

  /** Release the disk rows; callers settle first. */
  dispose(): void {
    this.index?.close();
    this.index = undefined;
  }

  /**
   * A resumed history replaces every shared row with rows `owner` holds, so
   * each other mirror drops the rows it carries. Callers settle first.
   */
  async retireSharedRows(owner: string): Promise<void> {
    const filePath = this.primary?.getFilePath();
    if (filePath === null || filePath === undefined)
      throw new Error('History fan-out primary has no journal file');
    const index = this.requireIndex();
    await this.foldThrough(filePath, this.cursor);
    const counts = index.counts();
    for (const origin of this.fanout.origins) {
      if (origin === owner) continue;
      const held = counts.heldBy(index.idOf(origin));
      if (held > 0) this.fanout.send(origin, 'rewind', { itemsRemoved: held });
    }
  }

  /** True when no scheduled delivery is pending, so direct delivery keeps row order. */
  get idle(): boolean {
    return this.scheduled === 0;
  }

  /**
   * Hand just-admitted rows straight to the mirrors, then move the cursor
   * past them once the primary commits the last one. Direct delivery is what
   * lets a small publication reach the mirrors as soon as it publishes, the
   * way it reaches a sole recorder. It applies only when no scheduled
   * delivery is pending (so row order is kept) and every line is a row that
   * is appended on its own; returns false, having done nothing, otherwise.
   * A refusing mirror is reported through {@link settle}, like a pump failure.
   */
  deliverNow(primary: RecordingPort, lines: readonly DirectLine[]): boolean {
    if (!this.idle || !lines.every(isAppendedRow)) return false;
    if (lines.length === 0) return true;
    for (const line of lines) {
      try {
        this.fanout.deliver(line.type, line.payload);
      } catch (error) {
        this.failures.push(error);
      }
    }
    this.schedule(primary, lines[lines.length - 1].seq, 'advance');
    return true;
  }

  schedule(primary: RecordingPort, seq: number, mode: FanoutFeedMode): void {
    this.scheduled++;
    this.chain = this.chain.then(async () => {
      try {
        if (primary !== this.primary)
          throw new Error('History fan-out primary changed before delivery');
        if (seq <= this.consumedSeq) return;
        const { byteOffset } = await primary.waitForCommitSequence(seq);
        await this.consume(primary, seq, byteOffset, mode);
      } catch (error) {
        this.failures.push(error);
      } finally {
        this.scheduled--;
      }
    });
  }

  /** Consume the records from the cursor through `seq`; `limit` bounds the read. */
  private async consume(
    primary: RecordingPort,
    seq: number,
    limit: number,
    mode: FanoutFeedMode,
  ): Promise<void> {
    const filePath = primary.getFilePath();
    if (filePath === null)
      throw new Error('History fan-out primary has no journal file');
    const failures: unknown[] = [];
    await this.foldThrough(filePath, this.cursor);
    for await (const record of this.scan(filePath, this.cursor, limit)) {
      if (record.seq <= seq) {
        this.cursor = record.end;
        this.consumedSeq = record.seq;
        // A dropped record never reached a mirror, so it is not shared history.
        if (mode === 'drop') this.foldedTo = record.end;
        else await this.process(filePath, record, mode === 'deliver', failures);
      }
      if (record.seq >= seq) break;
    }
    if (this.consumedSeq < seq)
      throw new Error(
        `History fan-out primary record ${seq} was not found after byte ${this.cursor}`,
      );
    rethrow(failures, 'Recorder fan-out failed');
  }

  private async process(
    filePath: string,
    record: ScannedJournalRecord,
    deliver: boolean,
    failures: unknown[],
  ): Promise<void> {
    if (deliver && POSITIONAL_TYPES.has(record.type)) {
      await this.translate(filePath, record, failures);
      return;
    }
    if (deliver) this.deliverRecord(record, failures);
    this.foldRecord(record);
  }

  private requireIndex(): SharedRowIndex {
    if (this.index === undefined)
      throw new Error('History fan-out pump has no primary journal');
    return this.index;
  }

  /** The origin a primary record belongs to, whatever its payload says below the baseline. */
  private ownerOf(record: ScannedJournalRecord): string | undefined {
    const baseline = this.baseline;
    return baseline !== undefined && record.start < baseline.end
      ? baseline.origin
      : payloadOrigin(record.payload);
  }

  private foldRecord(record: ScannedJournalRecord): void {
    this.requireIndex().fold(record, this.ownerOf(record));
    this.foldedTo = record.end;
  }

  /**
   * Fold the records the index has not seen yet, up to byte `end`. After the
   * first batch following a reset the index is level with the cursor and this
   * reads nothing.
   */
  private async foldThrough(filePath: string, end: number): Promise<void> {
    for await (const record of this.scan(filePath, this.foldedTo, end))
      this.foldRecord(record);
  }

  private deliverRecord(
    record: ScannedJournalRecord,
    failures: unknown[],
  ): void {
    try {
      if (
        TRANSACTION_TYPES.has(record.type) ||
        (record.type === 'content' && !isAppendedRow(record))
      )
        this.deliverTransactionRecord(record);
      else this.fanout.deliver(record.type, record.payload);
    } catch (error) {
      failures.push(error);
    }
  }

  /**
   * A replace transaction is folded by each mirror on its own: every mirror
   * sees begin and the rows it owns, and a commit or abort declares the row
   * count that mirror received.
   */
  private deliverTransactionRecord(record: ScannedJournalRecord): void {
    const origins = this.fanout.origins;
    if (record.type === 'replace_begin') {
      this.openTransaction = {
        txId: requireTxId(record.payload),
        rows: new Map(),
      };
      for (const origin of origins)
        this.fanout.send(origin, record.type, record.payload);
      return;
    }
    const open = this.openTransaction;
    const txId =
      record.type === 'content'
        ? contentTxId(record.payload)
        : requireTxId(record.payload);
    if (open === undefined || open.txId !== txId)
      throw new Error(
        `History fan-out saw ${record.type} for transaction ${String(txId)} without its begin`,
      );
    if (record.type === 'content') {
      const owner = payloadOrigin(record.payload);
      for (const origin of origins) {
        if (!acceptsHistoryOrigin(origin, owner)) continue;
        this.fanout.send(origin, record.type, record.payload);
        open.rows.set(origin, (open.rows.get(origin) ?? 0) + 1);
      }
      return;
    }
    this.openTransaction = undefined;
    for (const origin of origins)
      this.fanout.send(origin, record.type, {
        ...(record.payload as object),
        rowCount: open.rows.get(origin) ?? 0,
      });
  }

  /** Bring every mirror from its own rows before the record to its own rows after. */
  private async translate(
    filePath: string,
    record: ScannedJournalRecord,
    failures: unknown[],
  ): Promise<void> {
    const event = envelopeToEvent(record.type, record.payload);
    if (event === null) {
      this.foldRecord(record);
      return;
    }
    const index = this.requireIndex();
    const mirrors = this.fanout.origins;
    const plans = planMirrors({
      index,
      mirrors,
      record,
      event,
      owner: this.ownerOf(record),
    });
    this.foldRecord(record);
    const reader = new JournalRowReader(filePath);
    let counts: ReturnType<SharedRowIndex['counts']> | undefined;
    const context = {
      index,
      reader,
      send: (mirror: string, type: SessionEventType, payload: unknown) =>
        this.fanout.send(mirror, type, payload),
      countsAfter: () => (counts ??= index.counts()),
    };
    try {
      for (const [mirror, plan] of plans) {
        try {
          await writeMirrorPlan(context, mirror, plan);
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      reader.close();
    }
  }

  /**
   * Resolve once every scheduled delivery ran and every mirror has written
   * what it was handed; rethrow what failed.
   */
  async settle(): Promise<void> {
    await this.chain;
    const failures = this.failures;
    this.failures = [];
    try {
      await this.fanout.flush();
    } catch (error) {
      failures.push(error);
    }
    rethrow(failures, 'Recorder fan-out failed');
  }
}
