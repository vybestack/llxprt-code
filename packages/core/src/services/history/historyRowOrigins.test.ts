/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { HistoryRowOrigins } from './historyRowOrigins.js';
import { getScratchRoot } from '../../storage/scratch-root.js';

function scratch(): string[] {
  return readdirSync(getScratchRoot()).filter((name) =>
    name.startsWith('history-row-origins-'),
  );
}

/** Row `index` belongs to origin `a`, `b`, or nobody, in a repeating pattern. */
function patternOrigin(index: number): string | undefined {
  return [undefined, 'a', 'b'][index % 3];
}

function textRow(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('HistoryRowOrigins', () => {
  it('returns each row its own origin across several write chunks', () => {
    const length = 10_000;
    const origins = HistoryRowOrigins.capture({
      length,
      originAt: patternOrigin,
    });
    try {
      const read = Array.from({ length }, (_, index) =>
        origins.originAt(index),
      );
      expect(read).toStrictEqual(
        Array.from({ length }, (_, index) => patternOrigin(index)),
      );
    } finally {
      origins.close();
    }
  });

  it('pairs rows with origins by position and keeps unowned rows unowned', () => {
    const origins = HistoryRowOrigins.capture({
      length: 3,
      originAt: patternOrigin,
    });
    try {
      const owned = [
        ...origins.owned([textRow('x'), textRow('y'), textRow('z')]),
      ];
      expect(owned).toStrictEqual([
        { content: textRow('x') },
        { content: textRow('y'), origin: 'a' },
        { content: textRow('z'), origin: 'b' },
      ]);
    } finally {
      origins.close();
    }
  });

  it('rejects a row outside the captured range', () => {
    const origins = HistoryRowOrigins.capture({
      length: 2,
      originAt: patternOrigin,
    });
    try {
      expect(() => origins.originAt(2)).toThrow(RangeError);
    } finally {
      origins.close();
    }
  });

  it('removes its scratch storage on close and refuses later reads', () => {
    const before = scratch().length;
    const origins = HistoryRowOrigins.capture({
      length: 1,
      originAt: patternOrigin,
    });
    expect(scratch().length).toBe(before + 1);

    origins.close();

    expect(scratch().length).toBe(before);
    expect(() => origins.originAt(0)).toThrow('Row origins are closed');
  });

  it('removes its scratch storage when the capture fails', () => {
    const before = scratch().length;

    expect(() =>
      HistoryRowOrigins.capture({
        length: 1,
        originAt: () => {
          throw new Error('cursor failed');
        },
      }),
    ).toThrow('cursor failed');

    expect(scratch().length).toBe(before);
  });
});
