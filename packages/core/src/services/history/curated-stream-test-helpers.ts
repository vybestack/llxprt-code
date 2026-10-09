/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import type { IContent } from './IContent.js';

function fixtureBlocks(
  index: number,
  payloadBytes: number,
): IContent['blocks'] {
  switch (index % 12) {
    case 0:
    case 1:
    case 2:
      return [];
    case 3:
      return [{ type: 'text', text: '  ' }];
    case 4:
      return [
        {
          type: 'tool_call',
          id: `c-${index}`,
          name: 'inspect',
          parameters: { index },
        },
      ];
    case 5:
      return [
        {
          type: 'tool_response',
          callId: `c-${index - 1}`,
          toolName: 'inspect',
          result: { index },
          error: 'failed',
        },
      ];
    case 6:
      return [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aGVsbG8=',
          caption: `image-${index}`,
        },
      ];
    case 7:
      return [{ type: 'thinking', thought: 'reason', sourceField: 'thinking' }];
    case 8:
      return [
        {
          type: 'thinking',
          thought: 'reason',
          sourceField: 'thinking',
          signature: 'signed',
        },
      ];
    case 9:
      return [{ type: 'code', code: 'code' }];
    case 10:
      return [{ type: 'tool_call', id: 'invalid', name: '', parameters: {} }];
    default:
      return suffixRow(index, payloadBytes).blocks;
  }
}

export function curatedFixtureRow(index: number, payloadBytes = 0): IContent {
  const nonHumanSpeaker = [1, 5].includes(index % 12) ? 'tool' : 'ai';
  return {
    ...suffixRow(index, payloadBytes),
    speaker: index % 12 === 0 ? 'human' : nonHumanSpeaker,
    blocks: fixtureBlocks(index, payloadBytes),
  };
}

export function fixtureIncluded(index: number): boolean {
  return ![2, 3, 7, 10].includes(index % 12);
}

export async function collectCuratedFixture(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<IContent[]> {
  const collected: IContent[] = [];
  for await (const row of rows) collected.push(row);
  return collected;
}

async function performCuratedExit(
  stream: AsyncGenerator<IContent, void, unknown>,
  exit: 'return' | 'throw' | 'break' | 'consumer-throw',
): Promise<void> {
  if (exit === 'return') {
    await stream.return();
    return;
  }
  if (exit === 'throw') {
    await stream.throw(new Error('iterator failed'));
    return;
  }
  for await (const row of stream) {
    void row;
    if (exit === 'consumer-throw') throw new Error('consumer failed');
    break;
  }
}

export async function consumeCuratedExit(
  stream: AsyncGenerator<IContent, void, unknown>,
  exit: 'return' | 'throw' | 'break' | 'consumer-throw',
): Promise<string | undefined> {
  try {
    await performCuratedExit(stream, exit);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}
