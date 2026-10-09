/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { HistoryService } from './HistoryService.js';

export function changedTransformRow(row: IContent): IContent {
  return {
    ...row,
    blocks: row.blocks.map((block) =>
      block.type === 'text'
        ? { ...block, text: `changed:${block.text}` }
        : block,
    ),
  };
}

export function transformFixture(
  history: HistoryService,
  trap: boolean,
  afterPublication: () => void | Promise<void>,
): Promise<void> {
  // The trap keeps every source row alive in the test itself (a deliberate
  // context-length control); the sink never retains caller rows.
  const retained: IContent[] = [];
  return history.transformAll(
    async (source, sink) => {
      let index = 0;
      for await (const { row } of source.streamRows()) {
        if (trap) retained.push(row);
        sink.appendDetached(index === 0 ? changedTransformRow(row) : row);
        index++;
      }
    },
    undefined,
    {
      afterPublication: async () => {
        try {
          await afterPublication();
        } finally {
          retained.length = 0;
        }
      },
    },
  );
}
