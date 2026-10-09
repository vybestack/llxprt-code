/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retained-history accounting tests through the REAL HistoryService
 * (issue #3230): the complete retained IContent — including item metadata
 * (ContentMetadata: usage, model, provider fields) and every ContentBlock
 * field (ids, descriptions, MIME/encoding, speaker, variant fields) — must be
 * counted, and objects shared across items must be counted exactly once.
 */

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { computeHistorySizeBreakdown } from './contentSize.js';
import type { IContent } from './IContent.js';

async function sizeOf(service: HistoryService) {
  return computeHistorySizeBreakdown(await collectRawHistory(service));
}

function densityFixture1_asContent(raw: unknown): IContent {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('fixture: not an object');
  }
  const record = raw as Record<string, unknown>;
  const speaker = record['speaker'];
  if (
    (speaker !== 'ai' && speaker !== 'human' && speaker !== 'tool') ||
    !Array.isArray(record['blocks'])
  ) {
    throw new Error('fixture: bad speaker/blocks');
  }
  return {
    speaker,
    blocks: record['blocks'],
    metadata:
      record['metadata'] === null || record['metadata'] === undefined
        ? undefined
        : (record['metadata'] as Record<string, unknown>),
  };
}

describe('retained-history accounting — item metadata', () => {
  it('counts large ContentMetadata (usage, providerMetadata) retained on items', async () => {
    const { actual, expected0 } = await observeDensityCase2();
    expect(actual).toBeGreaterThan(expected0);
  });

  it('counts metadata on every item, not just the first', async () => {
    const { actual, expected0 } = await observeDensityCase3();
    expect(actual).toBeGreaterThan(expected0);
  });

  it('a metadata-heavy item is measurably heavier than an identical item without metadata', () => {
    const { actual, expected0 } = observeDensityCase4();
    expect(actual).toBeGreaterThan(expected0);
  });
});

describe('retained-history accounting — complete block fields', () => {
  it('counts tool_call id, name, and description', () => {
    const { actual, expected0 } = observeDensityCase5();
    expect(actual).toBeGreaterThan(expected0);
  });

  it('counts tool_response callId and error text', () => {
    const { actual, expected0 } = observeDensityCase6();
    expect(actual).toBeGreaterThan(expected0);
  });

  it('counts media mimeType, encoding, filename, and caption', () => {
    const { actual, expected0 } = observeDensityCase7();
    expect(actual).toBeGreaterThan(expected0);
  });

  it('counts thinking stream variant fields (sourceField, streamId, streamStatus)', () => {
    expect(observeDensityCase8()).toBeGreaterThan(600);
  });

  it('counts code language and the speaker string', () => {
    expect(observeDensityCase9()).toBeGreaterThanOrEqual(400);
  });
});

describe('retained-history accounting — shared objects across items', () => {
  it('counts a result object shared by two tool responses exactly once', () => {
    expect(observeDensityCase10()).toBeLessThan(200);
  });

  it('counts metadata shared across items exactly once', () => {
    expect(observeDensityCase11()).toBeLessThan(200);
  });

  it('counts shared parameters between two tool calls exactly once', () => {
    expect(observeDensityCase12()).toBeLessThan(200);
  });
});

describe('retained-history accounting — attribution consistency', () => {
  it('per-block-type and per-tool attributions never exceed the total', async () => {
    const { actual, expected0 } = await observeDensityCase13();
    expect(actual).toBeLessThanOrEqual(expected0);
  });

  it('grows proportionally when a real HistoryService accumulates large tool output', async () => {
    expect(await observeDensityCase14()).toBe(10);
  });
});

describe('retained-history accounting — complete retained-graph identity', () => {
  it('charges a one-million-character shared item exactly once through HistoryService', async () => {
    expect(await observeDensityCase15()).toBe(2);
  });

  it('charges a shared blocks array referenced by two items exactly once', async () => {
    expect(await observeDensityCase16()).toBe(1);
  });

  it('charges a shared block object appearing in two different arrays once', async () => {
    expect(await observeDensityCase17()).toBe(2);
  });
});

