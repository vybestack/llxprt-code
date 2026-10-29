/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
  type ToolIdStore,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type {
  IContent,
  ContentBlock,
} from '../../../../../core/src/services/history/IContent.js';
import type { VersionSnapshot } from '../../../../../core/src/journal/versionSnapshot.js';
import type { IndexedJournalRequestSnapshot } from '../../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import {
  streamChatMessages,
  type ChatMessageItem,
} from '../../OpenAIChatBodyBuilder.js';

function writtenIds(item: ChatMessageItem): string[] {
  if (item.kind !== 'message') return [];
  if (item.message.role === 'assistant')
    return (item.message.tool_calls ?? []).map((tool) => tool.id);
  return item.message.role === 'tool' ? [item.message.tool_call_id] : [];
}

interface ConversionFacts {
  readonly eligible: number;
  readonly consumed: number;
  readonly written: number;
  readonly digits: number;
  readonly writtenFallbacks: number;
}

async function actualFacts(
  units: readonly IContent[],
): Promise<ConversionFacts> {
  const base = createInMemoryToolIdStore();
  let eligible = 0;
  let consumed = 0;
  const store: ToolIdStore = {
    getMappedId: (id) => {
      const mapped = base.getMappedId(id);
      if (mapped === undefined) consumed++;
      return mapped;
    },
    setMappedId: (id, mapped) => {
      eligible++;
      base.setMappedId(id, mapped);
    },
    isUsed: (id) => base.isUsed(id),
    markUsed: (id) => base.markUsed(id),
  };
  let written = 0;
  let digits = 0;
  let writtenFallbacks = 0;
  for await (const item of streamChatMessages(
    {
      async *rows(): AsyncGenerator<IContent> {
        yield* units;
      },
    },
    {
      toolFormat: 'kimi',
      toolIdStore: store,
      reasoning: { invocation: { ephemerals: {} } },
    },
  )) {
    for (const id of writtenIds(item)) {
      const suffix = id.slice(id.lastIndexOf(':') + 1);
      digits += suffix.length;
      written++;
      writtenFallbacks += Number(Number(suffix) >= eligible);
    }
  }
  return { eligible, consumed, written, digits, writtenFallbacks };
}

export async function assertKimiFacts(
  snapshot: VersionSnapshot,
  units: readonly IContent[],
): Promise<void> {
  const expected = await actualFacts(units);
  const ids = new Set(
    units.flatMap((unit) =>
      unit.blocks.flatMap((block) =>
        block.type === 'tool_call' ? [block.id] : [],
      ),
    ),
  );
  let written = 0;
  for (const id of ids)
    written += (await snapshot.kimiIdFact(id))?.writtenUses ?? 0;
  expect({
    eligible: await snapshot.kimiEligibleCount(),
    consumed: await snapshot.kimiUnmappedCount(),
    written,
    digits: await snapshot.kimiWrittenDigits(),
    writtenFallbacks: await snapshot.kimiUnmappedWrittenCount(),
  }).toStrictEqual(expected);
  let below = 0;
  for await (const entry of snapshot.entries()) {
    expect(await snapshot.kimiUnmappedBelow(entry.label)).toBe(below);
    below += entry.unmappedBlocks;
  }
  expect(below).toBe(expected.consumed);
}

function conversionId(
  speaker: IContent['speaker'],
  block: ContentBlock,
): string | undefined {
  if (speaker === 'ai' && block.type === 'tool_call') return block.id;
  if (speaker === 'tool' && block.type === 'tool_response') return block.callId;
  return undefined;
}

export async function assertKimiCounters(
  request: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
): Promise<void> {
  const store = createInMemoryToolIdStore();
  const mapper = getToolIdStrategy('kimi').createStreamingMapper(store);
  for (const unit of units) mapper.observe(unit);
  let consumed = 0;
  const eligible = await request.kimiEligibleCount();
  for (const [index, unit] of units.entries()) {
    expect(await request.kimiCounterBefore(index)).toBe(eligible + consumed);
    for (const block of unit.blocks) {
      const id = conversionId(unit.speaker, block);
      if (id !== undefined && store.getMappedId(id) === undefined) consumed++;
    }
  }
  expect(await request.kimiCounterBefore(request.count)).toBe(
    eligible + consumed,
  );
}

function materialized(item: ChatMessageItem): unknown {
  return item.kind === 'tool-media'
    ? { kind: item.kind, parts: [...item.parts()] }
    : item;
}

export async function assertNativeKimi(
  request: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
): Promise<void> {
  const expected: unknown[] = [];
  for await (const item of streamChatMessages(
    {
      async *rows(): AsyncGenerator<IContent> {
        yield* units;
      },
    },
    {
      toolFormat: 'kimi',
      toolIdStore: createInMemoryToolIdStore(),
      reasoning: { invocation: { ephemerals: {} } },
    },
  ))
    expected.push(materialized(item));
  const actual: unknown[] = [];
  let nativeCalls = 0;
  for await (const item of streamChatMessages(
    { rows: () => request.openReader() },
    {
      toolFormat: 'kimi',
      nativeKimi: {
        mappedId: (id) => {
          nativeCalls++;
          return request.kimiMappedId(id);
        },
        counterBefore: (index) => request.kimiCounterBefore(index),
      },
      reasoning: { invocation: { ephemerals: {} } },
    },
  ))
    actual.push(materialized(item));
  expect(actual).toStrictEqual(expected);
  expect(nativeCalls).toBe(
    units.reduce(
      (sum, unit) =>
        sum +
        unit.blocks.filter(
          (block) => conversionId(unit.speaker, block) !== undefined,
        ).length,
      0,
    ),
  );
}
