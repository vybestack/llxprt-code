/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { admitDeferredHistorySource } from './deferredHistorySource.js';

describe('deferred admission row ownership', () => {
  it('preserves cyclic tool payload sanitation without a serialization clone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deferred-payload-'));
    const history = new HistoryService();
    const store = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1 << 24,
    });
    const payload: { self?: unknown } = {};
    payload.self = payload;
    async function* source(): AsyncGenerator<IContent> {
      yield {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'cycle',
            toolName: 'inspect',
            result: payload,
          },
        ],
      };
    }
    try {
      const release = await admitDeferredHistorySource(
        history,
        source(),
        store,
        {},
        'test',
      );
      await release();
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks[0]).toMatchObject({
        result: { self: { _circular: true } },
      });
    } finally {
      await history.dispose();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('writes an admitted row without a second content serialization copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deferred-row-ownership-'));
    const ownership = new RowOwnership();
    const history = new HistoryService({ mutationOwnership: ownership });
    const store = new LocalMediaStore({
      rootDirectory: root,
      quotaBytes: 1 << 24,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    async function* source(): AsyncGenerator<IContent> {
      yield {
        speaker: 'tool',
        blocks: [
          { type: 'text', text: 'x'.repeat(1024 * 1024) },
          {
            type: 'tool_response',
            callId: 'one',
            toolName: 'inspect',
            result: { observedAt: new Date(0) },
          },
          reference,
        ],
        metadata: {
          chronology: { seq: 1, userTurn: 1, step: 0, recordedAt: 0 },
        },
      };
    }
    try {
      const release = await admitDeferredHistorySource(
        history,
        source(),
        store,
        { ownership },
        'test',
      );
      await release();
      expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(2);
      expect(ownership.snapshot().liveRows).toBe(0);
      for await (const row of history.streamRawHistory()) {
        expect(row.blocks[0]).toStrictEqual({
          type: 'text',
          text: 'x'.repeat(1024 * 1024),
        });
        expect(row.blocks[1]).toMatchObject({
          result: { observedAt: '1970-01-01T00:00:00.000Z' },
        });
      }
    } finally {
      await history.dispose();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
