/// <reference lib="esnext.array" />
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { enforceTurnMediaRequestContents } from './turnMediaRequest.js';
import { mediaRequestFixture } from './turn-media-request-test-helpers.js';

describe('turn media cache boundary identity', () => {
  it('preserves the exact boundary through disk curation so matching cache evidence commits', async () => {
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
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: async () => {},
    });
    const attempt = await session.begin(true);
    if (!attempt?.preparedBoundary) throw new Error('Missing boundary');
    try {
      const options = {
        ...mediaRequestFixture(history),
        historyService: history,
        userContents: [],
        promptId: 'cache-boundary',
        semanticMediaPurge: attempt,
        estimateFinalizedPromptTokens: async () => 1,
      };
      const first = await enforceTurnMediaRequestContents(options);
      const retry = await enforceTurnMediaRequestContents(options);
      const boundary = first[0].metadata?.semanticMediaPurgeBoundary;
      if (!boundary) throw new Error('Missing prepared request boundary');
      expect(boundary.boundaryId).toBe(attempt.preparedBoundary.boundaryId);
      expect(retry[0].metadata?.semanticMediaPurgeBoundary?.boundaryId).toBe(
        boundary.boundaryId,
      );
      expect(
        await attempt.complete({
          status: 'success',
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            cache_creation_input_tokens: 1,
          },
          retryHandoff: false,
          cacheWriteEvidence: {
            preparation: 'added',
            boundaryId: boundary.boundaryId,
          },
        }),
      ).toBe(true);
      const committed = await Array.fromAsync(history.streamRawHistory());
      expect(committed[0].blocks).toStrictEqual([
        { type: 'text', text: 'prefix' },
      ]);
    } finally {
      attempt.finalize();
      history.dispose();
    }
  });
});
