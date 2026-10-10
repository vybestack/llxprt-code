/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream, rmSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { foldDurableRows } from './durableRowFold.js';
import type { SessionRecordLine } from './types.js';
import { createScratchDirSync } from '../storage/scratch-root.js';
async function* streamFile(
  file: string,
  isClosed: () => boolean,
): AsyncGenerator<string, void, unknown> {
  if (isClosed()) throw new Error('Semantic purge recording rows are closed');
  const reader = createReadStream(file, {
    encoding: 'utf8',
    highWaterMark: 64 * 1024,
  });
  try {
    for await (const chunk of reader) {
      if (typeof chunk !== 'string')
        throw new Error('Expected UTF-8 recording chunk');
      yield chunk;
    }
  } finally {
    reader.destroy();
  }
}

export interface StagedPurgeRecord {
  readonly seq: number;
  readonly json: string;
  readonly bytes: number;
  readonly staged: StagedPurgeRecording;
  readonly suffix: string;
}

export function preparePurgeRecordingRecord(
  seq: number,
  staged: StagedPurgeRecording,
  frontier: { readonly contentIndex: number; readonly blockIndex: number },
): { readonly line: SessionRecordLine; readonly record: StagedPurgeRecord } {
  const line: SessionRecordLine = {
    v: 2,
    seq,
    ts: new Date().toISOString(),
    type: 'semantic_media_purge',
    payload: null,
  };
  const envelope = JSON.stringify({
    v: line.v,
    seq,
    ts: line.ts,
    type: line.type,
  });
  const json = `${envelope.slice(0, -1)},"payload":{"history":[`;
  const suffix = `],"frontier":${JSON.stringify(frontier)}}}\n`;
  return {
    line,
    record: {
      seq,
      json,
      suffix,
      staged,
      bytes: Buffer.byteLength(json) + staged.bytes + Buffer.byteLength(suffix),
    },
  };
}

export interface StagedPurgeRecording {
  readonly bytes: number;
  stream(): AsyncGenerator<string, void, unknown>;
  close(): void;
}
export interface PurgeRecordingOptions {
  readonly requireLiveFold?: boolean;
  readonly signal?: AbortSignal;
}
export async function validatePurgeRecordingForLiveFold(
  record: StagedPurgeRecord,
  options: PurgeRecordingOptions,
): Promise<void> {
  const { signal } = options;
  signal?.throwIfAborted();
  if (options.requireLiveFold !== true) return;
  const { staged, json: prefix, suffix, bytes } = record;
  const directory = createScratchDirSync('llxprt-purge-preflight-');
  const file = join(directory, 'event.jsonl');
  try {
    const writer = await open(file, 'wx');
    try {
      await writer.writeFile(prefix, 'utf8');
      for await (const chunk of staged.stream()) {
        signal?.throwIfAborted();
        await writer.writeFile(chunk, 'utf8');
      }
      signal?.throwIfAborted();
      await writer.writeFile(suffix, 'utf8');
    } finally {
      await writer.close();
    }
    const fold = await foldDurableRows({
      filePath: file,
      maxBytes: bytes,
      signal,
    });
    await fold.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function writeRowChunks(
  writer: FileHandle,
  text: string,
  signal?: AbortSignal,
): Promise<void> {
  let start = 0;
  while (start < text.length) {
    signal?.throwIfAborted();
    let end = Math.min(start + 64 * 1024, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    await writer.writeFile(text.slice(start, end), 'utf8');
    start = end;
  }
}

async function writeRows(
  file: string,
  rows: AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<number> {
  const writer = await open(file, 'wx');
  let bytes = 0;
  try {
    let first = true;
    for await (const row of rows) {
      signal?.throwIfAborted();
      const text = `${first ? '' : ','}${JSON.stringify(row)}`;
      await writeRowChunks(writer, text, signal);
      bytes += Buffer.byteLength(text);
      first = false;
    }
  } finally {
    await writer.close();
  }
  return bytes;
}

export async function stagePurgeRecordingRows(
  rows: AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<StagedPurgeRecording> {
  signal?.throwIfAborted();
  const directory = createScratchDirSync('llxprt-purge-recording-');
  const file = join(directory, 'rows.json');
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    const bytes = await writeRows(file, rows, signal);
    signal?.throwIfAborted();
    return {
      bytes,
      stream: (): AsyncGenerator<string, void, unknown> =>
        streamFile(file, () => closed),
      close,
    };
  } catch (error: unknown) {
    close();
    throw error;
  }
}
