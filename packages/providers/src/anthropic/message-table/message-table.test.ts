/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'bun:test';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { SeededRandom } from '../../openai/__tests__/support/chatBodyCorpus.js';
import type { AnthropicMessage } from '../AnthropicMessageNormalizer.js';
import { MessageTable, newMessage } from './message-table.js';
import {
  dumpBytes,
  type DumpCase,
} from './__tests__/support/messageTableHistories.js';
import { countStorageOperations } from './__tests__/support/storageCounter.js';
import { filterOrphans, repairAdjacency, mergeRoles } from './validation.js';

const open: MessageTable[] = [];
function createTable(): MessageTable {
  const table = new MessageTable();
  open.push(table);
  return table;
}
function closeTables(): void {
  for (const table of open.splice(0)) table.close();
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

function use(id: string): AnthropicMessage {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'tool', input: {} }],
  };
}
function result(id: string): AnthropicMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }],
  };
}
function text(role: AnthropicMessage['role'], value: string): AnthropicMessage {
  return { role, content: value };
}

/** The message ids walked forward and backward, which must agree with each other. */
function linksOf(table: MessageTable): {
  forward: number[];
  backward: number[];
  head: number;
} {
  const backward: number[] = [];
  for (let id = table.tail; id !== -1; id = table.messages.read(id).prev)
    backward.push(id);
  return { forward: [...table.ids()], backward, head: table.head };
}

function layout(ids: readonly number[]): ReturnType<typeof linksOf> {
  return {
    forward: [...ids],
    backward: [...ids].reverse(),
    head: ids.length === 0 ? -1 : ids[0],
  };
}

function blockTexts(table: MessageTable, id: number): string[] {
  const texts: string[] = [];
  for (const entry of table.entries(table.messages.read(id)))
    texts.push(
      entry.block.type === 'text' ? entry.block.text : entry.block.type,
    );
  return texts;
}

describe('MessageTable links', () => {
  afterEach(closeTables);
  it('appends in order with prev and next agreeing', () => {
    const table = createTable();
    const ids = [1, 2, 3, 4].map((n) => table.append(text('user', `m${n}`)));
    expect(linksOf(table)).toStrictEqual(layout(ids));
  });

  it('removes the head, a middle message and the tail without searching', () => {
    const table = createTable();
    const ids = [0, 1, 2, 3, 4].map((n) => table.append(text('user', `m${n}`)));
    table.removeMessage(ids[2]);
    expect(linksOf(table)).toStrictEqual(
      layout([ids[0], ids[1], ids[3], ids[4]]),
    );
    table.removeMessage(ids[0]);
    expect(linksOf(table)).toStrictEqual(layout([ids[1], ids[3], ids[4]]));
    table.removeMessage(ids[4]);
    expect(linksOf(table)).toStrictEqual(layout([ids[1], ids[3]]));
    table.removeMessage(ids[1]);
    table.removeMessage(ids[3]);
    expect(linksOf(table)).toStrictEqual(layout([]));
  });

  it('inserts after the tail and after a middle message', () => {
    const table = createTable();
    const [a, b] = [0, 1].map((n) => table.append(text('user', `m${n}`)));
    const afterTail = table.insertAfter(b, newMessage('assistant'));
    expect(linksOf(table)).toStrictEqual(layout([a, b, afterTail]));
    const afterHead = table.insertAfter(a, newMessage('user'));
    expect(linksOf(table)).toStrictEqual(layout([a, afterHead, b, afterTail]));
  });

  it('keeps an iteration standing on a removed message going', () => {
    const table = createTable();
    const ids = [0, 1, 2, 3].map((n) => table.append(text('user', `m${n}`)));
    const seen: number[] = [];
    for (const id of table.ids()) {
      seen.push(id);
      if (id === ids[1] || id === ids[2]) table.removeMessage(id);
    }
    expect(seen).toStrictEqual(ids);
    expect(linksOf(table)).toStrictEqual(layout([ids[0], ids[3]]));
  });

  it('follows a random mix of removals and insertions like a plain list', () => {
    for (let seed = 0; seed < 25; seed++) {
      const random = new SeededRandom(seed);
      const table = createTable();
      const model: number[] = [];
      for (let step = 0; step < 60; step++) {
        const roll = random.int(3);
        if (roll === 0 || model.length === 0) {
          model.push(table.append(text('user', `s${step}`)));
        } else if (roll === 1) {
          const at = random.int(model.length);
          table.removeMessage(model[at]);
          model.splice(at, 1);
        } else {
          const at = random.int(model.length);
          const id = table.insertAfter(model[at], newMessage('user'));
          model.splice(at + 1, 0, id);
        }
        expect(linksOf(table)).toStrictEqual(layout(model));
      }
    }
  });
});

