/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { pngOf } from './wireBuilderCorpus.js';
import type { ScaleScenario } from './messageTableHistories.js';

const boundaryId = Object.freeze({});

function human(text: string, metadata: IContent['metadata'] = {}): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }], metadata };
}
function ai(...blocks: ContentBlock[]): IContent {
  return { speaker: 'ai', blocks };
}
function call(id: string): ContentBlock {
  return { type: 'tool_call', id, name: 'tool', parameters: { id } };
}
function answer(id: string): ContentBlock {
  return { type: 'tool_response', callId: id, toolName: 'tool', result: id };
}
function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * Histories for the passes after the table passes: merged messages, empty
 * messages, the anchor and tail decisions, and the whole-history scans of the
 * media purge boundary. Run with prompt caching, a system prefix and the
 * purge mode on.
 */
export const FINISH_SCENARIOS: readonly ScaleScenario[] = [
  {
    name: 'a run of user messages merged into one',
    stressed: 'block ordering of one message with a block per row',
    build: (units) => [
      ...range(units).map((index) => human(`part ${index}`)),
      ai({ type: 'text', text: 'done' }),
    ],
  },
  {
    name: 'blank rows between real ones',
    stressed: 'placeholder and empty-text passes: one edit per message',
    build: (units) =>
      range(units).flatMap((index) => [
        human(index % 2 === 0 ? '   ' : `question ${index}`),
        ai({ type: 'text', text: index % 3 === 0 ? '' : `reply ${index}` }),
      ]),
  },
  {
    name: 'anchored tool rows in a long conversation',
    stressed: 'anchor flush per run of tool rows and the anchor scan',
    build: (units) =>
      range(units).flatMap((index) => [
        human(`question ${index}`),
        ai(call(`anchored_${index}`)),
        {
          ...{
            speaker: 'tool' as const,
            blocks: [answer(`anchored_${index}`)],
          },
          metadata: { cacheAnchor: true },
        },
      ]),
  },
  {
    name: 'an image at the end of a long conversation',
    stressed:
      'purge boundary scan, breakpoint count and walk back from the image',
    build: (units) => [
      ...range(units).flatMap((index) => [
        human(`question ${index}`, index === 0 ? { cacheAnchor: true } : {}),
        ai({ type: 'text', text: `reply ${index}` }),
      ]),
      {
        speaker: 'human' as const,
        blocks: [
          { type: 'text' as const, text: 'look' },
          {
            type: 'media' as const,
            mimeType: 'image/png',
            encoding: 'base64' as const,
            data: pngOf(10, 10),
          },
        ],
        metadata: { semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId } },
      },
    ],
  },
  {
    name: 'an image behind a message of thinking blocks',
    stressed:
      'purge walk back across the blocks that cannot hold a breakpoint, into the message before',
    build: (units) => [
      ...range(units).flatMap((index) => [
        human(`question ${index}`),
        ai({ type: 'text', text: `reply ${index}` }),
      ]),
      human('go'),
      ...range(units).map((index) =>
        ai({
          type: 'thinking',
          thought: `thought ${index}`,
          sourceField: 'thinking',
          signature: `sig ${index}`,
        }),
      ),
      {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'media' as const,
            mimeType: 'image/png',
            encoding: 'base64' as const,
            data: pngOf(10, 10),
          },
        ],
        metadata: { semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId } },
      },
    ],
  },
  {
    name: 'parallel calls with the results displaced behind other messages',
    stressed: 'tail breakpoint on one message with a block per call',
    build: (units) => [
      human('go'),
      ai(...range(units).map((index) => call(`wide_${index}`))),
      human('interrupt'),
      {
        speaker: 'tool',
        blocks: range(units).map((index) => answer(`wide_${index}`)),
      },
    ],
  },
];
