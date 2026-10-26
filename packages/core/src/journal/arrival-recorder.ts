/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  encodeTextSuffix,
  snapshotSuffix,
  utf16Digest,
  type ArrivalFieldName,
  type ArrivalFieldMode,
} from './chunk-fields.js';
import type { RowDraft } from './rowDraft.js';
import type { BuildContext } from './groupBuildShared.js';
import type { RecordAppender } from './groupAppender.js';
import {
  ArrivalGroup,
  type ArrivalAttempt,
  type ArrivalBlock,
  type ArrivalOutcome,
  type ArrivalPiece,
  type ArrivalRow,
  type ArrivalStore,
} from './arrival-group.js';
import { MAX_ARRIVAL_PIECE_BYTES } from './chunk-row.js';

export const RECORDING_QUEUE_BYTES = 256 * 1024;
const WRITE_BUFFER_CHARGE = 96 * 1024;
const PIECE_CHARGE = 256;
export class JournalArrivalRecorder {
  private pending: ArrivalPiece[] = [];
  private pendingBytes = 0;
  private chargedBytes = 0;
  private chargedPieces = 0;
  private peakBytes = 0;
  private peakPieces = 0;
  private payloadBytes = 0;
  private running: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private failure: { readonly error: unknown } | undefined;
  private release: (() => void | Promise<void>) | undefined;
  private closed = false;
  constructor(private readonly store: ArrivalStore) {}
  get census() {
    return {
      chargedBytes:
        this.chargedBytes + (this.chargedPieces > 0 ? WRITE_BUFFER_CHARGE : 0),
      chargedPieces: this.chargedPieces,
      peakBytes: this.peakBytes,
      peakPieces: this.peakPieces,
      payloadBytes: this.payloadBytes,
    };
  }
  private check(): void {
    if (this.failure !== undefined) throw this.failure.error;
    if (this.closed) throw new Error('Arrival recorder is closed');
  }
  private async mutate<T>(
    run: (group: ArrivalGroup) => Promise<T>,
  ): Promise<T> {
    this.check();
    try {
      const result = await this.store.mutateRecording(
        async (ctx: BuildContext, target: RecordAppender) => {
          const group = await ArrivalGroup.start(ctx, target);
          return group.complete(await run(group));
        },
      );
      return result.value;
    } catch (error) {
      this.failure = { error };
      throw error;
    }
  }
  async beginRow(
    draft: RowDraft,
    attempt: ArrivalAttempt,
  ): Promise<ArrivalRow> {
    await this.flush();
    this.release ??= await this.store.pin();
    return this.mutate((group) => group.begin(draft, attempt));
  }
  async beginBlock(row: ArrivalRow, type: number): Promise<ArrivalBlock> {
    await this.flush();
    return this.mutate((group) => group.beginBlock(row, type));
  }
  async beginNamedBlock(row: ArrivalRow, type: number): Promise<ArrivalBlock> {
    await this.flush();
    return this.mutate((group) => group.beginBlock(row, type, true));
  }
  async appendText(
    block: ArrivalBlock,
    name: ArrivalFieldName,
    value: string,
    mode: ArrivalFieldMode = 'delta',
  ): Promise<void> {
    this.check();
    if (mode === 'snapshot') await this.flush();
    const field = await this.store.readRecordingField(block, name);
    try {
      if (
        field !== undefined &&
        (field.snapshot !== undefined) !== (mode === 'snapshot')
      )
        throw new Error('Cannot mix snapshot and delta modes');
      const start =
        mode === 'snapshot' ? snapshotSuffix(value, field?.snapshot) : 0;
      if (start === value.length && field !== undefined) return;
      for (const bytes of encodeTextSuffix(
        value,
        start,
        name === 'parameters',
      )) {
        await this.enqueuePiece({ block, name, bytes });
      }
      const snapshot =
        mode === 'snapshot'
          ? { units: value.length, digest: utf16Digest(value) }
          : undefined;
      if (snapshot !== undefined || value.length === 0)
        await this.enqueuePiece({
          block,
          name,
          bytes: new Uint8Array(),
          snapshot,
        });
      if (mode === 'snapshot') await this.flush();
    } catch (error) {
      await this.finishAttempt(block, 'error');
      throw error;
    }
  }
  async appendMedia(
    block: ArrivalBlock,
    source: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    await this.appendText(block, 'encoding', 'base64');
    let carry = new Uint8Array();
    for await (const input of source) {
      for (let at = 0; at < input.length; at += 32766) {
        const part = input.subarray(at, at + 32766);
        const bytes = new Uint8Array(carry.length + part.length);
        bytes.set(carry);
        bytes.set(part, carry.length);
        const end = bytes.length - (bytes.length % 3);
        if (end > 0)
          await this.appendText(
            block,
            'data',
            Buffer.from(bytes.subarray(0, end)).toString('base64'),
          );
        carry = bytes.slice(end);
      }
    }
    await this.appendText(block, 'data', Buffer.from(carry).toString('base64'));
  }
  async appendField(block: ArrivalBlock, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    await this.enqueuePiece({ block, bytes });
  }
  private async enqueuePiece(piece: ArrivalPiece): Promise<void> {
    this.check();
    const { bytes } = piece;
    if (bytes.length > MAX_ARRIVAL_PIECE_BYTES)
      throw new Error('Arrival piece exceeds 64 KiB');
    if (
      this.chargedBytes + bytes.length + PIECE_CHARGE + WRITE_BUFFER_CHARGE >
        RECORDING_QUEUE_BYTES ||
      this.chargedPieces >= 256
    )
      await this.flush();
    this.check();
    if (
      this.chargedBytes + bytes.length + PIECE_CHARGE + WRITE_BUFFER_CHARGE >
        RECORDING_QUEUE_BYTES ||
      this.chargedPieces >= 256
    )
      throw new Error('Concurrent recording push exceeded queue capacity');
    this.pending.push({ ...piece, bytes: bytes.slice() });
    this.pendingBytes += bytes.length;
    this.chargedBytes += bytes.length + PIECE_CHARGE;
    this.chargedPieces++;
    this.payloadBytes += bytes.length;
    this.peakBytes = Math.max(
      this.peakBytes,
      this.chargedBytes + WRITE_BUFFER_CHARGE,
    );
    this.peakPieces = Math.max(this.peakPieces, this.chargedPieces);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error: unknown) => {
        this.failure = { error };
      });
    }, 50);
    if (this.pendingBytes >= MAX_ARRIVAL_PIECE_BYTES) this.schedule();
  }
  private schedule(): void {
    if (this.pending.length === 0) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    const pieces = this.pending;
    const bytes = this.pendingBytes;
    this.pending = [];
    this.pendingBytes = 0;
    const turn = this.running
      .then(async () => {
        await this.mutate(async (group) => {
          for (const piece of pieces) {
            if (piece.name === undefined) await group.append(piece);
            else
              await group.appendNamed(
                piece.block,
                piece.name,
                piece.bytes,
                piece.snapshot,
              );
          }
        });
      })
      .finally(() => {
        this.chargedBytes -= bytes + pieces.length * PIECE_CHARGE;
        this.chargedPieces -= pieces.length;
      });
    this.running = turn;
    void turn.catch((error: unknown) => {
      this.failure = { error };
    });
  }
  async flush(): Promise<void> {
    this.check();
    this.schedule();
    await this.running;
    this.check();
  }
  async endBlock(block: ArrivalBlock): Promise<void> {
    await this.flush();
    const error = await this.mutate((group) => group.blockError(block));
    if (error !== undefined) {
      await this.finishAttempt(block, 'error');
      throw new Error(error);
    }
    await this.mutate((group) => group.endBlock(block));
  }
  async sealRow(
    row: ArrivalRow,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    await this.flush();
    await this.mutate(async (group) => {
      const found = await group.find(row);
      const chunk = found.header.chunk;
      if (chunk === undefined) throw new Error('Missing manifest');
      const { chunkValue } = await import('./chunk-row.js');
      const bytes = await chunkValue(
        group.ctx.readGroup(group.target.nextOffset),
        chunk.metaRef,
      );
      const stored: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (stored === null || typeof stored !== 'object')
        throw new Error('Invalid row metadata');
      const meta =
        metadata === undefined
          ? bytes
          : new TextEncoder().encode(JSON.stringify({ ...stored, metadata }));
      await group.finish(row, 'completed', meta);
    });
  }
  async finishAttempt(
    row: ArrivalRow,
    outcome: Exclude<ArrivalOutcome, 'completed'>,
  ): Promise<void> {
    await this.flush();
    await this.mutate((group) => group.finish(row, outcome));
  }
  async close(): Promise<void> {
    if (this.closed) return;
    try {
      await this.flush();
    } finally {
      this.closed = true;
      clearTimeout(this.timer);
      await this.release?.();
      this.release = undefined;
    }
  }
}