describe('MessageTable block lists', () => {
  afterEach(closeTables);
  function messageOf(table: MessageTable, count: number) {
    const message = newMessage('user');
    const blockIds = Array.from({ length: count }, (_, n) =>
      table.addBlock(message, { type: 'text', text: `b${n}` }),
    );
    return { message, blockIds };
  }

  it('unlinks the first, a middle, the last and the only block', () => {
    const table = createTable();
    const { message, blockIds } = messageOf(table, 4);
    table.unlinkBlock(message, blockIds[1]);
    expect([...table.entries(message)].map((e) => e.id)).toStrictEqual([
      blockIds[0],
      blockIds[2],
      blockIds[3],
    ]);
    table.unlinkBlock(message, blockIds[0]);
    table.unlinkBlock(message, blockIds[3]);
    expect([...table.entries(message)].map((e) => e.id)).toStrictEqual([
      blockIds[2],
    ]);
    expect(message.tail).toBe(blockIds[2]);
    table.unlinkBlock(message, blockIds[2]);
    expect(message).toMatchObject({ head: -1, tail: -1 });
  });

  it('unlinks with the same number of storage operations in a short and a long list', async () => {
    async function operations(length: number): Promise<number> {
      const table = createTable();
      const { message, blockIds } = messageOf(table, length);
      const counts = await countStorageOperations(async () => {
        table.unlinkBlock(message, blockIds[Math.floor(length / 2)]);
      });
      return counts.total;
    }
    expect(await operations(500)).toBe(await operations(10));
  });

  it('moves a whole list to the end of another with concatBlocks', () => {
    const table = createTable();
    const first = messageOf(table, 2);
    const second = messageOf(table, 3);
    table.concatBlocks(first.message, second.message);
    expect(first.message.tail).toBe(second.message.tail);
    const forward = [...table.entries(first.message)];
    expect(forward.map((e) => e.id)).toStrictEqual([
      ...first.blockIds,
      ...second.blockIds,
    ]);
    // prev links agree with next links across the join.
    let id = first.message.tail;
    const backward: number[] = [];
    while (id !== -1) {
      backward.push(id);
      id = table.blocks.read(id).prev;
    }
    expect(backward).toStrictEqual(forward.map((e) => e.id).reverse());
  });

  it('concatenates into an empty list and from an empty list', () => {
    const table = createTable();
    const empty = newMessage('user');
    const full = messageOf(table, 2);
    table.concatBlocks(empty, full.message);
    expect([...table.entries(empty)].map((e) => e.id)).toStrictEqual(
      full.blockIds,
    );
    table.concatBlocks(empty, newMessage('user'));
    expect([...table.entries(empty)]).toHaveLength(2);
    expect(empty.tail).toBe(full.blockIds[1]);
  });
});

describe('ToolIdIndex through the table', () => {
  afterEach(closeTables);
  it('lists each tool_use and tool_result once and answers by key', () => {
    const table = createTable();
    const call = table.append(use('a'));
    const answer = table.append(result('a'));
    table.append(use('b'));
    const index = table.toolIds();
    expect(index.hasUse('a')).toBe(true);
    expect(index.hasUse('missing')).toBe(false);
    expect(index.results('a')).toHaveLength(1);
    expect(index.results('a')[0].message).toBe(answer);
    expect(index.hasResult('b')).toBe(false);
    expect(call).toBeLessThan(answer);
  });

  it('refuses an append once ids are indexed', () => {
    const table = createTable();
    table.append(use('a'));
    table.toolIds();
    expect(() => table.append(result('a'))).toThrow('indexed');
  });

  it('reads the table once to build the index and not again', async () => {
    const table = createTable();
    for (let n = 0; n < 20; n++) {
      table.append(use(`t${n}`));
      table.append(result(`t${n}`));
    }
    const first = await countStorageOperations(async () => table.toolIds());
    expect(first.tableReads).toBeGreaterThanOrEqual(40);
    const second = await countStorageOperations(async () => table.toolIds());
    expect(second.total).toBe(0);
  });

  it('removes a result location once', () => {
    const table = createTable();
    table.append(use('a'));
    const answer = table.append(result('a'));
    const index = table.toolIds();
    const [location] = index.results('a');
    expect(location.message).toBe(answer);
    expect(index.removeResult('a', location.message, location.block)).toBe(
      true,
    );
    expect(index.removeResult('a', location.message, location.block)).toBe(
      false,
    );
    expect(index.hasResult('a')).toBe(false);
  });

  it('lists every location of a duplicated result id', () => {
    const table = createTable();
    table.append(use('a'));
    const first = table.append(result('a'));
    const second = table.append(result('a'));
    expect(
      table
        .toolIds()
        .results('a')
        .map((location) => location.message),
    ).toStrictEqual([first, second]);
  });
});

