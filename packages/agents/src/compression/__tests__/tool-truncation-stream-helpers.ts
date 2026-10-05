/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChainForRetainedRewrite } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createTruncationStub,
  type ToolResultTruncatorDeps,
} from '../toolResultTruncator.js';

export class BoundedToolHistory extends HistoryService {
  override replaceToolResponseBlock(): Promise<boolean> {
    throw new Error('eager tool replacement is forbidden');
  }
}

export function toolRankingRow(index: number, bytes = 2048): IContent {
  return {
    speaker: index % 2 === 0 ? 'ai' : 'tool',
    blocks: [
      { type: 'text', text: `nested:${index}` },
      {
        type: 'tool_call',
        id: `duplicate-${index % 3}`,
        name: 'read_file',
        parameters: { path: `${index}.ts` },
      },
      {
        type: 'tool_response',
        callId: `duplicate-${index % 3}`,
        toolName: 'read_file',
        result: { index, payload: 'x'.repeat(bytes) },
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
      },
    ],
    metadata: {
      chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
      id: `stored-${index}`,
      responsesStored: true,
      cacheAnchor: index === 0,
    },
  };
}

export function toolScore(block: ContentBlock): Promise<number> {
  return Promise.resolve(block.type === 'tool_response' ? 100 : 1);
}

export function toolDeps(
  history: HistoryService,
  projected: () => Promise<number>,
): ToolResultTruncatorDeps {
  return {
    historyService: history,
    logger: new DebugLogger('test:tool-stream'),
    estimateBlockTokensAsync: toolScore,
    computeProjected: projected,
    resetBaseline: () => {},
    getRuntimeModel: () => 'test',
  };
}

export async function digestRows(
  rows: AsyncIterable<IContent>,
): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

export function expectedToolDigest(size: number, replaced: number): string {
  const hash = createHash('sha256');
  for (let index = 0; index < size; index++) {
    const original = toolRankingRow(index);
    const target = original.blocks[2];
    if (target.type !== 'tool_response') throw new Error('Invalid fixture');
    const row =
      index >= size - replaced
        ? {
            ...original,
            blocks: original.blocks.map((block, blockIndex) =>
              blockIndex === 2 ? createTruncationStub(target, 100) : block,
            ),
          }
        : original;
    const invalidatesStoredPrefix = replaced > 1;
    const [expected] = invalidatesStoredPrefix
      ? invalidateResponsesStatefulChainForRetainedRewrite([row], 0)
      : [row];
    hash.update(JSON.stringify(expected) + '\n');
  }
  return hash.digest('hex');
}
