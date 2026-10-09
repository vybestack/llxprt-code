/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import type {
  IContent,
  ContentBlock,
} from '../../packages/core/src/services/history/IContent.js';
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { recomposeFixture } from '../../packages/agents/src/compression/__tests__/provider-curated-recomposition-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
import { writeBodyFile } from '../../packages/test-utils/src/body-evidence-writer.js';

export const logger = new DebugLogger('test:empty-publication');
export function fixtureRow(index: number): IContent {
  const metadata = {
    chronology: { seq: index + 1, userTurn: 1, step: index, recordedAt: 0 },
    cacheAnchor: index === 2,
  };
  switch (index) {
    case 1:
    case 7:
      return { speaker: 'ai', blocks: [], metadata };
    case 2:
    case 6:
      return {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: `call-${index}`,
            name: 'inspect',
            parameters: { index },
          },
        ],
        metadata,
      };
    case 3:
      return {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: 'signed reason',
            signature: 'signature-3',
          },
        ],
        metadata: { ...metadata, responsesStored: true },
      };
    case 4:
    case 8:
      return {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: `call-${index === 4 ? 2 : 6}`,
            toolName: 'inspect',
            result: `large-result-${index}`,
            isComplete: true,
          },
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'audio/wav',
            data: 'aGVsbG8=',
            caption: `audio-${index}`,
          },
        ],
        metadata,
      };
    case 5:
      return {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'audio/wav',
            data: 'aGVsbG8=',
            caption: 'media-only',
          },
        ],
        metadata: { ...metadata, responsesStored: true },
      };
    default:
      return {
        speaker: 'human',
        blocks: [{ type: 'text', text: `human-${index}` }],
        metadata,
      };
  }
}

export function compressionCandidate(): IContent[] {
  return [
    fixtureRow(0),
    fixtureRow(1),
    fixtureRow(2),
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'compressed tail' }],
      metadata: {
        isSummary: true,
        chronology: { seq: 13, userTurn: 1, step: 12, recordedAt: 0 },
      },
    },
    ...Array.from({ length: 7 }, (_, index) => fixtureRow(index + 3)),
  ];
}

function withoutParent(row: IContent): IContent {
  const metadata = { ...row.metadata };
  if (row.speaker === 'ai') delete metadata.responsesStored;
  return { ...row, metadata };
}

export function eagerCompression(): IContent[] {
  return compressionCandidate().flatMap((row, index) => {
    if (row.speaker === 'ai' && row.blocks.length === 0) return [];
    const clean = withoutParent(row);
    const metadata = { ...clean.metadata };
    delete metadata.cacheAnchor;
    if (index === 2) metadata.cacheAnchor = true;
    if (metadata.isSummary === true)
      metadata.chronologyReplaced = { fromSeq: 11, toSeq: 12, itemCount: 2 };
    return [{ ...clean, metadata }];
  });
}

export function estimate(block: ContentBlock): Promise<number> {
  return Promise.resolve(
    block.type === 'tool_response' && block.callId === 'call-6' ? 200 : 100,
  );
}

export function eagerTools(): IContent[] {
  return Array.from({ length: 12 }, (_, index) => fixtureRow(index)).flatMap(
    (row) => {
      if (row.speaker === 'ai' && row.blocks.length === 0) return [];
      const clean = withoutParent(row);
      return [
        {
          ...clean,
          blocks: clean.blocks.map((block) => {
            if (block.type !== 'tool_response') return block;
            const tokens = block.callId === 'call-6' ? 200 : 100;
            return {
              type: 'tool_response',
              callId: block.callId,
              toolName: block.toolName,
              result: `[Tool output truncated \u2014 original output was ~${tokens} tokens which exceeded the remaining context budget. The tool executed successfully. Re-request with a smaller scope if you need this content.]`,
              isComplete: true,
              providerMetadata: {
                contextTruncated: true,
                contextTruncatedOriginalTokens: tokens,
              },
            };
          }),
        },
      ];
    },
  );
}

export function eagerTokens(rows: readonly IContent[]): number {
  return rows.reduce((total, row) => total + row.blocks.length, 0);
}
export async function collect(
  rows: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows) result.push(row);
  return result;
}
export async function compareBodies(
  history: HistoryService,
  expected: IContent[],
  label: string,
): Promise<{ actual: string; expected: string }> {
  const actualRows = await recomposeFixture(history, []);
  const expectedRows = buildProviderContent(
    buildCuratedHistory(logger, expected, false),
    [],
    logger,
  );
  const actual = await captureCuratedBody('anthropic', actualRows, true);
  const expectedBody = await captureCuratedBody(
    'anthropic',
    expectedRows,
    true,
  );
  const output = process.env.EMPTY_PUBLICATION_BODY_OUTPUT;
  if (output !== undefined) {
    await writeBodyFile(join(output, `${label}-actual.json`), actual);
    await writeBodyFile(join(output, `${label}-expected.json`), expectedBody);
  }
  return { actual, expected: expectedBody };
}
export async function saveRows(rows: IContent[], label: string): Promise<void> {
  const output = process.env.EMPTY_PUBLICATION_BODY_OUTPUT;
  if (output !== undefined)
    await writeBodyFile(
      join(output, `${label}-rows.json`),
      JSON.stringify(rows),
    );
}

export function fixtureWithStoredEmptyTail(index: number): IContent {
  const row = fixtureRow(index);
  return index === 11
    ? {
        ...row,
        speaker: 'ai',
        blocks: [],
        metadata: { ...row.metadata, responsesStored: true },
      }
    : row;
}
