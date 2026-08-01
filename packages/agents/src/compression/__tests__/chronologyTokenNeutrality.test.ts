/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryService as RealHistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { estimatePendingTokens } from '../compressionBudgeting.js';
import { findCompressSplitPoint } from '../../core/clientHelpers.js';

/**
 * Chronology markers (#1721) are client-side only and are never sent to a
 * provider. Token accounting must therefore be blind to them, otherwise every
 * history item silently costs phantom tokens and compression fires early.
 */

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function ai(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function aiToolCall(id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name: 'read_file', parameters: {} }],
  };
}

function toolResponse(callId: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'tool_response', callId, toolName: 'read_file', result: 'ok' },
    ],
  };
}

function withChronology(content: IContent, seq: number): IContent {
  return {
    ...content,
    metadata: {
      ...content.metadata,
      chronology: {
        seq,
        userTurn: Math.ceil(seq / 2),
        step: seq % 2 === 0 ? 2 : 1,
        recordedAt: 1_759_000_000_000 + seq,
      },
    },
  };
}

function stampAll(history: IContent[]): IContent[] {
  return history.map((content, index) => withChronology(content, index + 1));
}

const conversation: IContent[] = [
  human('first question about the repository layout'),
  ai('here is a fairly long answer describing the layout in detail'),
  aiToolCall('call-1'),
  toolResponse('call-1'),
  human('a follow up question'),
  ai('another answer'),
  aiToolCall('call-2'),
  toolResponse('call-2'),
  human('a third question'),
  ai('a third answer'),
];

/**
 * A HistoryService whose tokenizer path is unavailable, which is the documented
 * trigger for estimatePendingTokens' local fallback estimator. Only the
 * collaborator is substituted; the fallback estimator under test is real.
 */
function historyServiceWithUnavailableTokenizer(): HistoryService {
  const service = new RealHistoryService();
  service.estimateTokensForContents = () =>
    Promise.reject(new Error('tokenizer unavailable'));
  return service;
}

describe('estimatePendingTokens chronology neutrality', () => {
  /** AC23 — tokenizer path */
  it('returns the same estimate with and without chronology markers', async () => {
    const service = new RealHistoryService();

    const withMarkers = await estimatePendingTokens(
      stampAll(conversation),
      service,
      'gpt-4.1',
    );
    const withoutMarkers = await estimatePendingTokens(
      conversation,
      service,
      'gpt-4.1',
    );

    expect(withMarkers).toBe(withoutMarkers);
  });

  /** AC23 — local fallback estimator */
  it('returns the same fallback estimate with and without chronology markers', async () => {
    const withMarkers = await estimatePendingTokens(
      stampAll(conversation),
      historyServiceWithUnavailableTokenizer(),
      'gpt-4.1',
    );
    const withoutMarkers = await estimatePendingTokens(
      conversation,
      historyServiceWithUnavailableTokenizer(),
      'gpt-4.1',
    );

    expect(withMarkers).toBe(withoutMarkers);
  });

  it('still reflects real content growth in the fallback estimate', async () => {
    const short = await estimatePendingTokens(
      [ai('short')],
      historyServiceWithUnavailableTokenizer(),
      'gpt-4.1',
    );
    const long = await estimatePendingTokens(
      [ai('a substantially longer assistant response than the other one')],
      historyServiceWithUnavailableTokenizer(),
      'gpt-4.1',
    );

    expect(long).toBeGreaterThan(short);
  });
});

describe('findCompressSplitPoint chronology neutrality', () => {
  /** AC24 */
  it('returns the same split index with and without chronology markers', () => {
    expect(findCompressSplitPoint(stampAll(conversation), 0.5)).toBe(
      findCompressSplitPoint(conversation, 0.5),
    );
  });

  it('returns the same split index at a low fraction', () => {
    expect(findCompressSplitPoint(stampAll(conversation), 0.2)).toBe(
      findCompressSplitPoint(conversation, 0.2),
    );
  });

  it('returns the same split index at a high fraction', () => {
    expect(findCompressSplitPoint(stampAll(conversation), 0.8)).toBe(
      findCompressSplitPoint(conversation, 0.8),
    );
  });
});
