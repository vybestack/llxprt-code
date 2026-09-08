/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Byte accounting through the real HistoryService, not the pure helper.
 *
 * The point of these is that `getSizeBreakdown()` reflects what the service is
 * actually retaining right now — including after a clear, which is the
 * operation compression relies on.
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { computeHistorySizeBreakdown } from './contentSize.js';
import type { IContent } from './IContent.js';

/**
 * Sizing composes with the existing public `getRawHistory()` rather than
 * adding a method to HistoryService, which is already at its max-lines limit.
 */
function sizeOf(service: HistoryService, topN?: number) {
  return computeHistorySizeBreakdown(service.getRawHistory(), topN);
}

function toolResponseItem(
  toolName: string,
  callId: string,
  body: string,
): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName, result: { body } }],
  };
}

describe('history size breakdown via HistoryService.getRawHistory', () => {
  it('reports zero for an empty history', () => {
    const service = new HistoryService();
    const breakdown = sizeOf(service);
    expect(breakdown.itemCount).toBe(0);
    expect(breakdown.totalBytes).toBe(0);
  });

  it('attributes retained bytes to the tool that produced them', () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(40_000)));
    service.add(toolResponseItem('shell', 'c2', 'b'.repeat(10_000)));

    const breakdown = sizeOf(service);
    expect(breakdown.itemCount).toBe(2);
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(39_000);
    expect(breakdown.bytesByToolName['shell']).toBeGreaterThan(9_000);
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(
      breakdown.bytesByToolName['shell'],
    );
  });

  it('ranks the heaviest tool response first', () => {
    const service = new HistoryService();
    service.add(toolResponseItem('shell', 'c1', 'a'.repeat(1_000)));
    service.add(toolResponseItem('read_many_files', 'c2', 'b'.repeat(80_000)));
    service.add(toolResponseItem('grep', 'c3', 'c'.repeat(5_000)));

    const [heaviest] = sizeOf(service).largestToolResponses;
    expect(heaviest.toolName).toBe('read_many_files');
    expect(heaviest.bytes).toBeGreaterThan(79_000);
  });

  it('tracks growth as tool output accumulates', () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(10_000)));
    const first = sizeOf(service).totalBytes;

    service.add(toolResponseItem('read_file', 'c2', 'b'.repeat(10_000)));
    const second = sizeOf(service).totalBytes;

    expect(second - first).toBeGreaterThan(9_000);
  });

  it('drops to zero after clear, so compression is observable as a size drop', () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(50_000)));
    expect(sizeOf(service).totalBytes).toBeGreaterThan(49_000);

    service.clear();

    const afterClear = sizeOf(service);
    expect(afterClear.itemCount).toBe(0);
    expect(afterClear.totalBytes).toBe(0);
  });

  it('separates text from tool output so the dominant consumer is visible', () => {
    const service = new HistoryService();
    service.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'q'.repeat(500) }],
    });
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(100_000)));

    const breakdown = sizeOf(service);
    const toolBytes = bytesFor(breakdown, 'tool_response');
    const textBytes = bytesFor(breakdown, 'text');
    expect(toolBytes).toBeGreaterThan(textBytes * 10);
  });
});

function bytesFor(breakdown: ReturnType<typeof sizeOf>, key: string): number {
  return breakdown.bytesByBlockType[key] ?? 0;
}
