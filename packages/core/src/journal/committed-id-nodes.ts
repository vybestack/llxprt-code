/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { decodeIdTrieNode } from './idTrieNode.js';
import { RECORD_KIND } from './recordKinds.js';
import type { JournalGroupWriter } from './groupWriter.js';
import type { TrailerHeader } from './trailerRecord.js';

/** Written nodes become reusable only after their trailer has been acknowledged. */
export class CommittedIdNodes {
  private readonly written = new BoundedIdNodeCache();

  prepareGroup(
    writer: JournalGroupWriter,
    build: (
      appender: RecordAppender,
    ) => ReturnType<Parameters<JournalGroupWriter['prepareGroup']>[0]>,
  ): ReturnType<JournalGroupWriter['prepareGroup']> {
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
      this.copyPath(root, target, 0);
    }
  }

  private appender(target: RecordAppender): RecordAppender {
    return {
      get nextOffset() {
        return target.nextOffset;
      },
      drain: () => target.drain(),
      append: async (record) => {
        const offset = await target.append(record);
        if (record.kind === RECORD_KIND.ITNODE)
          this.written.put(offset, record.kindHeader);
        return offset;
      },
    };
  }

  private copyPath(offset: number, target: IdNodeCache, depth: number): void {
    const bytes = this.written.get(offset);
    if (bytes === undefined) return;
    const node = decodeIdTrieNode(bytes);
    target.put(offset, bytes, depth < 3 && node.kind === 'internal');
    if (node.kind === 'internal')
      for (const child of node.children)
        this.copyPath(child, target, depth + 1);
  }
}
