/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { resolve } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NativeDensityPolicy } from '@vybestack/llxprt-code-core/services/history/nativeDensityPolicy.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { FILE_INCLUSION_CLOSE } from './HighDensityStrategy.js';

interface Inclusion {
  readonly key: string;
  readonly block: number;
  readonly start: number;
  readonly end: number;
}
export function* inclusions(row: IContent, root: string): Generator<Inclusion> {
  if (row.speaker !== 'human') return;
  for (const [block, content] of row.blocks.entries()) {
    if (content.type !== 'text') continue;
    const regex = /^--- (.+) ---$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content.text)) !== null) {
      const close = content.text.indexOf(
        FILE_INCLUSION_CLOSE,
        match.index + match[0].length,
      );
      if (close < 0) continue;
      let end = close + FILE_INCLUSION_CLOSE.length;
      if (content.text[end] === '\n') end++;
      yield {
        key: resolve(root, match[1].trim()),
        block,
        start: match.index,
        end,
      };
      regex.lastIndex = end;
    }
  }
}
export function nativeFileDedupe(
  root: string,
): NonNullable<NativeDensityPolicy['files']> {
  const workspace = resolve(root);
  return {
    facts: {
      revision: JSON.stringify([
        'file-inclusions:1',
        workspace,
        'row-desc-offset-desc-stable:1',
      ]),
      async *occurrences(snapshot, entry) {
        const row = decodeStoredRow(await snapshot.readRow(entry));
        for (const { key, block, start } of inclusions(row, workspace))
          yield { key, block, start };
      },
    },
    async replace(row, ordinal, facts) {
      if (row.speaker !== 'human') return undefined;
      const blocks = [...row.blocks];
      let changed = false;
      let blockIndex = -1;
      let cursor = 0;
      let text = '';
      const finish = (): void => {
        if (blockIndex < 0) return;
        const original = row.blocks[blockIndex];
        if (original.type !== 'text') return;
        blocks[blockIndex] = {
          type: 'text',
          text: (text + original.text.substring(cursor)).replace(
            /\n{3,}/g,
            '\n\n',
          ),
        };
      };
      for (const inclusion of inclusions(row, workspace)) {
        const latest = await facts.latest(inclusion.key);
        if (latest === undefined)
          throw new Error('Missing file inclusion fact');
        if (
          latest[0] === ordinal &&
          latest[1] === inclusion.block &&
          latest[2] === inclusion.start
        )
          continue;
        if (blockIndex !== inclusion.block) {
          finish();
          blockIndex = inclusion.block;
          cursor = 0;
          text = '';
        }
        const original = row.blocks[inclusion.block];
        if (original.type !== 'text')
          throw new Error('File inclusion block changed');
        text += original.text.substring(cursor, inclusion.start);
        cursor = inclusion.end;
        changed = true;
      }
      finish();
      return changed ? { ...row, blocks } : undefined;
    },
  };
}
