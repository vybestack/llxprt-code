import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mediaRequestFixture } from './turn-media-request-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { enforceTurnMediaRequestContents } from './turnMediaRequest.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

class CursorOnlyHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(this, 'eager media preparation');
  }
}

describe('turn media request cursor preparation', () => {
  it('curates journal rows without an eager facade when no purge is active', async () => {
    const history = new CursorOnlyHistory();
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'journal' }],
    });
    try {
      const rows = await enforceTurnMediaRequestContents({
        ...mediaRequestFixture(history),
        historyService: history,
        userContents: [],
        promptId: 'media-journal',
        semanticMediaPurge: undefined,
        estimateFinalizedPromptTokens: async () => 1,
      });
      expect(rows.map((row) => row.blocks)).toStrictEqual([
        [{ type: 'text', text: 'journal' }],
      ]);
    } finally {
      history.dispose();
    }
  });
});

describe('turn semantic media request preparation', () => {
  it('prepares and retries a semantic purge without eager history curation', async () => {
    const history = new CursorOnlyHistory();
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
    const attempt = await session.begin(false);
    if (!attempt) throw new Error('missing purge');
    try {
      const options = {
        ...mediaRequestFixture(history),
        historyService: history,
        userContents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'pending' }],
          } satisfies IContent,
        ],
        promptId: 'media-cursor',
        semanticMediaPurge: attempt,
        estimateFinalizedPromptTokens: async () => 1,
      };
      const first = await enforceTurnMediaRequestContents(options);
      first[0].blocks = [];
      const retry = await enforceTurnMediaRequestContents(options);
      expect(retry.map((row) => row.blocks)).toStrictEqual([
        [{ type: 'text', text: 'prefix' }],
        [{ type: 'text', text: 'pending' }],
      ]);
    } finally {
      attempt.finalize();
      history.dispose();
    }
  });
});

describe('turn media request cancellation', () => {
  it('rejects an aborted turn before request traversal and estimation', async () => {
    const history = new CursorOnlyHistory();
    const abort = new AbortController();

    abort.abort(new Error('media aborted'));
    let estimates = 0;
    try {
      await expect(
        enforceTurnMediaRequestContents({
          ...mediaRequestFixture(history),
          historyService: history,
          userContents: [],
          promptId: 'media-abort',
          semanticMediaPurge: undefined,
          signal: abort.signal,
          estimateFinalizedPromptTokens: async () => {
            estimates++;
            return 1;
          },
        }),
      ).rejects.toThrow('media aborted');
      expect(estimates).toBe(0);
    } finally {
      history.dispose();
    }
  });
});
