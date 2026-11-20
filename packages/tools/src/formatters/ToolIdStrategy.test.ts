/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import type { ToolCallBlock } from './IToolFormatter.js';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
  kimiStrategy,
  mistralStrategy,
  standardStrategy,
  type ContentBlock,
  type ToolIdMapper,
  type ToolIdStore,
  type ToolIdStrategy,
} from './ToolIdStrategy.js';

type Row = { blocks?: ContentBlock[] };

type Op =
  | { kind: 'call'; id: string; name: string }
  | { kind: 'response'; callId: string; toolName: string };

const MISTRAL_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function mistralCandidate(seed: string, salt: number): string {
  const hex = createHash('sha256').update(`${seed}|${salt}`).digest('hex');
  const base = BigInt(MISTRAL_CHARS.length);
  let value = BigInt(`0x${hex}`);
  let result = '';
  while (value > 0) {
    result = MISTRAL_CHARS[Number(value % base)] + result;
    value = value / base;
  }
  return result.padStart(9, 'a').slice(0, 9);
}

/** The mistral id the strategy derives for `seed` with nothing used yet. */
function firstMistralCandidate(seed: string): string {
  return mistralCandidate(seed, 0);
}

function legacyMistralId(id: string, used: Set<string>): string {
  if (/^[a-zA-Z0-9]{9}$/.test(id)) {
    return id;
  }
  for (let salt = 0; ; salt++) {
    const candidate = mistralCandidate(id, salt);
    if (!used.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * The array mappers as they were before the streaming mapper existed, kept as
 * the oracle the streaming mapper must agree with.
 */
const LEGACY: Record<'kimi' | 'mistral', (rows: Row[]) => ToolIdMapper> = {
  kimi(rows) {
    const idToK2Id = new Map<string, string>();
    let globalIndex = 0;
    for (const content of rows) {
      for (const block of content.blocks ?? []) {
        if (block.type === 'tool_call' && block.id && block.name) {
          idToK2Id.set(block.id, `functions.${block.name}:${globalIndex}`);
          globalIndex++;
        }
      }
    }
    return {
      resolveToolCallId: (tc) =>
        idToK2Id.get(tc.id) ?? `functions.${tc.name}:${globalIndex++}`,
      resolveToolResponseId: (tr) =>
        idToK2Id.get(tr.callId) ?? `functions.${tr.toolName}:${globalIndex++}`,
    };
  },
  mistral(rows) {
    const idToMistralId = new Map<string, string>();
    const usedIds = new Set<string>();
    const mapId = (id: string): string => {
      let mapped = idToMistralId.get(id);
      if (!mapped) {
        mapped = legacyMistralId(id, usedIds);
        idToMistralId.set(id, mapped);
        usedIds.add(mapped);
      }
      return mapped;
    };
    for (const content of rows) {
      for (const block of content.blocks ?? []) {
        if (block.type === 'tool_call' && block.id) {
          mapId(block.id);
        }
      }
    }
    return {
      resolveToolCallId: (tc) => mapId(tc.id),
      resolveToolResponseId: (tr) => mapId(tr.callId),
    };
  },
};

function call(id: string, name: string): ContentBlock {
  return { type: 'tool_call', id, name };
}

function row(...blocks: ContentBlock[]): Row {
  return { blocks };
}

const OPEN_IDS = [
  'hist_tool_alpha',
  'hist_tool_beta',
  'call_gamma',
  'toolu_delta',
];

const HISTORIES: Record<string, { rows: Row[]; ops: Op[] }> = {
  'distinct calls then their responses': {
    rows: [
      row(call(OPEN_IDS[0], 'read'), call(OPEN_IDS[1], 'write')),
      row({ type: 'tool_response', callId: OPEN_IDS[0], toolName: 'read' }),
      row(call(OPEN_IDS[2], 'grep')),
    ],
    ops: [
      { kind: 'call', id: OPEN_IDS[0], name: 'read' },
      { kind: 'call', id: OPEN_IDS[1], name: 'write' },
      { kind: 'response', callId: OPEN_IDS[0], toolName: 'read' },
      { kind: 'response', callId: OPEN_IDS[1], toolName: 'write' },
      { kind: 'call', id: OPEN_IDS[2], name: 'grep' },
      { kind: 'response', callId: OPEN_IDS[2], toolName: 'grep' },
    ],
  },
  'the same call id seen twice (last writer wins for Kimi)': {
    rows: [
      row(call('dup', 'first')),
      row(call('other', 'between')),
      row(call('dup', 'second')),
    ],
    ops: [
      { kind: 'call', id: 'dup', name: 'second' },
      { kind: 'response', callId: 'dup', toolName: 'second' },
      { kind: 'call', id: 'other', name: 'between' },
    ],
  },
  'responses whose call was never seen': {
    rows: [row(call(OPEN_IDS[0], 'read'))],
    ops: [
      { kind: 'response', callId: 'orphan_one', toolName: 'edit' },
      { kind: 'response', callId: OPEN_IDS[0], toolName: 'read' },
      { kind: 'response', callId: 'orphan_two', toolName: 'edit' },
      { kind: 'response', callId: 'orphan_one', toolName: 'edit' },
    ],
  },
  'calls the mapper never observed': {
    rows: [row(call(OPEN_IDS[0], 'read'))],
    ops: [
      { kind: 'call', id: 'unseen_a', name: 'shell' },
      { kind: 'call', id: 'unseen_a', name: 'shell' },
      { kind: 'call', id: 'unseen_b', name: 'shell' },
      { kind: 'call', id: OPEN_IDS[0], name: 'read' },
    ],
  },
  'blocks without an id or a name, and rows without blocks': {
    rows: [
      row({ type: 'tool_call', name: 'nameOnly' }),
      row({ type: 'tool_call', id: 'idOnly' }),
      {},
      row({ type: 'text' }, call('good', 'read')),
    ],
    ops: [
      { kind: 'call', id: 'idOnly', name: 'late' },
      { kind: 'call', id: 'good', name: 'read' },
      { kind: 'response', callId: 'idOnly', toolName: 'late' },
    ],
  },
  'ids that are already nine alphanumeric characters': {
    rows: [row(call('abcDEF123', 'read'), call('zzzzzzzzz', 'write'))],
    ops: [
      { kind: 'call', id: 'abcDEF123', name: 'read' },
      { kind: 'response', callId: 'zzzzzzzzz', toolName: 'write' },
    ],
  },
  'a nine character id that is the first candidate of a later long id': {
    rows: [
      row(call(firstMistralCandidate('long-id-x'), 'read')),
      row(call('long-id-x', 'write')),
    ],
    ops: [
      { kind: 'call', id: 'long-id-x', name: 'write' },
      { kind: 'response', callId: 'long-id-x', toolName: 'write' },
      { kind: 'call', id: firstMistralCandidate('long-id-x'), name: 'read' },
    ],
  },
  'a long id first, then a nine character id equal to its candidate': {
    rows: [
      row(call('long-id-y', 'write')),
      row(call(firstMistralCandidate('long-id-y'), 'read')),
    ],
    ops: [
      { kind: 'call', id: 'long-id-y', name: 'write' },
      { kind: 'call', id: firstMistralCandidate('long-id-y'), name: 'read' },
    ],
  },
  'unmapped ids that collide with candidates of mapped ids': {
    rows: [row(call('long-id-z', 'write'))],
    ops: [
      {
        kind: 'response',
        callId: firstMistralCandidate('long-id-z'),
        toolName: 'a',
      },
      { kind: 'response', callId: 'long-id-w', toolName: 'b' },
      { kind: 'call', id: 'long-id-z', name: 'write' },
    ],
  },
  'an empty history': {
    rows: [],
    ops: [
      { kind: 'call', id: 'solo', name: 'read' },
      { kind: 'response', callId: 'solo', toolName: 'read' },
      { kind: 'response', callId: 'other', toolName: 'read' },
    ],
  },
};

function applyOps(mapper: ToolIdMapper, ops: Op[]): string[] {
  return ops.map((op) =>
    op.kind === 'call'
      ? mapper.resolveToolCallId(toolCall(op.id, op.name))
      : mapper.resolveToolResponseId({
          callId: op.callId,
          toolName: op.toolName,
        }),
  );
}

function toolCall(id: string, name: string): ToolCallBlock {
  return { type: 'tool_call', id, name, parameters: {} };
}

function streamed(
  strategy: ToolIdStrategy,
  rows: Row[],
  store: ToolIdStore = createInMemoryToolIdStore(),
): ToolIdMapper {
  const mapper = strategy.createStreamingMapper(store);
  for (const next of rows) {
    mapper.observe(next);
  }
  return mapper;
}

const STRATEGIES: Array<[string, ToolIdStrategy]> = [
  ['kimi', kimiStrategy],
  ['mistral', mistralStrategy],
  ['standard', standardStrategy],
];

describe('ToolIdStrategy streaming mapper parity with the array mapper', () => {
  for (const [name, strategy] of STRATEGIES) {
    for (const [label, history] of Object.entries(HISTORIES)) {
      it(`${name}: ${label}`, () => {
        const fromArray = applyOps(
          strategy.createMapper(history.rows),
          history.ops,
        );
        const fromStream = applyOps(
          streamed(strategy, history.rows),
          history.ops,
        );
        expect(fromStream).toStrictEqual(fromArray);
      });
    }
  }

  for (const name of ['kimi', 'mistral'] as const) {
    for (const [label, history] of Object.entries(HISTORIES)) {
      it(`${name}: ${label} (same ids as the array mapper before streaming)`, () => {
        expect(
          applyOps(
            streamed(getToolIdStrategy(name), history.rows),
            history.ops,
          ),
        ).toStrictEqual(applyOps(LEGACY[name](history.rows), history.ops));
      });
    }
  }

  it('resolves through getToolIdStrategy the same way', () => {
    const history = HISTORIES['distinct calls then their responses'];
    for (const format of ['kimi', 'mistral', 'openai'] as const) {
      const strategy = getToolIdStrategy(format);
      expect(
        applyOps(streamed(strategy, history.rows), history.ops),
      ).toStrictEqual(
        applyOps(strategy.createMapper(history.rows), history.ops),
      );
    }
  });
});

describe('Kimi ids', () => {
  it('numbers every observed call that has an id and a name, in row order', () => {
    const mapper = streamed(kimiStrategy, [
      row(call('a', 'read'), call('b', 'write')),
      row(call('c', 'read')),
    ]);
    expect(
      applyOps(mapper, [
        { kind: 'call', id: 'a', name: 'read' },
        { kind: 'call', id: 'b', name: 'write' },
        { kind: 'call', id: 'c', name: 'read' },
      ]),
    ).toStrictEqual([
      'functions.read:0',
      'functions.write:1',
      'functions.read:2',
    ]);
  });

  it('keeps the last id recorded for a call id and counts the earlier one anyway', () => {
    const mapper = streamed(kimiStrategy, [
      row(call('dup', 'first')),
      row(call('dup', 'second')),
    ]);
    expect(
      applyOps(mapper, [
        { kind: 'call', id: 'dup', name: 'second' },
        { kind: 'call', id: 'fresh', name: 'third' },
      ]),
    ).toStrictEqual(['functions.second:1', 'functions.third:2']);
  });

  it('continues the counter for unmapped ids and does not remember them', () => {
    const mapper = streamed(kimiStrategy, [row(call('a', 'read'))]);
    expect(
      applyOps(mapper, [
        { kind: 'response', callId: 'ghost', toolName: 'edit' },
        { kind: 'response', callId: 'ghost', toolName: 'edit' },
        { kind: 'call', id: 'a', name: 'read' },
      ]),
    ).toStrictEqual([
      'functions.edit:1',
      'functions.edit:2',
      'functions.read:0',
    ]);
  });

  it('observes rows as they arrive, so ids resolve once their row was observed', () => {
    const mapper = kimiStrategy.createStreamingMapper(
      createInMemoryToolIdStore(),
    );
    mapper.observe(row(call('a', 'read')));
    expect(mapper.resolveToolCallId(toolCall('a', 'read'))).toBe(
      'functions.read:0',
    );
    mapper.observe(row(call('b', 'write')));
    expect(mapper.resolveToolCallId(toolCall('b', 'write'))).toBe(
      'functions.write:1',
    );
  });
});

describe('Mistral ids', () => {
  it('keeps a nine character alphanumeric id as it is', () => {
    const mapper = streamed(mistralStrategy, [row(call('abcDEF123', 'read'))]);
    expect(mapper.resolveToolCallId(toolCall('abcDEF123', 'read'))).toBe(
      'abcDEF123',
    );
  });

  it('gives a long id a nine character alphanumeric id, the same one every time', () => {
    const mapper = streamed(mistralStrategy, [
      row(call('hist_tool_alpha', 'r')),
    ]);
    const first = mapper.resolveToolCallId(toolCall('hist_tool_alpha', 'r'));
    expect(first).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(
      mapper.resolveToolResponseId({
        callId: 'hist_tool_alpha',
        toolName: 'r',
      }),
    ).toBe(first);
    expect(first).toBe(firstMistralCandidate('hist_tool_alpha'));
  });

  it('moves to the next salt when the first candidate is already used', () => {
    const taken = firstMistralCandidate('long-id-x');
    const mapper = streamed(mistralStrategy, [
      row(call(taken, 'read')),
      row(call('long-id-x', 'write')),
    ]);
    const mapped = mapper.resolveToolCallId(toolCall('long-id-x', 'write'));
    expect(mapped).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(mapped).not.toBe(taken);
  });

  it('records the ids of unmapped responses so later lookups agree', () => {
    const mapper = streamed(mistralStrategy, []);
    const first = mapper.resolveToolResponseId({
      callId: 'ghost-id-long',
      toolName: 'x',
    });
    expect(mapper.resolveToolCallId(toolCall('ghost-id-long', 'x'))).toBe(
      first,
    );
  });
});

describe('the store carries the mapper state', () => {
  function recordingStore(): ToolIdStore & {
    mapped: Map<string, string>;
    used: Set<string>;
  } {
    const mapped = new Map<string, string>();
    const used = new Set<string>();
    return {
      mapped,
      used,
      getMappedId: (callId) => mapped.get(callId),
      setMappedId: (callId, mappedId) => {
        mapped.set(callId, mappedId);
      },
      isUsed: (mappedId) => used.has(mappedId),
      markUsed: (mappedId) => {
        used.add(mappedId);
      },
    };
  }

  it('writes Kimi mappings to the store and a second mapper over it resolves them', () => {
    const store = recordingStore();
    streamed(kimiStrategy, [row(call('a', 'read'), call('b', 'write'))], store);
    expect([...store.mapped.entries()]).toStrictEqual([
      ['a', 'functions.read:0'],
      ['b', 'functions.write:1'],
    ]);
    const second = kimiStrategy.createStreamingMapper(store);
    expect(second.resolveToolCallId(toolCall('b', 'write'))).toBe(
      'functions.write:1',
    );
  });

  it('writes Mistral mappings and used ids to the store', () => {
    const store = recordingStore();
    const mapper = streamed(
      mistralStrategy,
      [row(call('hist_tool_alpha', 'r'), call('abcDEF123', 'w'))],
      store,
    );
    expect([...store.mapped.keys()]).toStrictEqual([
      'hist_tool_alpha',
      'abcDEF123',
    ]);
    expect([...store.used]).toStrictEqual([
      mapper.resolveToolCallId(toolCall('hist_tool_alpha', 'r')),
      'abcDEF123',
    ]);
  });

  it('standard ids never touch the store', () => {
    const store = recordingStore();
    streamed(standardStrategy, [row(call('hist_tool_alpha', 'r'))], store);
    expect(store.mapped.size).toBe(0);
    expect(store.used.size).toBe(0);
  });
});