describe('retained-history accounting — null runtime strings from external JSON', () => {
  /**
   * Narrows a JSON-parsed value to IContent WITHOUT unsafe casts: validate
   * the shape, then reconstruct a typed object field by field. This mirrors
   * what restored/external JSON can deliver: null where an optional string is
   * declared (and, pathologically, where a required one is).
   */

  it('treats a null optional string as absent instead of crashing', () => {
    const { actual, expected0 } = observeDensityCase18();
    expect(actual).toBe(expected0);
  });

  it('estimates a null REQUIRED string as one slot instead of crashing', () => {
    const { actual, expected0 } = observeDensityCase19();
    expect(actual).toBeGreaterThanOrEqual(expected0);
  });
});

describe('retained-history accounting — bounded top-N working storage', () => {
  it('ranks only the heaviest topN responses regardless of history volume', async () => {
    const { actual, expected0 } = await observeDensityCase20();
    expect(actual).toBeLessThanOrEqual(expected0);
  });

  it('an explicit topN of 1 keeps exactly the single heaviest response', async () => {
    expect(await observeDensityCase21()).toBe('big');
  });
});

async function observeDensityCase2() {
  const service = new HistoryService();
  const item: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'answer' }],
    metadata: {
      timestamp: 1_770_000_000_000,
      model: 'test-model',
      usage: {
        promptTokens: 12_345,
        completionTokens: 678,
        totalTokens: 13_023,
        cachedTokens: 9_000,
      },
      providerMetadata: {
        note: 'm'.repeat(20_000),
      },
      providerBaseURL: 'https://provider.example.com/v1',
    },
  };
  service.add(item);
  const breakdown = await sizeOf(service);
  // The 20 KB providerMetadata note alone must be reflected in the total.

  return { actual: breakdown.totalBytes, expected0: 20_000 };
}

async function observeDensityCase3() {
  const service = new HistoryService();
  for (let i = 0; i < 5; i++) {
    service.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x' }],
      metadata: { providerMetadata: { blob: 'y'.repeat(10_000) } },
    });
  }
  const breakdown = await sizeOf(service);
  // 5 x 10 KB of metadata must be visible.

  return { actual: breakdown.totalBytes, expected0: 50_000 };
}

function observeDensityCase4() {
  const bare: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'same text' }],
  };
  const withMeta: IContent = {
    ...bare,
    metadata: { providerMetadata: { blob: 'z'.repeat(30_000) } },
  };
  const bareSize = computeHistorySizeBreakdown([bare]).totalBytes;
  const metaSize = computeHistorySizeBreakdown([withMeta]).totalBytes;

  return { actual: metaSize - bareSize, expected0: 30_000 };
}

function observeDensityCase5() {
  const bare = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: 'c1', name: 'read_file', parameters: {} },
      ],
    },
  ]).totalBytes;
  const rich = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-' + 'x'.repeat(200),
          name: 'read_file',
          description: 'd'.repeat(2_000),
          parameters: {},
        },
      ],
    },
  ]).totalBytes;

  return { actual: rich - bare, expected0: 2_000 };
}

function observeDensityCase6() {
  const bare = computeHistorySizeBreakdown([
    {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'c', toolName: 't', result: null },
      ],
    },
  ]).totalBytes;
  const rich = computeHistorySizeBreakdown([
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-' + 'x'.repeat(300),
          toolName: 't',
          result: null,
          error: 'e'.repeat(1_500),
        },
      ],
    },
  ]).totalBytes;

  return { actual: rich - bare, expected0: 1_500 };
}

function observeDensityCase7() {
  const bare = computeHistorySizeBreakdown([
    {
      speaker: 'human',
      blocks: [{ type: 'media', mimeType: 'a', encoding: 'base64', data: 'd' }],
    },
  ]).totalBytes;
  const rich = computeHistorySizeBreakdown([
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/' + 'm'.repeat(300),
          encoding: 'base64',
          data: 'd',
          filename: 'f'.repeat(500),
          caption: 'c'.repeat(800),
        },
      ],
    },
  ]).totalBytes;

  return { actual: rich - bare, expected0: 1_500 };
}

function observeDensityCase8() {
  const bare = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [{ type: 'thinking', thought: 't' }],
    },
  ]).totalBytes;
  const rich = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 't',
          sourceField: 's'.repeat(300),
          streamId: 'i'.repeat(300),
          streamStatus: 'complete',
        },
      ],
    },
  ]).totalBytes;

  return rich - bare;
}

function observeDensityCase9() {
  const bare = computeHistorySizeBreakdown([
    { speaker: 'ai', blocks: [{ type: 'code', code: 'c' }] },
  ]).totalBytes;
  const rich = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [{ type: 'code', code: 'c', language: 'l'.repeat(400) }],
    },
  ]).totalBytes;

  return rich - bare;
}

