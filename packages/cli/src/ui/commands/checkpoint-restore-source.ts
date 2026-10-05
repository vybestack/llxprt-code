/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, type FileHandle } from 'node:fs/promises';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { CheckpointJsonReader } from './checkpoint-json-reader.js';
import type { CommandContext } from './types.js';

interface CheckpointData {
  history?: Parameters<NonNullable<CommandContext['ui']['loadHistory']>>[0];
  commitHash?: string;
  toolCall: { name: string; args: Record<string, unknown> };
}
interface Range {
  start: number;
  end: number;
  count: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContent(value: unknown): value is IContent {
  if (!isRecord(value)) return false;
  const speaker = value.speaker;
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool')
    return false;
  return Array.isArray(value.blocks);
}

function isCheckpoint(value: object): value is CheckpointData {
  if (!('toolCall' in value) || !isRecord(value.toolCall)) return false;
  return typeof value.toolCall.name === 'string';
}

async function hasNext(
  reader: CheckpointJsonReader,
  end: number,
): Promise<boolean> {
  if ((await reader.peek()) === end) return false;
  await reader.expect(44);
  return true;
}

async function* arrayRows(
  reader: CheckpointJsonReader,
): AsyncGenerator<IContent> {
  await reader.expect(91);
  if ((await reader.peek()) === 93) {
    await reader.expect(93);
    return;
  }
  do {
    const row = await reader.value();
    if (!isContent(row))
      throw new Error('Invalid checkpoint clientHistory row');
    yield row;
  } while (await hasNext(reader, 93));
  await reader.expect(93);
}

async function clientRange(
  reader: CheckpointJsonReader,
  ownership?: RowOwnership,
): Promise<Range | undefined> {
  if ((await reader.peek()) !== 91) {
    await reader.value();
    return undefined;
  }
  const start = reader.position;
  let count = 0;
  for await (const row of arrayRows(reader)) {
    ownership?.retain(row);
    try {
      count++;
    } finally {
      ownership?.release(row);
    }
  }
  return { start, end: reader.position, count };
}

async function inspect(
  file: FileHandle,
  signal?: AbortSignal,
  chunkBytes?: number,
  ownership?: RowOwnership,
): Promise<{ data: CheckpointData; range?: Range }> {
  const reader = new CheckpointJsonReader(file, 0, signal, chunkBytes);
  const data: Record<string, unknown> = {};
  let range: Range | undefined;
  await reader.expect(123);
  if ((await reader.peek()) !== 125) {
    do {
      const key = await reader.value();
      if (typeof key !== 'string')
        throw new SyntaxError('Expected checkpoint key');
      await reader.expect(58);
      if (key === 'clientHistory') range = await clientRange(reader, ownership);
      else
        Object.defineProperty(data, key, {
          value: await reader.value(),
          enumerable: true,
          configurable: true,
        });
    } while (await hasNext(reader, 125));
  }
  await reader.expect(125);
  if ((await reader.peek()) !== undefined)
    throw new SyntaxError('Extra checkpoint JSON');
  if (!isCheckpoint(data))
    throw new Error('Checkpoint toolCall is missing or invalid');
  return { data, range };
}

export interface DiskCheckpoint {
  readonly data: CheckpointData;
  readonly rows?: AsyncIterable<IContent>;
  close(): Promise<void>;
}

/** Preflight is side-effect-free. The pinned file is consumed again by the
 * durable admission transaction. Any truncation, mutation, failure or abort
 * rejects before that transaction can publish its candidate. */
export async function openDiskCheckpoint(
  path: string,
  signal?: AbortSignal,
  options: { chunkBytes?: number; ownership?: RowOwnership } = {},
): Promise<DiskCheckpoint> {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const initial = await file.stat();
    const { data, range } = await inspect(
      file,
      signal,
      options.chunkBytes,
      options.ownership,
    );
    const verify = async (): Promise<void> => {
      signal?.throwIfAborted();
      const current = await file.stat();
      if (
        current.size !== initial.size ||
        current.mtimeMs !== initial.mtimeMs ||
        current.ctimeMs !== initial.ctimeMs
      )
        throw new Error('Checkpoint changed during restoration');
    };
    await verify();
    const rows =
      range === undefined
        ? undefined
        : (async function* (): AsyncGenerator<IContent> {
            const reader = new CheckpointJsonReader(
              file,
              range.start,
              signal,
              options.chunkBytes,
            );
            let count = 0;
            for await (const row of arrayRows(reader)) {
              options.ownership?.retain(row);
              try {
                yield row;
                count++;
              } finally {
                options.ownership?.release(row);
              }
            }
            if (count !== range.count || reader.position !== range.end)
              throw new Error('Checkpoint history changed during restoration');
            await verify();
          })();
    let closing: Promise<void> | undefined;
    return {
      data,
      rows,
      close: () => {
        closing ??= file.close();
        return closing;
      },
    };
  } catch (error) {
    await file.close();
    throw error;
  }
}