describe('validation passes keep the ids index current', () => {
  afterEach(closeTables);
  it('moves a displaced result and indexes the synthesized one', () => {
    const table = createTable();
    table.append(use('a'));
    table.append(text('user', 'interrupt'));
    const late = table.append(result('a'));
    table.append(use('b'));
    table.append(text('assistant', 'done'));
    filterOrphans(table);
    repairAdjacency(table);
    const index = table.toolIds();
    const ids = [...table.ids()];
    // 'a' moved into the message after its call; its old message is gone.
    expect(ids).not.toContain(late);
    expect(index.results('a')).toHaveLength(1);
    expect(index.results('a')[0].message).toBe(ids[1]);
    // 'b' had no result, so an interrupted one was inserted after its call.
    expect(index.results('b')).toHaveLength(1);
    const placed = table.messages.read(index.results('b')[0].message);
    expect(placed.role).toBe('user');
    for (const [id, expected] of [
      ['a', ids[1]],
      ['b', index.results('b')[0].message],
    ] as const) {
      const block = table.blocks.read(index.results(id)[0].block).block;
      expect(block).toMatchObject({ type: 'tool_result', tool_use_id: id });
      expect(index.results(id)[0].message).toBe(expected);
    }
  });

  it('drops an orphan result from the table and the index, with its emptied message', () => {
    const table = createTable();
    table.append(text('user', 'hi'));
    const orphan = table.append(result('gone'));
    table.append(text('assistant', 'ok'));
    filterOrphans(table);
    expect([...table.ids()]).not.toContain(orphan);
    expect(table.toolIds().hasResult('gone')).toBe(false);
    expect(linksOf(table)).toStrictEqual(layout([...table.ids()]));
  });

  it('merges runs of one role and keeps the links', () => {
    const table = createTable();
    const ids = [
      table.append(text('user', 'a')),
      table.append(text('user', 'b')),
      table.append(text('assistant', 'c')),
      table.append(text('user', 'd')),
      table.append(text('user', 'e')),
    ];
    mergeRoles(table);
    expect(linksOf(table)).toStrictEqual(layout([ids[0], ids[2], ids[3]]));
    expect(blockTexts(table, ids[0])).toStrictEqual(['a', 'b']);
    expect(blockTexts(table, ids[3])).toStrictEqual(['d', 'e']);
    expect(table.tail).toBe(ids[3]);
  });
});

describe('displaced results for repeated call ids', () => {
  afterEach(closeTables);
  const call = (id: string): ContentBlock => ({
    type: 'tool_call',
    id,
    name: 'tool',
    parameters: {},
  });
  const answer = (id: string): ContentBlock => ({
    type: 'tool_response',
    callId: id,
    toolName: 'tool',
    result: id,
  });

  it('collects the displaced result once per call and leaves the rest of its message', async () => {
    const policy: DumpCase['policy'] = 'none';
    const history: IContent[] = [
      { speaker: 'ai', blocks: [call('d')] },
      { speaker: 'tool', blocks: [answer('d')] },
      { speaker: 'ai', blocks: [call('a'), call('c'), call('a')] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'x' }] },
      { speaker: 'tool', blocks: [answer('a'), answer('c'), answer('d')] },
    ];
    const messages: Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }> = JSON.parse(await dumpBytes(history, policy)).messages;
    const names = (message: { content: Array<Record<string, unknown>> }) =>
      message.content.map((block) => block.type);
    expect(messages.map((message) => message.role)).toStrictEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    const [, , , calls, last] = messages;
    expect(names(calls)).toStrictEqual(['tool_use', 'tool_use', 'tool_use']);
    expect(names(last)).toStrictEqual([
      'tool_result',
      'tool_result',
      'tool_result',
      'tool_result',
      'text',
    ]);
    expect(last.content.map((block) => block.tool_use_id)).toStrictEqual([
      calls.content[0].id,
      calls.content[1].id,
      calls.content[2].id,
      messages[1].content[0].id,
      undefined,
    ]);
  });
});

describe('MessageTable lifecycle', () => {
  afterEach(closeTables);
  it('removes every scratch directory on close, including the ids index', () => {
    const before = scratchNames();
    const table = new MessageTable();
    table.append(use('a'));
    table.toolIds();
    expect(scratchNames().size).toBe(before.size + 3);
    table.close();
    expect(scratchNames()).toStrictEqual(before);
  });

  it('closes without an ids index', () => {
    const before = scratchNames();
    const table = new MessageTable();
    table.append(text('user', 'a'));
    table.close();
    expect(scratchNames()).toStrictEqual(before);
  });
});