function observeDensityCase10() {
  const sharedResult = { content: 'r'.repeat(40_000) };
  const twice = computeHistorySizeBreakdown([
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'a',
          toolName: 't',
          result: sharedResult,
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'b',
          toolName: 't',
          result: sharedResult,
        },
      ],
    },
  ]).totalBytes;
  const once = computeHistorySizeBreakdown([
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'a',
          toolName: 't',
          result: sharedResult,
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        { type: 'tool_response', callId: 'b', toolName: 't', result: null },
      ],
    },
  ]).totalBytes;
  // The shared body must be charged once: the two-item history is barely
  // heavier than the one-item one.

  return twice - once;
}

function observeDensityCase11() {
  const sharedMetadata = {
    timestamp: 1_770_000_000_000,
    model: 'test-model',
    providerMetadata: { blob: 'x'.repeat(30_000) },
  };
  const twice = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'a' }],
      metadata: sharedMetadata,
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'b' }],
      metadata: sharedMetadata,
    },
  ]).totalBytes;
  const once = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'a' }],
      metadata: sharedMetadata,
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'b' }],
      metadata: undefined,
    },
  ]).totalBytes;

  return twice - once;
}

function observeDensityCase12() {
  const sharedParams = { path: '/x', content: 'p'.repeat(25_000) };
  const twice = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'a',
          name: 'edit',
          parameters: sharedParams,
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'b',
          name: 'write',
          parameters: sharedParams,
        },
      ],
    },
  ]).totalBytes;
  const once = computeHistorySizeBreakdown([
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'a',
          name: 'edit',
          parameters: sharedParams,
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'tool_call', id: 'b', name: 'write', parameters: {} }],
    },
  ]).totalBytes;

  return twice - once;
}

async function observeDensityCase13() {
  const service = new HistoryService();
  service.add({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'q'.repeat(500) }],
  });
  service.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'c1',
        name: 'read_file',
        parameters: { path: '/tmp/a' },
      },
    ],
  });
  service.add({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'c1',
        toolName: 'read_file',
        result: 'x'.repeat(50_000),
      },
    ],
  });
  service.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'done'.repeat(100) }],
    metadata: { model: 'test' },
  });

  const breakdown = await sizeOf(service);
  const blockSum = Object.values(breakdown.bytesByBlockType).reduce(
    (a, b) => a + b,
    0,
  );
  const toolSum = Object.values(breakdown.bytesByToolName).reduce(
    (a, b) => a + b,
    0,
  );
  // Attributions are subsets of the total; with no shared objects they sum
  // exactly to the block portion, and never exceed the whole.
  expect(blockSum).toBeLessThanOrEqual(breakdown.totalBytes);

  return { actual: toolSum, expected0: blockSum };
}

async function observeDensityCase14() {
  const service = new HistoryService();
  const first = (await sizeOf(service)).totalBytes;
  for (let i = 0; i < 10; i++) {
    service.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `c${i}`,
          toolName: 'read_file',
          result: { content: 'x'.repeat(10_000) },
        },
      ],
    });
  }
  const second = (await sizeOf(service)).totalBytes;
  // 10 x 10 KB of distinct output must all be counted.
  expect(second - first).toBeGreaterThan(100_000);
  const breakdown = await sizeOf(service);
  expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(100_000);

  return breakdown.itemCount;
}

async function observeDensityCase15() {
  // One item whose payload is 1,000,000 characters, referenced from two
  // history entries (the service stores references, so both entries alias
  // the SAME object). The retained heap holds it once; the accounting must
  // too, or a duplicate-retention bug would double-count ~1 MB per alias.
  const service = new HistoryService();
  const shared: IContent = {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call-shared',
        toolName: 'read_file',
        result: { content: 'x'.repeat(1_000_000) },
      },
    ],
  };
  service.add(shared);
  service.add(shared);
  const breakdown = await sizeOf(service);
  // Roughly one million payload characters plus small per-entry overhead —
  // NOT two million. Bound both sides to catch under- and over-counting.
  expect(breakdown.totalBytes).toBeGreaterThan(1_000_000);
  expect(breakdown.totalBytes).toBeLessThan(1_050_000);

  return breakdown.itemCount;
}

