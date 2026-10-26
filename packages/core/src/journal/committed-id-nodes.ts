/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  decodeTranscriptHead,
  TRANSCRIPT_HEAD_KEY,
} from './transcript-head.js';
import {
  decodeTranscriptNode,
  TRANSCRIPT_NODE_KIND,
} from './transcript-tree.js';
import { decodeMapRef } from './keyedMap.js';
import type { RecordAppender } from './groupAppender.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { decodeIdTrieNode } from './idTrieNode.js';
import { RECORD_KIND } from './recordKinds.js';
import type {
  CommitAck,
  JournalGroupWriter,
  TrailerState,
} from './groupWriter.js';
import type { TrailerHeader } from './trailerRecord.js';

/** Written nodes become reusable only after their trailer has been acknowledged. */
export class CommittedIdNodes {
  private readonly written = new BoundedIdNodeCache();
  private transcript: { valueOffset: number; bytes: Uint8Array } | undefined;

  prepareGroup(
    writer: JournalGroupWriter,
    build: (appender: RecordAppender) => Promise<TrailerState | undefined>,
  ): Promise<CommitAck | undefined> {
    return writer.prepareGroup((target) => build(this.appender(target)));
  }

  publish(
    roots: Pick<TrailerHeader, 'idRoot' | 'metaRoot' | 'stateRoot'>,
    id: IdNodeCache,
    meta: IdNodeCache,
    state: IdNodeCache,
  ): void {
    for (const [root, target] of [
      [roots.idRoot, id],
      [roots.metaRoot, meta],
      [roots.stateRoot, state],
    ] satisfies Array<[number, IdNodeCache]>) {
      target.selectRoot(root);
      this.copyPath(root, target, 0, target !== id);
    }
    if (this.transcript !== undefined) {
      state.put(this.transcript.valueOffset, this.transcript.bytes);
      this.copyTranscript(
        decodeTranscriptHead(this.transcript.bytes).root,
        state,
      );
    }
  }

  private copyTranscript(offset: number, target: IdNodeCache): void {
    const bytes = this.written.get(offset);
    if (bytes === undefined) return;
    target.put(offset, bytes);
    const node = decodeTranscriptNode(bytes, 'transcript');
    for (const child of node.children) this.copyTranscript(child.ref, target);
  }

  private appender(target: RecordAppender): RecordAppender {
    return {
      get nextOffset() {
        return target.nextOffset;
      },
      drain: () => target.drain(),
      append: async (record) => {
        const offset = await target.append(record);
        if (
          record.kind === RECORD_KIND.ITNODE ||
          record.kind === TRANSCRIPT_NODE_KIND
        )
          this.written.put(offset, record.kindHeader);
        const chunks = record.body?.chunks;
        if (
          record.kind === RECORD_KIND.VALUE &&
          isChunks(chunks) &&
          chunks.length === 1
        ) {
          this.written.put(offset, chunks[0]);
          if (
            new TextDecoder().decode(record.kindHeader) === TRANSCRIPT_HEAD_KEY
          )
            this.transcript = { valueOffset: offset, bytes: chunks[0] };
        }
        return offset;
      },
    };
  }

  private copyPath(
    offset: number,
    target: IdNodeCache,
    depth: number,
    map: boolean,
  ): void {
    const bytes = this.written.get(offset);
    if (bytes === undefined) return;
    const node = decodeIdTrieNode(bytes);
    target.put(offset, bytes, depth < 3 && node.kind === 'internal');
    if (node.kind === 'internal') {
      for (const child of node.children)
        this.copyPath(child, target, depth + 1, map);
    } else if (map) {
      for (const entry of node.entries) {
        if (entry.value.length !== 8) continue;
        const ref = decodeMapRef(entry.value);
        const value = this.written.get(ref);
        if (value !== undefined) target.put(ref, value);
      }
    }
  }
}

function isChunks(value: unknown): value is Uint8Array[] {
  return (
    Array.isArray(value) &&
    value.every((chunk: unknown) => chunk instanceof Uint8Array)
  );
}
