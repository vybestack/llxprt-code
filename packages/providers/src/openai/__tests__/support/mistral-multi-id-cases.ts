/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import type { RowFormatSettings } from '../../../../../core/src/journal/rowFormat.js';
import {
  call,
  response,
} from '../../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { generateDeterministicMistralId } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';

export const multiIdSettings: RowFormatSettings = {
  formatId: 'openai-chat:mistral',
  formatRev: 2,
  model: 'mistral-large-latest',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  chat: { includeInContext: true, toolFormat: 'mistral' },
};
export function multiIdCase(
  size: number,
  dense: boolean,
  groups = 2,
): {
  rows: readonly IContent[];
  tail: readonly IContent[];
  ids: readonly string[];
} {
  const ids = Array.from({ length: groups }, (_, index) =>
    index === 0 ? 'toolu_alpha-1' : `toolu_group-${index}`,
  );
  const blockers = ids.map((id) => generateDeterministicMistralId(id, 0));
  return {
    ids,
    rows: [
      ...blockers.map(
        (id): IContent => ({ speaker: 'human', blocks: [call(id, '')] }),
      ),
      ...Array.from(
        { length: size },
        (_, index): IContent =>
          dense || index < 4
            ? {
                speaker: 'ai',
                blocks: [
                  { type: 'thinking', thought: `reason-${index}` },
                  call(ids[index % groups]),
                  call(''),
                ],
              }
            : {
                speaker: 'human',
                blocks: [{ type: 'text', text: `unaffected-${index}` }],
              },
      ),
      ...ids.map(
        (id): IContent => ({ speaker: 'tool', blocks: [response(id, false)] }),
      ),
    ],
    tail: [
      {
        speaker: 'tool',
        blocks: [
          ...blockers.map((id) => response(id)),
          response('4Q3rUlnAu'),
          ...ids.map((id) => ({
            ...response(id),
            result: `better duplicate winner for ${id} 雪`,
          })),
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          ...ids.map((id) => call(`new-${id}`)),
          call(`new-${ids[0]}`, 'renamed'),
          call('hist_tool_alias'),
          call('call_alias'),
        ],
      },
      {
        speaker: 'tool',
        blocks: [response('hist_tool_alias'), response('call_alias')],
      },
    ],
  };
}
