/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  createReadStream,
  mkdtempSync,
  rmSync,
  openSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { foldDurableRows } from './durableRowFold.js';

export function expectedPurgeFileDigest(tail: string): string {
  const hash = createHash('sha256');
  hash.update(record('content', { content: purgeRow(99_999) }));
  hash.update(
    '{"v":2,"seq":2,"type":"semantic_media_purge","payload":{"history":[',
  );
  for (let index = 0; index < 8192; index++)
    hash.update(`${index === 0 ? '' : ','}${JSON.stringify(purgeRow(index))}`);
  hash.update(']}}' + String.fromCharCode(10));
  hash.update(tail);
  return hash.digest('hex');
}

export async function purgeFileDigest(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(file, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    stream.destroy();
  }
}
export const PURGE_BUFFER_BOUND = 8 * 1024 * 1024;
export function purgeRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${index}:雪😀:${'x'.repeat(2048)}` }],
    metadata: {
      chronology: { seq: index, userTurn: index, step: 0, recordedAt: index },
    },
  };
}
export function withPurgeFile(
  action: (root: string, file: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'purge-durable-fold-'));
  return action(root, join(root, 'journal.jsonl')).finally(() =>
    rmSync(root, { recursive: true, force: true }),
  );
}
export function writePurgeFixture(
  file: string,
  suffix = ']}}\n',
  lastRow = '',
  version = 2,
): number {
  const fd = openSync(file, 'w');
  let bytes = 0;
  try {
    bytes += writeSync(fd, record('content', { content: purgeRow(99_999) }));
    bytes += writeSync(
      fd,
      `{"v":${version},"seq":2,"type":"semantic_media_purge","payload":{"history":[`,
    );
    for (let index = 0; index < 8192; index++)
      bytes += writeSync(
        fd,
        `${index === 0 ? '' : ','}${JSON.stringify(purgeRow(index))}`,
      );
    bytes += writeSync(fd, lastRow + suffix);
    return bytes;
  } finally {
    closeSync(fd);
  }
}
export function record(type: string, payload: unknown, v = 2): string {
  return `${JSON.stringify({ v, seq: 1, type, payload })}\n`;
}
export async function assertOriginalSurvives(
  root: string,
  file: string,
  bytes: number,
): Promise<IContent> {
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: bytes,
    scratchRoot: root,
  });
  try {
    if (fold.length !== 1)
      throw new Error(`Unexpected membership ${fold.length}`);
    return await fold.readRow(0);
  } finally {
    await fold.close();
  }
}
