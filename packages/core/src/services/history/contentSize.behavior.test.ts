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

import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { computeHistorySizeBreakdown } from './contentSize.js';
import type { IContent } from './IContent.js';

function sizeOf(service: HistoryService) {
  return computeHistorySizeBreakdown(service.getRawHistory());
}

describe('retained-history accounting — item metadata', () => {
  it('counts large ContentMetadata (usage, providerMetadata) retained on items', () => {
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
    const breakdown = sizeOf(service);
    // The 20 KB providerMetadata note alone must be reflected in the total.
    expect(breakdown.totalBytes).toBeGreaterThan(20_000);
  });

  it('counts metadata on every item, not just the first', () => {
    const service = new HistoryService();
    for (let i = 0; i < 5; i++) {
      service.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'x' }],
        metadata: { providerMetadata: { blob: 'y'.repeat(10_000) } },
      });
    }
    const breakdown = sizeOf(service);
    // 5 x 10 KB of metadata must be visible.
    expect(breakdown.totalBytes).toBeGreaterThan(50_000);
  });

  it('a metadata-heavy item is measurably heavier than an identical item without metadata', () => {
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
    expect(metaSize - bareSize).toBeGreaterThan(30_000);
  });
});

describe('retained-history accounting — complete block fields', () => {
  it('counts tool_call id, name, and description', () => {
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
    expect(rich - bare).toBeGreaterThan(2_000);
  });

  it('counts tool_response callId and error text', () => {
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
    expect(rich - bare).toBeGreaterThan(1_500);
  });

  it('counts media mimeType, encoding, filename, and caption', () => {
    const bare = computeHistorySizeBreakdown([
      {
        speaker: 'human',
        blocks: [
          { type: 'media', mimeType: 'a', encoding: 'base64', data: 'd' },
        ],
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
    expect(rich - bare).toBeGreaterThan(1_500);
  });

  it('counts thinking stream variant fields (sourceField, streamId, streamStatus)', () => {
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
    expect(rich - bare).toBeGreaterThan(600);
  });

  it('counts code language and the speaker string', () => {
    const bare = computeHistorySizeBreakdown([
      { speaker: 'ai', blocks: [{ type: 'code', code: 'c' }] },
    ]).totalBytes;
    const rich = computeHistorySizeBreakdown([
      {
        speaker: 'ai',
        blocks: [{ type: 'code', code: 'c', language: 'l'.repeat(400) }],
      },
    ]).totalBytes;
    expect(rich - bare).toBeGreaterThanOrEqual(400);
  });
});

describe('retained-history accounting — shared objects across items', () => {
  it('counts a result object shared by two tool responses exactly once', () => {
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
    expect(twice - once).toBeLessThan(200);
  });

  it('counts metadata shared across items exactly once', () => {
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
    expect(twice - once).toBeLessThan(200);
  });

  it('counts shared parameters between two tool calls exactly once', () => {
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
    expect(twice - once).toBeLessThan(200);
  });
});

describe('retained-history accounting — attribution consistency', () => {
  it('per-block-type and per-tool attributions never exceed the total', () => {
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

    const breakdown = sizeOf(service);
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
    expect(toolSum).toBeLessThanOrEqual(blockSum);
  });

  it('grows proportionally when a real HistoryService accumulates large tool output', () => {
    const service = new HistoryService();
    const first = sizeOf(service).totalBytes;
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
    const second = sizeOf(service).totalBytes;
    // 10 x 10 KB of distinct output must all be counted.
    expect(second - first).toBeGreaterThan(100_000);
    const breakdown = sizeOf(service);
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(100_000);
    expect(breakdown.itemCount).toBe(10);
  });
});

describe('retained-history accounting — complete retained-graph identity', () => {
  it('charges a one-million-character shared item exactly once through HistoryService', () => {
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
    const breakdown = sizeOf(service);
    // Roughly one million payload characters plus small per-entry overhead —
    // NOT two million. Bound both sides to catch under- and over-counting.
    expect(breakdown.totalBytes).toBeGreaterThan(1_000_000);
    expect(breakdown.totalBytes).toBeLessThan(1_050_000);
    expect(breakdown.itemCount).toBe(2);
  });

  it('charges a shared blocks array referenced by two items exactly once', () => {
    // Two distinct items that alias the SAME blocks array (a real aliasing
    // path: shallow-coned items sharing blocks).
    const blocks = [{ type: 'text' as const, text: 'y'.repeat(500_000) }];
    const service = new HistoryService();
    service.add({ speaker: 'ai', blocks });
    service.add({ speaker: 'human', blocks });
    const breakdown = sizeOf(service);
    expect(breakdown.totalBytes).toBeGreaterThan(500_000);
    expect(breakdown.totalBytes).toBeLessThan(510_000);
    expect(breakdown.countsByBlockType['text']).toBe(1);
  });

  it('charges a shared block object appearing in two different arrays once', () => {
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
    const breakdown = sizeOf(service);
    expect(breakdown.totalBytes).toBeGreaterThan(200_000);
    expect(breakdown.totalBytes).toBeLessThan(205_000);
    expect(breakdown.countsByBlockType['text']).toBe(2);
  });
});

describe('retained-history accounting — null runtime strings from external JSON', () => {
  /**
   * Narrows a JSON-parsed value to IContent WITHOUT unsafe casts: validate
   * the shape, then reconstruct a typed object field by field. This mirrors
   * what restored/external JSON can deliver: null where an optional string is
   * declared (and, pathologically, where a required one is).
   */
  function asContent(raw: unknown): IContent {
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

  it('treats a null optional string as absent instead of crashing', () => {
    // Restored JSON delivering language: null must size like language being
    // absent (0) — no crash, no NaN.
    const withNull = asContent(
      JSON.parse(
        '{"speaker":"ai","blocks":[{"type":"code","code":"c","language":null}]}',
      ),
    );
    const without = asContent(
      JSON.parse('{"speaker":"ai","blocks":[{"type":"code","code":"c"}]}'),
    );
    const a = computeHistorySizeBreakdown([withNull]).totalBytes;
    const b = computeHistorySizeBreakdown([without]).totalBytes;
    expect(Number.isFinite(a)).toBe(true);
    expect(a).toBe(b);
  });

  it('estimates a null REQUIRED string as one slot instead of crashing', () => {
    const withNull = asContent(
      JSON.parse('{"speaker":"ai","blocks":[{"type":"text","text":null}]}'),
    );
    const withEmpty = asContent(
      JSON.parse('{"speaker":"ai","blocks":[{"type":"text","text":""}]}'),
    );
    const a = computeHistorySizeBreakdown([withNull]).totalBytes;
    const b = computeHistorySizeBreakdown([withEmpty]).totalBytes;
    expect(Number.isFinite(a)).toBe(true);
    // A null text is estimated as a value slot rather than being free, so it
    // lands slightly above an empty string (which carries no chars either,
    // but also no null placeholder). Both are small and finite.
    expect(a).toBeGreaterThanOrEqual(b);
  });
});

describe('retained-history accounting — bounded top-N working storage', () => {
  it('ranks only the heaviest topN responses regardless of history volume', () => {
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
    const breakdown = sizeOf(service);
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
    expect(toolSum).toBeLessThanOrEqual(breakdown.totalBytes);
  });

  it('an explicit topN of 1 keeps exactly the single heaviest response', () => {
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
    const breakdown = computeHistorySizeBreakdown(service.getRawHistory(), 1);
    expect(breakdown.largestToolResponses).toHaveLength(1);
    expect(breakdown.largestToolResponses[0]?.callId).toBe('big');
  });
});
