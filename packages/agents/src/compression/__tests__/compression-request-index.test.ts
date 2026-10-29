/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryReaderScope } from '@vybestack/llxprt-code-core/services/history/historyReaderScope.js';
import { compressionRequestIndex } from '../compressionRequestIndex.js';

describe('compression occurrence projection', () => {
  it('keeps the selection lifetime and range rules without source reads', async () => {
    const scope = new HistoryReaderScope('Compression index is closed');
    const index = compressionRequestIndex(2048, [], scope);
    expect(index.count).toBe(2048);
    expect(
      await index.normalizedCount(1, 0, 'call_a', { from: 8, to: 16 }),
    ).toBe(0);
    expect(
      await index.normalizedCount(2, 1, 'call_a', { from: 2048, to: 2048 }),
    ).toBe(0);
    await expect(
      index.normalizedCount(1, 0, 'call_a', { from: -1, to: 16 }),
    ).rejects.toThrow(RangeError);
    await expect(
      index.normalizedCount(1, 0, 'call_a', { from: 0, to: 2049 }),
    ).rejects.toThrow(RangeError);
    await expect(
      index.normalizedCount(1, 0, 'call_a', { from: 0.5, to: 16 }),
    ).rejects.toThrow(RangeError);
    await expect(
      index.normalizedCount(1, 0, 'call_a', { from: 4, to: 2 }),
    ).rejects.toThrow(RangeError);
    await expect(index.normalizedPosition(1, 0, 'call_a', 0)).rejects.toThrow(
      RangeError,
    );
    await scope.close();
    await expect(index.normalizedCount(1, 0, 'call_a')).rejects.toThrow(
      'Compression index is closed',
    );
    await expect(index.normalizedPosition(1, 0, 'call_a', 1)).rejects.toThrow(
      'Compression index is closed',
    );
  });

  it('rejects framing that contradicts the tool-text projection', () => {
    expect(() =>
      compressionRequestIndex(
        4,
        [
          {
            speaker: 'ai',
            blocks: [
              { type: 'tool_call', id: 'call_a', name: 'read', parameters: {} },
            ],
          },
        ],
        new HistoryReaderScope('closed'),
      ),
    ).toThrow('Compression framing must not contain structural tools');
  });
});
