/// <reference lib="esnext.array" />
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';

function session(): SemanticMediaPurgeSession {
  const history = new HistoryService();
  history.add({
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'prefix' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
      },
    ],
  });
  return new SemanticMediaPurgeSession({
    history,
    mode: () => 'remove',
    persist: async () => undefined,
  });
}

describe('semantic request row isolation', () => {
  it('gives hooks mutable request rows while preserving the pinned retry snapshot and boundary identity', async () => {
    const attempt = await session().begin(true);
    if (!attempt?.preparedBoundary) throw new Error('Missing cache boundary');
    try {
      const firstSource = streamSemanticPurgeRequest(attempt);
      if (!firstSource) throw new Error('Missing request rows');
      const first = await Array.fromAsync(firstSource);
      first[0].blocks = [{ type: 'text', text: 'hook replaced prefix' }];
      const boundary = first[0].metadata?.semanticMediaPurgeBoundary;
      if (!boundary) throw new Error('Missing request boundary');
      Object.assign(boundary, { blockIndex: 999 });
      const retrySource = streamSemanticPurgeRequest(attempt);
      if (!retrySource) throw new Error('Missing retry');
      const retry = await Array.fromAsync(retrySource);
      expect(retry[0].blocks).toHaveLength(2);
      expect(retry[0].blocks[0]).toStrictEqual({
        type: 'text',
        text: 'prefix',
      });
      expect(retry[0].metadata?.semanticMediaPurgeBoundary?.boundaryId).toBe(
        attempt.preparedBoundary.boundaryId,
      );
      expect(retry[0].metadata?.semanticMediaPurgeBoundary?.blockIndex).toBe(0);
      expect(first[0]).not.toBe(retry[0]);
      attempt.markRetryHandoff();
      expect(
        await attempt.complete({
          status: 'success',
          usage: undefined,
          retryHandoff: false,
        }),
      ).toBe(false);
    } finally {
      attempt.finalize();
    }
  });
  it('does not open an aborted request traversal', async () => {
    const attempt = await session().begin(false);
    if (!attempt) throw new Error('Missing attempt');
    const abort = new AbortController();
    const failure = new Error('aborted request');
    abort.abort(failure);
    try {
      const source = streamSemanticPurgeRequest(attempt, abort.signal);
      if (!source) throw new Error('Missing request rows');
      await expect(Array.fromAsync(source)).rejects.toBe(failure);
    } finally {
      attempt.finalize();
    }
  });
});
