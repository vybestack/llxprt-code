/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ArrivalRow, ArrivalStore } from './arrival-group.js';
import { mutateDisplay } from './display-mutation.js';
import { JournalArrivalRecorder } from './arrival-recorder.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';

export type JournalDisplayDescriptor =
  | { readonly type: 'info' | 'warning' | 'error' | 'slash' | 'shell' }
  | {
      readonly type: 'tool-result';
      readonly attemptId: string;
      readonly callId: string;
      readonly format: 'text' | 'json';
    };

export function displayRelationKey(attemptId: string, callId: string): string {
  return `display:tool:${attemptId.length}:${attemptId}${callId}`;
}

export function decodeDisplayDescriptor(
  bytes: Uint8Array,
): JournalDisplayDescriptor {
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof value !== 'object' || value === null || !('type' in value))
    throw new Error('Invalid display descriptor');
  const type = value.type;
  switch (type) {
    case 'info':
    case 'warning':
    case 'error':
    case 'slash':
    case 'shell':
      return { type };
    case 'tool-result':
      if (!('attemptId' in value) || typeof value.attemptId !== 'string')
        throw new Error('Invalid display attempt id');
      if (!('callId' in value) || typeof value.callId !== 'string')
        throw new Error('Invalid display call id');
      if (
        !('format' in value) ||
        (value.format !== 'text' && value.format !== 'json')
      )
        throw new Error('Invalid display format');
      return {
        type,
        attemptId: value.attemptId,
        callId: value.callId,
        format: value.format,
      };
    default:
      throw new Error('Invalid display descriptor');
  }
}

/** Awaited commands publish only journal identities, never a second display list. */
export class JournalDisplayWriter {
  constructor(private readonly store: ArrivalStore) {}

  async append(
    descriptor: JournalDisplayDescriptor,
    source: string | AsyncIterable<string>,
  ): Promise<ArrivalRow> {
    const release = await this.store.pin();
    const recorder = new JournalArrivalRecorder(this.store);
    const draft = encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 });
    let row: ArrivalRow | undefined;
    try {
      row = await mutateDisplay(this.store, {
        draft,
        presentation: new TextEncoder().encode(JSON.stringify(descriptor)),
      });
      const block = await recorder.beginNamedBlock(row, 0);
      if (typeof source === 'string')
        await recorder.appendText(block, 'text', source);
      else
        for await (const piece of source)
          await recorder.appendText(block, 'text', piece);
      await recorder.endBlock(block);
      await mutateDisplay(this.store, {
        row,
        ...(descriptor.type === 'tool-result'
          ? {
              relationKey: displayRelationKey(
                descriptor.attemptId,
                descriptor.callId,
              ),
            }
          : {}),
      });
      return row;
    } catch (error) {
      if (row !== undefined) await recorder.finishAttempt(row, 'error');
      throw error;
    } finally {
      try {
        await recorder.close();
      } finally {
        await release();
      }
    }
  }

  async retract(row: ArrivalRow): Promise<void> {
    await mutateDisplay(this.store, { row, retract: true });
  }
}
