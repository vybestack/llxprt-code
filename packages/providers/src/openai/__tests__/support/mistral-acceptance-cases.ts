/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import {
  call,
  response,
  type UnitCase,
} from '../../../../../core/src/services/history/__tests__/support/normalization-cases.js';
type Scenario = Pick<UnitCase, 'rows' | 'tail'>;
interface Parts {
  readonly ai: IContent;
  readonly tool: IContent;
  readonly holder: IContent;
  readonly id: string;
}

function firstScenarios({ ai, tool, holder, id }: Parts): readonly Scenario[] {
  return [
    {
      rows: [ai, ai, ai],
      tail: [
        {
          speaker: 'tool',
          blocks: [response(id === '' ? '4Q3rUlnAu' : '4SftZvDMX')],
        },
      ],
    },
    {
      rows: [
        { speaker: 'human', blocks: [call('4SftZvDMX', '')] },
        ai,
        tool,
        ai,
      ],
      tail: [{ speaker: 'tool', blocks: [response('4SftZvDMX')] }],
    },
    {
      rows: [tool, ai, tool],
      tail: [
        { speaker: 'human', blocks: [call('4Uq1sY29c', '')] },
        { speaker: 'ai', blocks: [call('4SftZvDMX'), call(id)] },
      ],
    },
    {
      rows: [holder, ai, { ...tool, blocks: [response(id, false)] }, tool, ai],
      tail: [
        {
          ...tool,
          blocks: [{ ...response(id), result: 'best duplicate result 雪' }],
        },
      ],
    },
  ];
}
function laterScenarios({ ai, tool, holder, id }: Parts): readonly Scenario[] {
  return [
    {
      rows: [
        ai,
        { speaker: 'tool', blocks: [response(id), call('4SftZvDMX')] },
        ai,
      ],
      tail: [tool],
    },
    {
      rows: [
        ai,
        ai,
        { speaker: 'human', blocks: [{ type: 'text', text: 'separator' }] },
      ],
      tail: [{ speaker: 'tool', blocks: [response(id)] }, holder],
    },
    {
      rows: [holder, ai, tool],
      tail: [
        { speaker: 'ai', blocks: [call('4Uq1sY29c'), call(id, 'renamed')] },
      ],
    },
    {
      rows: [ai, tool],
      tail: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'pending user' }] },
        { speaker: 'tool', blocks: [response('4Q3rUlnAu')] },
      ],
    },
  ];
}
export function mistralAcceptanceCase(seed: number): UnitCase {
  const id = ['', 'toolu_alpha-1', '4SftZvDMX', '4Uq1sY29c'][seed % 4];
  const ai: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'thinking', thought: `reason ${seed}` }, call(id)],
  };
  const tool: IContent = {
    speaker: 'tool',
    blocks: [
      response(id),
      ...(seed % 2 === 0
        ? [
            {
              type: 'media' as const,
              mimeType: 'image/png',
              encoding: 'base64' as const,
              data: 'YWJj',
            },
          ]
        : []),
    ],
  };
  const holder: IContent = { speaker: 'ai', blocks: [call('4SftZvDMX')] };
  const parts = { ai, tool, holder, id };
  const modes = [...firstScenarios(parts), ...laterScenarios(parts)];
  return {
    id: `mistral-domain-${seed}`,
    ...modes[Math.floor(seed / 4) % modes.length],
  };
}
export function mistralAcceptanceCases(): readonly UnitCase[] {
  return Array.from({ length: 32 }, (_, seed) => mistralAcceptanceCase(seed));
}
