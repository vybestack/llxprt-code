/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  SynchronousValueSpool,
  type ValueTicketReader,
} from '../../recording/synchronous-value-spool.js';
import type { HistoryJournalOp } from './historyStorePort.js';
import {
  isRecord,
  isSpeakerContent,
  isDensityReplacementRecord,
} from './historyJournalGuards.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';

function submissionValue(op: HistoryJournalOp): HistoryJournalOp {
  switch (op.kind) {
    case 'content':
      return {
        ...op,
        content: sanitizeProviderContentForSerialization(op.content),
      };
    case 'compressed':
      return {
        ...op,
        summary: sanitizeProviderContentForSerialization(op.summary),
      };
    case 'syntheticInsert':
      return {
        ...op,
        payload: {
          ...op.payload,
          content: sanitizeProviderContentForSerialization(op.payload.content),
        },
      };
    case 'density':
      return {
        ...op,
        payload: {
          ...op.payload,
          replacements: op.payload.replacements.map((entry) => ({
            ...entry,
            replacement: sanitizeProviderContentForSerialization(
              entry.replacement,
            ),
          })),
        },
      };
    case 'rewind':
    case 'compressionDetail':
    case 'replaceBegin':
    case 'replaceCommit':
    case 'replaceAbort':
      return op;
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

export interface PendingHistoryTicket {
  readonly op: HistoryJournalOp;
  readonly seq: number | null;
}

function decodeDensity(payload: unknown): HistoryJournalOp {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.removedSeqs) ||
    !Array.isArray(payload.replacements)
  )
    throw new Error('Invalid pending density ticket');
  if (
    !payload.removedSeqs.every(
      (seq): seq is number => typeof seq === 'number',
    ) ||
    !payload.replacements.every(isDensityReplacementRecord)
  )
    throw new Error('Invalid pending density ticket');
  return {
    kind: 'density',
    payload: {
      removedSeqs: payload.removedSeqs,
      replacements: payload.replacements,
    },
  };
}

function decodeReplaceOp(
  value: Record<string, unknown>,
): HistoryJournalOp | undefined {
  if (typeof value.txId !== 'string') return undefined;
  if (value.kind === 'replaceBegin')
    return { kind: 'replaceBegin', txId: value.txId };
  if (typeof value.rowCount !== 'number') return undefined;
  return value.kind === 'replaceCommit'
    ? { kind: 'replaceCommit', txId: value.txId, rowCount: value.rowCount }
    : { kind: 'replaceAbort', txId: value.txId, rowCount: value.rowCount };
}

function decodeContentOp(
  value: Record<string, unknown>,
): HistoryJournalOp | undefined {
  if (!isSpeakerContent(value.content)) return undefined;
  if (value.tx !== undefined && typeof value.tx !== 'string') return undefined;
  return { kind: 'content', content: value.content, tx: value.tx };
}

/** Rows and transaction markers share one decoder: all carry the `tx` shape. */
function decodeTransactionOp(
  value: Record<string, unknown>,
): HistoryJournalOp | undefined {
  return value.kind === 'content'
    ? decodeContentOp(value)
    : decodeReplaceOp(value);
}

function decodeOp(value: unknown): HistoryJournalOp {
  if (!isRecord(value)) throw new Error('Invalid pending ticket operation');
  const payload = value.payload;
  switch (value.kind) {
    case 'content':
    case 'replaceBegin':
    case 'replaceCommit':
    case 'replaceAbort': {
      const decoded = decodeTransactionOp(value);
      if (decoded !== undefined) return decoded;
      break;
    }
    case 'rewind':
      if (
        typeof value.itemsRemoved === 'number' &&
        (value.cutSeq === undefined || typeof value.cutSeq === 'number')
      )
        return {
          kind: 'rewind',
          itemsRemoved: value.itemsRemoved,
          cutSeq: value.cutSeq,
        };
      break;
    case 'compressed':
      if (
        isSpeakerContent(value.summary) &&
        typeof value.itemsCompressed === 'number'
      )
        return {
          kind: 'compressed',
          summary: value.summary,
          itemsCompressed: value.itemsCompressed,
        };
      break;
    case 'compressionDetail':
      if (
        isRecord(payload) &&
        typeof payload.fromSeq === 'number' &&
        typeof payload.toSeq === 'number' &&
        typeof payload.itemsCompressed === 'number'
      )
        return {
          kind: 'compressionDetail',
          payload: {
            fromSeq: payload.fromSeq,
            toSeq: payload.toSeq,
            itemsCompressed: payload.itemsCompressed,
          },
        };
      break;
    case 'syntheticInsert':
      if (
        isRecord(payload) &&
        isSpeakerContent(payload.content) &&
        typeof payload.chronologySeq === 'number' &&
        typeof payload.afterSeq === 'number'
      )
        return {
          kind: 'syntheticInsert',
          payload: {
            content: payload.content,
            chronologySeq: payload.chronologySeq,
            afterSeq: payload.afterSeq,
          },
        };
      break;
    case 'density':
      return decodeDensity(payload);
    default:
      throw new Error('Invalid pending ticket operation');
  }
  throw new Error('Invalid pending ticket operation');
}

function decodeTicket(value: unknown): PendingHistoryTicket {
  if (!isRecord(value) || (value.seq !== null && typeof value.seq !== 'number'))
    throw new Error('Invalid pending ticket sequence');
  const op = decodeOp(value.op);
  // The origin sits beside the op's body, so the per-kind decoders do not see it.
  const origin = isRecord(value.op) ? value.op.origin : undefined;
  return {
    seq: value.seq,
    op: typeof origin === 'string' ? { ...op, origin } : op,
  };
}

export class HistoryPendingTickets {
  private values = new SynchronousValueSpool(decodeTicket);
  private start = 0;
  private end = 0;
  get length(): number {
    return this.end - this.start;
  }
  prepare(op: HistoryJournalOp, seq: number | null): number {
    return this.values.append({ op: submissionValue(op), seq });
  }
  publish(ordinal: number): void {
    if (ordinal !== this.end)
      throw new Error('Pending ticket publication is out of order');
    this.end++;
  }
  cancel(ordinal: number): void {
    this.values.truncate(ordinal);
  }
  read(index: number): PendingHistoryTicket {
    return this.values.read(this.start + index);
  }
  capture(): ValueTicketReader<PendingHistoryTicket> {
    return this.values.pin(this.start, this.end);
  }
  acknowledge(seq: number): void {
    while (this.start < this.end) {
      const ticket = this.values.read(this.start);
      if (ticket.seq === null || ticket.seq > seq) return;
      this.start++;
    }
    if (this.start === this.end) {
      this.values = this.values.reset();
      this.start = 0;
      this.end = 0;
    }
  }
  retireIdleStorage(): void {
    if (this.length !== 0) return;
    this.values.close();
    this.values = new SynchronousValueSpool(decodeTicket);
    this.start = 0;
    this.end = 0;
  }

  close(): void {
    this.values.close();
  }
}
