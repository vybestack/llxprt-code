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

import { collectRawHistory } from '../../test-utils/collect-raw-history.js';
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { computeHistorySizeBreakdown } from './contentSize.js';
import type { IContent } from './IContent.js';

/**
 * Sizing composes with the existing public `getRawHistory()` rather than
 * adding a method to HistoryService, which is already at its max-lines limit.
 */
async function sizeOf(service: HistoryService, topN?: number) {
  return computeHistorySizeBreakdown(await collectRawHistory(service), topN);
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
  it('reports zero for an empty history', async () => {
    const service = new HistoryService();
    const breakdown = await sizeOf(service);
    expect(breakdown.itemCount).toBe(0);
    expect(breakdown.totalBytes).toBe(0);
  });

  it('attributes retained bytes to the tool that produced them', async () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(40_000)));
    service.add(toolResponseItem('shell', 'c2', 'b'.repeat(10_000)));

    const breakdown = await sizeOf(service);
    expect(breakdown.itemCount).toBe(2);
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(39_000);
    expect(breakdown.bytesByToolName['shell']).toBeGreaterThan(9_000);
    expect(breakdown.bytesByToolName['read_file']).toBeGreaterThan(
      breakdown.bytesByToolName['shell'],
    );
  });

  it('ranks the heaviest tool response first', async () => {
    const service = new HistoryService();
    service.add(toolResponseItem('shell', 'c1', 'a'.repeat(1_000)));
    service.add(toolResponseItem('read_many_files', 'c2', 'b'.repeat(80_000)));
    service.add(toolResponseItem('grep', 'c3', 'c'.repeat(5_000)));

    const [heaviest] = (await sizeOf(service)).largestToolResponses;
    expect(heaviest.toolName).toBe('read_many_files');
    expect(heaviest.bytes).toBeGreaterThan(79_000);
  });

  it('tracks growth as tool output accumulates', async () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(10_000)));
    const first = (await sizeOf(service)).totalBytes;

    service.add(toolResponseItem('read_file', 'c2', 'b'.repeat(10_000)));
    const second = (await sizeOf(service)).totalBytes;

    expect(second - first).toBeGreaterThan(9_000);
  });

  it('drops to zero after clear, so compression is observable as a size drop', async () => {
    const service = new HistoryService();
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(50_000)));
    expect((await sizeOf(service)).totalBytes).toBeGreaterThan(49_000);

    service.clear();

    const afterClear = await sizeOf(service);
    expect(afterClear.itemCount).toBe(0);
    expect(afterClear.totalBytes).toBe(0);
  });

  it('separates text from tool output so the dominant consumer is visible', async () => {
    const service = new HistoryService();
    service.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'q'.repeat(500) }],
    });
    service.add(toolResponseItem('read_file', 'c1', 'a'.repeat(100_000)));

    const breakdown = await sizeOf(service);
    const toolBytes = bytesFor(breakdown, 'tool_response');
    const textBytes = bytesFor(breakdown, 'text');
    expect(toolBytes).toBeGreaterThan(textBytes * 10);
  });
});

function bytesFor(
  breakdown: Awaited<ReturnType<typeof sizeOf>>,
  key: string,
): number {
  return breakdown.bytesByBlockType[key] ?? 0;
}
