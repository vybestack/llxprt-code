/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: random histories for the emission model. A small id
 * pool (including the empty id), calls and responses in rows of every
 * speaker, unanswered calls, duplicate answers with different completeness,
 * tool media and blockless rows.
 */

import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SeededRandom } from '../../../openai/__tests__/support/chatBodyCorpus.js';

const IDS = ['a', 'b', 'c', '', 'x'];

class Marker {
  private next = 0;
  take(): number {
    this.next += 1;
    return this.next;
  }
}

function drawCall(random: SeededRandom, marker: Marker): ContentBlock {
  return {
    type: 'tool_call',
    id: random.pick(IDS),
    name: random.pick(['n', '']),
    parameters: { m: marker.take() },
  };
}

function drawResponse(random: SeededRandom, marker: Marker): ContentBlock {
  return {
    type: 'tool_response',
    callId: random.pick(IDS),
    toolName: 'n',
    result: `M${marker.take()}`,
    error: random.chance(0.2) ? 'e' : undefined,
    isComplete: random.chance(0.4) ? true : undefined,
  };
}

function drawMedia(marker: Marker): ContentBlock {
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: `D${marker.take()}`,
  };
}

function drawRow(random: SeededRandom, marker: Marker): IContent {
  const text = (prefix: string): ContentBlock => ({
    type: 'text',
    text: `${prefix}${marker.take()}`,
  });
  const call = (): ContentBlock => drawCall(random, marker);
  const response = (): ContentBlock => drawResponse(random, marker);
  switch (random.int(16)) {
    case 0:
    case 1:
      return { speaker: 'human', blocks: [text('h')] };
    case 2:
      return { speaker: 'human', blocks: [text('h'), call()] };
    case 3:
      return { speaker: 'human', blocks: [call(), call()] };
    case 4:
      return { speaker: 'human', blocks: [text('hr'), response()] };
    case 5:
      return { speaker: 'ai', blocks: [text('a')] };
    case 6:
    case 7:
      return { speaker: 'ai', blocks: [call()] };
    case 8:
      return { speaker: 'ai', blocks: [call(), call()] };
    case 9:
      return { speaker: 'ai', blocks: [text('ai+resp'), response()] };
    case 10:
    case 11:
      return { speaker: 'tool', blocks: [response()] };
    case 12:
      return { speaker: 'tool', blocks: [response(), response()] };
    case 13:
      return { speaker: 'tool', blocks: [response(), drawMedia(marker)] };
    case 14:
      return { speaker: 'tool', blocks: [call(), response()] };
    default:
      return {
        speaker: random.pick(['ai', 'human', 'tool'] as const),
        blocks: [],
      };
  }
}

export function emissionHistory(seed: number): IContent[] {
  const random = new SeededRandom(seed * 313 + 1);
  const marker = new Marker();
  const count = 2 + random.int(9);
  return Array.from({ length: count }, () => drawRow(random, marker));
}
