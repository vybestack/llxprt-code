/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  computeHistorySizeBreakdown,
  estimateBlockBytes,
  estimateBytes,
  estimateContentBytes,
} from './contentSize.js';
import type { ContentBlock, IContent } from './IContent.js';

function aiWith(...blocks: ContentBlock[]): IContent {
  return { speaker: 'ai', blocks };
}

function toolResponse(
  toolName: string,
  callId: string,
  result: unknown,
): ContentBlock {
  return { type: 'tool_response', callId, toolName, result };
}

describe('estimateBytes', () => {
  it('scales with string length', () => {
    const short = estimateBytes('a');
    const long = estimateBytes('a'.repeat(1000));
    expect(long - short).toBe(999);
  });

  it('sums nested structures', () => {
    const flat = estimateBytes({ a: 'x'.repeat(100) });
    const nested = estimateBytes({ a: { b: { c: 'x'.repeat(100) } } });
    expect(nested).toBeGreaterThan(flat);
  });

  it('terminates on a reference cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => estimateBytes(cyclic)).not.toThrow();
    expect(estimateBytes(cyclic)).toBeGreaterThan(0);
  });

  it('counts a shared reference once, matching what the heap retains', () => {
    const shared = { payload: 'x'.repeat(1000) };
    const twice = estimateBytes({ a: shared, b: shared });
    const once = estimateBytes({ a: shared });
    expect(twice - once).toBeLessThan(100);
  });

  it('charges a deeply nested value at the depth cap without recursing forever', () => {
    let deep: Record<string, unknown> = { leaf: 'x'.repeat(1000) };
    for (let i = 0; i < 500; i++) {
      deep = { next: deep };
    }
    expect(() => estimateBytes(deep)).not.toThrow();
  });

  it('uses byteLength for binary payloads', () => {
    const bytes = estimateBytes(new Uint8Array(4096));
    expect(bytes).toBeGreaterThanOrEqual(4096);
  });

  it('does not allocate a serialized copy of the value', () => {
    // A value that would be enormous when stringified but is cheap to walk.
    const shared = { blob: 'x'.repeat(100_000) };
    const wide = Array.from({ length: 1000 }, () => shared);
    const started = performance.now();
    const total = estimateBytes(wide);
    // Cycle/identity tracking means the shared body is counted once.
    expect(total).toBeLessThan(200_000);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('estimateBlockBytes', () => {
  it('sizes a text block by its text', () => {
    const bytes = estimateBlockBytes({ type: 'text', text: 'y'.repeat(500) });
    expect(bytes).toBeGreaterThanOrEqual(500);
  });

  it('sizes a media block by its payload', () => {
    const bytes = estimateBlockBytes({
      type: 'media',
      mimeType: 'image/png',
      data: 'A'.repeat(10_000),
      encoding: 'base64',
    });
    expect(bytes).toBeGreaterThanOrEqual(10_000);
  });

  it('sizes a tool response by its result payload', () => {
    const small = estimateBlockBytes(toolResponse('read_file', '1', 'tiny'));
    const large = estimateBlockBytes(
      toolResponse('read_file', '2', { content: 'z'.repeat(50_000) }),
    );
    expect(large - small).toBeGreaterThan(49_000);
  });

  it('includes thinking signatures and encrypted content', () => {
    const bare = estimateBlockBytes({ type: 'thinking', thought: 'abc' });
    const withExtras = estimateBlockBytes({
      type: 'thinking',
      thought: 'abc',
      signature: 's'.repeat(200),
      encryptedContent: 'e'.repeat(300),
    });
    expect(withExtras - bare).toBe(500);
  });

  it('includes provider metadata', () => {
    const bare = estimateBlockBytes({ type: 'text', text: 'abc' });
    const withMeta = estimateBlockBytes({
      type: 'text',
      text: 'abc',
      providerMetadata: { note: 'm'.repeat(400) },
    });
    expect(withMeta - bare).toBeGreaterThanOrEqual(400);
  });
});

describe('estimateContentBytes', () => {
  it('sums every block in the item', () => {
    const content = aiWith(
      { type: 'text', text: 'a'.repeat(100) },
      { type: 'text', text: 'b'.repeat(200) },
    );
    expect(estimateContentBytes(content)).toBeGreaterThanOrEqual(300);
  });
});

describe('computeHistorySizeBreakdown', () => {
  const history: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'q'.repeat(100) }] },
    aiWith({
      type: 'tool_call',
      id: 'c1',
      name: 'read_file',
      parameters: { path: '/tmp/a.ts' },
    }),
    {
      speaker: 'tool',
      blocks: [toolResponse('read_file', 'c1', 'x'.repeat(50_000))],
    },
    {
      speaker: 'tool',
      blocks: [toolResponse('shell', 'c2', 'y'.repeat(10_000))],
    },
    {
      speaker: 'tool',
      blocks: [toolResponse('read_file', 'c3', 'z'.repeat(20_000))],
    },
  ];

  it('reports item count and a positive total', () => {
    const breakdown = computeHistorySizeBreakdown(history);
    expect(breakdown.itemCount).toBe(5);
    expect(breakdown.totalBytes).toBeGreaterThan(80_000);
  });

  it('attributes the bulk to tool_response blocks', () => {
    const breakdown = computeHistorySizeBreakdown(history);
    const toolBytes = breakdown.bytesByBlockType['tool_response'] ?? 0;
    expect(toolBytes / breakdown.totalBytes).toBeGreaterThan(0.9);
  });

  it('aggregates bytes per tool name', () => {
    const breakdown = computeHistorySizeBreakdown(history);
    // read_file holds 50k + 20k; shell holds 10k.
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(
      breakdown.bytesByToolName['shell'],
    );
  });

  it('ranks the largest individual tool responses with a locatable index', () => {
    const breakdown = computeHistorySizeBreakdown(history);
    const [biggest] = breakdown.largestToolResponses;
    expect(biggest.toolName).toBe('read_file');
    expect(biggest.callId).toBe('c1');
    expect(biggest.historyIndex).toBe(2);
    expect(history[biggest.historyIndex].blocks[0].type).toBe('tool_response');
  });

  it('honours the topN cap', () => {
    const breakdown = computeHistorySizeBreakdown(history, 2);
    expect(breakdown.largestToolResponses).toHaveLength(2);
  });

  it('counts blocks alongside bytes so size can be read against volume', () => {
    const breakdown = computeHistorySizeBreakdown(history);
    expect(breakdown.countsByBlockType['tool_response']).toBe(3);
    expect(breakdown.countsByBlockType['tool_call']).toBe(1);
  });

  it('handles an empty history', () => {
    const breakdown = computeHistorySizeBreakdown([]);
    expect(breakdown.itemCount).toBe(0);
    expect(breakdown.totalBytes).toBe(0);
    expect(breakdown.largestToolResponses).toHaveLength(0);
  });
});