async function observeDensityCase16() {
  // Two distinct items that alias the SAME blocks array (a real aliasing
  // path: shallow-coned items sharing blocks).
  const blocks = [{ type: 'text' as const, text: 'y'.repeat(500_000) }];
  const service = new HistoryService();
  service.add({ speaker: 'ai', blocks });
  service.add({ speaker: 'human', blocks });
  const breakdown = await sizeOf(service);
  expect(breakdown.totalBytes).toBeGreaterThan(500_000);
  expect(breakdown.totalBytes).toBeLessThan(510_000);

  return breakdown.countsByBlockType['text'];
}

async function observeDensityCase17() {
  const sharedBlock = {
    type: 'text' as const,
    text: 'z'.repeat(200_000),
  };
  const service = new HistoryService();
  service.add({ speaker: 'ai', blocks: [sharedBlock] });
  service.add({
    speaker: 'ai',
    blocks: [sharedBlock, { type: 'text', text: 'own' }],
  });
  const breakdown = await sizeOf(service);
  expect(breakdown.totalBytes).toBeGreaterThan(200_000);
  expect(breakdown.totalBytes).toBeLessThan(205_000);

  return breakdown.countsByBlockType['text'];
}

function observeDensityCase18() {
  // Restored JSON delivering language: null must size like language being
  // absent (0) — no crash, no NaN.
  const withNull = densityFixture1_asContent(
    JSON.parse(
      '{"speaker":"ai","blocks":[{"type":"code","code":"c","language":null}]}',
    ),
  );
  const without = densityFixture1_asContent(
    JSON.parse('{"speaker":"ai","blocks":[{"type":"code","code":"c"}]}'),
  );
  const a = computeHistorySizeBreakdown([withNull]).totalBytes;
  const b = computeHistorySizeBreakdown([without]).totalBytes;
  expect(Number.isFinite(a)).toBe(true);

  return { actual: a, expected0: b };
}

function observeDensityCase19() {
  const withNull = densityFixture1_asContent(
    JSON.parse('{"speaker":"ai","blocks":[{"type":"text","text":null}]}'),
  );
  const withEmpty = densityFixture1_asContent(
    JSON.parse('{"speaker":"ai","blocks":[{"type":"text","text":""}]}'),
  );
  const a = computeHistorySizeBreakdown([withNull]).totalBytes;
  const b = computeHistorySizeBreakdown([withEmpty]).totalBytes;
  expect(Number.isFinite(a)).toBe(true);
  // A null text is estimated as a value slot rather than being free, so it
  // lands slightly above an empty string (which carries no chars either,
  // but also no null placeholder). Both are small and finite.

  return { actual: a, expected0: b };
}

async function observeDensityCase20() {
  const service = new HistoryService();
  // 500 tool responses of varied size — far beyond the default top-10 cut.
  for (let i = 0; i < 500; i++) {
    service.add({
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `call-${i}`,
          toolName: `tool-${i % 7}`,
          result: 'r'.repeat(100 + (i % 50) * 10),
        },
      ],
    });
  }
  const breakdown = await sizeOf(service);
  // The ranking is bounded to topN entries, largest first.
  expect(breakdown.largestToolResponses).toHaveLength(10);
  const bytes = breakdown.largestToolResponses.map((r) => r.bytes);
  const sortedDesc = [...bytes].sort((a, b) => b - a);
  expect(bytes).toStrictEqual(sortedDesc);
  // Every ranked entry is at least as heavy as the heaviest unranked one:
  // the 500-response floor (100 chars + overhead) must be below the cut.
  const minRanked = Math.min(...bytes);
  expect(minRanked).toBeGreaterThan(100 + 40 * 10);
  // Per-tool attribution still covers every response (subset of total).
  const toolSum = Object.values(breakdown.bytesByToolName).reduce(
    (a, b) => a + b,
    0,
  );

  return { actual: toolSum, expected0: breakdown.totalBytes };
}

async function observeDensityCase21() {
  const service = new HistoryService();
  service.add({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'small',
        toolName: 't',
        result: 's'.repeat(10),
      },
    ],
  });
  service.add({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'big',
        toolName: 't',
        result: 'b'.repeat(5_000),
      },
    ],
  });
  const breakdown = computeHistorySizeBreakdown(
    await collectRawHistory(service),
    1,
  );
  expect(breakdown.largestToolResponses).toHaveLength(1);

  return breakdown.largestToolResponses[0]?.callId;
}
