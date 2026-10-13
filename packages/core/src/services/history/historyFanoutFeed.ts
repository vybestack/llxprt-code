/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  contentTxId,
  requireTxId,
} from '../../recording/replaceTransaction.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { SessionRecordLine } from '../../recording/types.js';
import {
  scanJournalRecords,
  type ScannedJournalRecord,
} from './historyJournalRecordScan.js';
import {
  DroppedRanges,
  SharedHistoryRows,
  type BaselineOwner,
} from './historySharedRows.js';
import { mirrorWrites } from './historyMirrorTranslation.js';
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
 * compression) is translated to the mirror's own rows. The translation folds
 * the primary's delivered records into a transient {@link SharedHistoryRows}
 * that lives for one batch.
 */
export class HistoryFanoutFeed {
  private cursor = 0;
  private consumedSeq = 0;
  private primary: SessionRecordingService | undefined;
  private baseline: BaselineOwner | undefined;
  private readonly dropped = new DroppedRanges();
  private sharedRows: SharedHistoryRows | undefined;
  private openTransaction: OpenTransaction | undefined;
  private chain: Promise<void> = Promise.resolve();
  private failures: unknown[] = [];
  private scheduled = 0;

  constructor(private readonly fanout: HistoryRecorderFanout) {}

  /**
   * Point the pump at a new primary journal; callers settle first. Rows of
   * the primary below `baseline.end` belong to `baseline.origin`.
   */
  reset(
    primary: SessionRecordingService,
    cursor: number,
    baseline?: BaselineOwner,
  ): void {
    this.primary = primary;
    this.cursor = cursor;
    this.consumedSeq = 0;
    this.baseline = baseline;
    this.dropped.clear();
    this.sharedRows = undefined;
    this.openTransaction = undefined;
  }

  /**
   * A resumed history replaces every shared row with rows `owner` holds, so
   * each other mirror drops the rows it carries. Callers settle first.
   */
  async retireSharedRows(owner: string): Promise<void> {
    const filePath = this.primary?.getFilePath();
    if (filePath === null || filePath === undefined)
      throw new Error('History fan-out primary has no journal file');
    const sharedRows = await SharedHistoryRows.fold(
      filePath,
      this.cursor,
      this.dropped,
      this.baseline,
    );
    for (const origin of this.fanout.origins) {
      if (origin === owner) continue;
      const held = sharedRows.rows.filter((row) =>
        acceptsHistoryOrigin(origin, sharedRows.ownerOf(row)),
      ).length;
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
  deliverNow(
    primary: SessionRecordingService,
    lines: readonly DirectLine[],
  ): boolean {
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

  schedule(
    primary: SessionRecordingService,
    seq: number,
    mode: FanoutFeedMode,
  ): void {
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
        this.sharedRows = undefined;
        this.scheduled--;
      }
    });
  }

  /** Consume the records from the cursor through `seq`; `limit` bounds the read. */
  private async consume(
    primary: SessionRecordingService,
    seq: number,
    limit: number,
    mode: FanoutFeedMode,
  ): Promise<void> {
    const filePath = primary.getFilePath();
    if (filePath === null)
      throw new Error('History fan-out primary has no journal file');
    const failures: unknown[] = [];
    for await (const record of scanJournalRecords(
      filePath,
      this.cursor,
      limit,
    )) {
      if (record.seq <= seq) {
        this.cursor = record.end;
        this.consumedSeq = record.seq;
        if (mode === 'drop') this.dropped.add(record.start, record.end);
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
    this.sharedRows?.apply(record, payloadOrigin(record.payload));
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
    this.sharedRows ??= await SharedHistoryRows.fold(
      filePath,
      record.start,
      this.dropped,
      this.baseline,
    );
    const sharedRows = this.sharedRows;
    const before = [...sharedRows.rows];
    const event = sharedRows.apply(record, payloadOrigin(record.payload));
    if (event === null) return;
    for (const origin of this.fanout.origins) {
      try {
        const writes = mirrorWrites({
          mirror: origin,
          record,
          event,
          before,
          after: sharedRows.rows,
          ownerOf: (row) => sharedRows.ownerOf(row),
        });
        for (const write of writes)
          this.fanout.send(origin, write.type, write.payload);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  /** Resolve once every scheduled delivery ran; rethrow what failed. */
  async settle(): Promise<void> {
    await this.chain;
    const failures = this.failures;
    this.failures = [];
    rethrow(failures, 'Recorder fan-out failed');
  }
}
