/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { IContent } from './IContent.js';
import { isRecord, isSpeakerContent } from './historyJournalGuards.js';

export function expectNoTicketDisk(recorder: SessionRecordingService): void {
  expect(diskBytes(recorder).length).toBe(0);
  expect(recorder.getPendingByteCount()).toBe(0);
  expect(recorder.getPendingRecordCount()).toBe(0);
}

export interface TicketWriteReceipt {
  readonly offset: number;
  readonly bytes: number;
  readonly records: number;
  readonly seq: number;
}

function diskBytes(recorder: SessionRecordingService): Buffer {
  const file = recorder.getFilePath();
  return file === null || !existsSync(file)
    ? Buffer.alloc(0)
    : readFileSync(file);
}

export function expectTicketDiskContents(
  recorder: SessionRecordingService,
  count: number,
  expected: (index: number) => IContent,
): void {
  let index = 0;
  const text = diskBytes(recorder).toString('utf8');
  for (const line of text.trimEnd().split('\n')) {
    const envelope: unknown = JSON.parse(line);
    if (!isRecord(envelope))
      throw new Error('Invalid independent disk envelope');
    if (envelope.type !== 'content') continue;
    if (
      !isRecord(envelope.payload) ||
      !isSpeakerContent(envelope.payload.content)
    )
      throw new Error('Missing independent disk content');
    expect(envelope.payload.content).toStrictEqual(expected(index));
    expect(JSON.stringify(envelope.payload.content)).toBe(
      JSON.stringify(expected(index)),
    );
    index++;
  }
  expect(index).toBe(count);
}

function recordPhase(phase: string, receipt: TicketWriteReceipt): void {
  const output = process.env.SCALAR_OWNER_OUTPUT;
  if (output !== undefined)
    appendFileSync(
      output,
      JSON.stringify({ phase, ticketCharge: receipt }) + '\n',
    );
}

export function captureTicketWrite(
  recorder: SessionRecordingService,
): TicketWriteReceipt {
  const receipt = {
    offset: diskBytes(recorder).length,
    bytes: recorder.getPendingByteCount(),
    records: recorder.getPendingRecordCount(),
    seq: recorder.getLastEnqueuedSequence(),
  };
  expect(receipt.bytes).toBeGreaterThan(0);
  expect(receipt.records).toBeGreaterThan(0);
  recordPhase('ticket-pre-ack', receipt);
  return receipt;
}

export async function expectTicketDisk(
  recorder: SessionRecordingService,
  receipt: TicketWriteReceipt,
  count: number,
  expected: (index: number) => IContent,
  continuation = false,
): Promise<void> {
  await recorder.flush();
  const appended = diskBytes(recorder).subarray(receipt.offset);
  const text = appended.toString('utf8');
  expect(text.endsWith('\n')).toBe(true);
  const lines = text.trimEnd().split('\n');
  const chargedPrefix = lines.slice(0, receipt.records).join('\n') + '\n';
  expect(Buffer.byteLength(chargedPrefix, 'utf8')).toBe(receipt.bytes);
  const extra = continuation
    ? recorder.getLastEnqueuedSequence() - receipt.seq
    : 0;
  expect(lines).toHaveLength(receipt.records + extra);
  let index = 0;
  for (let ordinal = 0; ordinal < lines.length; ordinal++) {
    const envelope: unknown = JSON.parse(lines[ordinal]);
    if (!isRecord(envelope))
      throw new Error('Invalid independent disk envelope');
    expect(envelope.seq).toBe(receipt.seq - receipt.records + ordinal + 1);
    if (envelope.type !== 'content') continue;
    if (
      !isRecord(envelope.payload) ||
      !isSpeakerContent(envelope.payload.content)
    )
      throw new Error('Missing independent disk content');
    expect(envelope.payload.content).toStrictEqual(expected(index));
    expect(JSON.stringify(envelope.payload.content)).toBe(
      JSON.stringify(expected(index)),
    );
    index++;
  }
  expect(index).toBe(count);
  expect(recorder.getPendingByteCount()).toBe(0);
  expect(recorder.getPendingRecordCount()).toBe(0);
  recordPhase('ticket-post-ack', {
    offset: diskBytes(recorder).length,
    bytes: 0,
    records: 0,
    seq: receipt.seq,
  });
}
