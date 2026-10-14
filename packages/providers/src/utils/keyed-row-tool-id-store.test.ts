/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import {
  kimiStrategy,
  mistralStrategy,
  type ToolIdMapper,
  type ToolIdStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { KeyedRowIndex } from './keyed-row-index.js';
import { KeyedRowToolIdStore } from './keyed-row-tool-id-store.js';

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

function callRow(...calls: Array<[id: string, name: string]>): IContent {
  return {
    speaker: 'ai',
    blocks: calls.map(([id, name]) => ({
      type: 'tool_call' as const,
      id,
      name,
      parameters: {},
    })),
  };
}

function resultRow(callId: string, toolName: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response' as const,
        callId,
        toolName,
        result: 'ok',
      },
    ],
  };
}

async function* streamOf(rows: IContent[]): AsyncGenerator<IContent> {
  yield* rows;
}

type Op =
  | { kind: 'call'; id: string; name: string }
  | { kind: 'response'; callId: string; toolName: string };

function applyOps(mapper: ToolIdMapper, ops: Op[]): string[] {
  return ops.map((op) =>
    op.kind === 'call'
      ? mapper.resolveToolCallId({
          type: 'tool_call',
          id: op.id,
          name: op.name,
          parameters: {},
        })
      : mapper.resolveToolResponseId({
          callId: op.callId,
          toolName: op.toolName,
        }),
  );
}

/** One row at a time from a stream: no array of rows is ever built. */
async function observeFromStream(
  strategy: ToolIdStrategy,
  rows: AsyncIterable<IContent>,
  index: KeyedRowIndex,
): Promise<ToolIdMapper> {
  const mapper = strategy.createStreamingMapper(new KeyedRowToolIdStore(index));
  for await (const row of rows) mapper.observe(row);
  return mapper;
}

function firstMistralCandidate(seed: string): string {
  return mistralStrategy
    .createMapper([callRow([seed, 'x'])])
    .resolveToolCallId({
      type: 'tool_call',
      id: seed,
      name: 'x',
      parameters: {},
    });
}

describe('KeyedRowToolIdStore', () => {
  it('answers mapped ids and used ids independently, last write wins', () => {
    const index = KeyedRowIndex.create('tool-id-store-test');
    try {
      const store = new KeyedRowToolIdStore(index);
      expect(store.getMappedId('same')).toBeUndefined();
      store.markUsed('same');
      expect(store.getMappedId('same')).toBeUndefined();
      expect(store.isUsed('same')).toBe(true);
      expect(store.isUsed('other')).toBe(false);
      store.setMappedId('call', 'first');
      store.setMappedId('call', 'second');
      expect(store.getMappedId('call')).toBe('second');
      expect(store.isUsed('call')).toBe(false);
    } finally {
      index.close();
    }
  });

  it('does not read other facts stored in the same index', () => {
    const index = KeyedRowIndex.create('tool-id-store-test');
    try {
      index.set('call', 'someone else');
      index.set('tool-id:number', 7);
      const store = new KeyedRowToolIdStore(index);
      expect(store.getMappedId('call')).toBeUndefined();
      expect(store.getMappedId('number')).toBeUndefined();
    } finally {
      index.close();
    }
  });

  it('keeps its facts in a scratch directory that closing the index removes', () => {
    const before = scratchNames();
    const index = KeyedRowIndex.create('tool-id-store-test');
    const during = [...scratchNames()].filter((name) => !before.has(name));
    expect(during).toHaveLength(1);
    new KeyedRowToolIdStore(index).setMappedId('a', 'b');
    index.close();
    expect(scratchNames()).toStrictEqual(before);
  });

  it('fails visibly once the index is closed', () => {
    const index = KeyedRowIndex.create('tool-id-store-test');
    const store = new KeyedRowToolIdStore(index);
    index.close();
    expect(() => store.getMappedId('a')).toThrow(
      'Provider normalization storage is closed',
    );
  });
});

describe('streaming mappers over the disk store give the array mapper ids', () => {
  const longIds = Array.from({ length: 1500 }, (_, i) => `hist_tool_${i}`);

  it('Kimi: collisions, last writer wins, unmapped responses and calls', async () => {
    const rows = [
      callRow(['dup', 'first'], ['keep', 'read']),
      resultRow('keep', 'read'),
      callRow(['dup', 'second']),
      callRow(...longIds.map((id): [string, string] => [id, 'shell'])),
    ];
    const ops: Op[] = [
      { kind: 'call', id: 'dup', name: 'second' },
      { kind: 'response', callId: 'keep', toolName: 'read' },
      { kind: 'response', callId: 'ghost', toolName: 'edit' },
      { kind: 'call', id: 'unseen', name: 'grep' },
      { kind: 'response', callId: longIds[1499], toolName: 'shell' },
      { kind: 'call', id: longIds[0], name: 'shell' },
      { kind: 'response', callId: 'ghost', toolName: 'edit' },
    ];
    const index = KeyedRowIndex.create('tool-id-store-test');
    try {
      const mapper = await observeFromStream(
        kimiStrategy,
        streamOf(rows),
        index,
      );
      expect(applyOps(mapper, ops)).toStrictEqual(
        applyOps(kimiStrategy.createMapper(rows), ops),
      );
      expect(applyOps(mapper, ops).slice(0, 1)).toStrictEqual([
        'functions.second:2',
      ]);
    } finally {
      index.close();
    }
  });

  it('Mistral: hashed ids, used-set salt search and unmapped responses', async () => {
    const taken = firstMistralCandidate('long-id-x');
    const rows = [
      callRow([taken, 'read']),
      callRow(['long-id-x', 'write'], ['abcDEF123', 'read']),
      resultRow('long-id-x', 'write'),
      callRow(...longIds.map((id): [string, string] => [id, 'shell'])),
    ];
    const ops: Op[] = [
      { kind: 'call', id: 'long-id-x', name: 'write' },
      { kind: 'response', callId: 'long-id-x', toolName: 'write' },
      { kind: 'call', id: 'abcDEF123', name: 'read' },
      { kind: 'response', callId: 'ghost-id-long', toolName: 'edit' },
      { kind: 'call', id: 'ghost-id-long', name: 'edit' },
      { kind: 'call', id: longIds[700], name: 'shell' },
    ];
    const index = KeyedRowIndex.create('tool-id-store-test');
    try {
      const mapper = await observeFromStream(
        mistralStrategy,
        streamOf(rows),
        index,
      );
      const streamed = applyOps(mapper, ops);
      expect(streamed).toStrictEqual(
        applyOps(mistralStrategy.createMapper(rows), ops),
      );
      expect(streamed[0]).not.toBe(taken);
    } finally {
      index.close();
    }
  });

  it('Mistral: a second mapper over the same index resolves the ids the first one made', async () => {
    const rows = [
      callRow(...longIds.slice(0, 50).map((id): [string, string] => [id, 'x'])),
    ];
    const ops: Op[] = longIds
      .slice(0, 50)
      .map((id) => ({ kind: 'call', id, name: 'x' }));
    const index = KeyedRowIndex.create('tool-id-store-test');
    try {
      const first = await observeFromStream(
        mistralStrategy,
        streamOf(rows),
        index,
      );
      const second = mistralStrategy.createStreamingMapper(
        new KeyedRowToolIdStore(index),
      );
      expect(applyOps(second, ops)).toStrictEqual(applyOps(first, ops));
    } finally {
      index.close();
    }
  });
});
