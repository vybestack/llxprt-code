/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { suffixRow } from './history-suffix-test-helpers.js';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';

export function accountingRow(index: number, payloadBytes = 2048): IContent {
  const speakers: Array<IContent['speaker']> = ['human', 'ai', 'tool'];
  return {
    ...suffixRow(index),
    speaker: speakers[index % 3],
    blocks: [
      { type: 'text', text: `row:${index}:${'x'.repeat(payloadBytes)}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
        caption: `audio:${index}`,
      },
      {
        type: 'tool_call',
        id: `call:${index}`,
        name: 'inspect',
        parameters: { index },
      },
      {
        type: 'tool_response',
        callId: `call:${index}`,
        toolName: 'inspect',
        result: { body: `result:${index}` },
        ...(index % 2 === 0 ? { error: 'failed' } : {}),
      },
    ],
    metadata: {
      ...suffixRow(index).metadata,
      model: index % 2 === 0 ? 'historical-a' : 'historical-b',
    },
  };
}

export function accountingTexts(index: number, payloadBytes = 2048): string[] {
  return [
    `row:${index}:${'x'.repeat(payloadBytes)}`,
    `audio:${index}`,
    JSON.stringify({ name: 'inspect', parameters: { index } }),
    `${index % 2 === 0 ? 'failed\n' : ''}${JSON.stringify({ body: `result:${index}` })}`,
  ];
}

export function accountingFactory(
  count: (text: string, model: string | undefined) => number | Promise<number>,
): RuntimeTokenizerFactory {
  return {
    getTokenizer: (_provider, model) => ({
      fallbackPolicy: 'deny',
      countTokens: (text: unknown): number | Promise<number> => {
        if (typeof text !== 'string')
          throw new Error('Expected tokenizer text');
        return count(text, model);
      },
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'exact',
      family: 'stream-accounting-test',
      estimatorVersion: '1',
      assetRevision: '1',
      projectionRevision: request.projectionRevision,
    }),
  };
}

export function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolvePromise = (): void => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export function recalculate(
  service: HistoryService,
  method: 'total' | 'legacy',
  signal?: AbortSignal,
): Promise<void> {
  return method === 'total'
    ? service.recalculateTotalTokens('active', 'test', signal)
    : service.recalculateTokens('active', signal);
}
