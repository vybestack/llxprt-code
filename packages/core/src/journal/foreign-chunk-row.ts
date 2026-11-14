/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import type { RecordAccess } from './recordAccess.js';
import { readSourceHead, appendSourceRecord } from './recordTransfer.js';
import { chunkValue, decodeChunkBlock, encodeChunkBlock } from './chunk-row.js';
import {
  readTranscriptNode,
  encodeTranscriptNode,
  type TranscriptEntry,
  type TranscriptChild,
} from './transcript-tree.js';
import { RECORD_KIND } from './recordKinds.js';
import { encodeRowHeader, type RowHeader } from './rowRecord.js';

class ForeignChunks {
  constructor(
    private readonly source: RecordAccess,
    private readonly target: RecordAppender,
  ) {}
  async raw(ref: number, kind: 'VALUE' | 'PIECE'): Promise<number> {
    const head = await readSourceHead(this.source, ref, kind);
    return (await appendSourceRecord(this.source, this.target, head, kind))
      .offset;
  }
  private async descriptor(ref: number): Promise<number> {
    const value = decodeChunkBlock(await chunkValue(this.source, ref));
    const piecesRoot = await this.tree(
      value.piecesRoot,
      value.named === true ? 'blocks' : 'pieces',
    );
    const bytes = encodeChunkBlock({ ...value, piecesRoot });
    return this.target.append({
      kind: RECORD_KIND.VALUE,
      kindHeader: new TextEncoder().encode('recording:block'),
      body: { length: bytes.length, chunks: [bytes] },
    });
  }
  async tree(root: number, mode: 'blocks' | 'pieces'): Promise<number> {
    if (root === 0) return 0;
    const node = await readTranscriptNode(this.source, root, mode);
    const entries: TranscriptEntry[] = [];
    for (const entry of node.entries) {
      const rowRef =
        mode === 'pieces'
          ? await this.raw(entry.rowRef, 'PIECE')
          : await this.descriptor(entry.rowRef);
      entries.push({ ...entry, rowRef });
    }
    const children: TranscriptChild[] = [];
    for (const child of node.children)
      children.push({
        ...child,
        ref: await this.tree(child.ref, mode),
        maxRowRef: 0,
      });
    return this.target.append({
      kind: RECORD_KIND.TNODE,
      kindHeader: encodeTranscriptNode({ ...node, entries, children }),
    });
  }
}
export async function copyForeignChunkRow(
  source: RecordAccess,
  target: RecordAppender,
  header: RowHeader,
): Promise<number> {
  const chunk = header.chunk;
  if (chunk === undefined) throw new Error('Missing foreign chunk manifest');
  const copier = new ForeignChunks(source, target);
  const blocksRoot = await copier.tree(chunk.blocksRoot, 'blocks');
  const metaRef = await copier.raw(chunk.metaRef, 'VALUE');
  return target.append({
    kind: RECORD_KIND.ROW,
    kindHeader: encodeRowHeader({
      ...header,
      chunk: { ...chunk, blocksRoot, metaRef },
    }),
  });
}
