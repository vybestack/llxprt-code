/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it } from 'bun:test';
import { EagerSemanticPurgeOracle } from '../../../core/src/services/history/__tests__/support/semantic-purge-eager-test-helpers.js';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

function fixture(): IContent[] {
  const contents: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'before images' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'YQ==',
          caption: 'first image',
          sourceContentId: 'raw/a',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'reason',
          sourceField: 'reasoning_content',
        },
        {
          type: 'tool_call',
          id: '',
          name: 'read_file',
          parameters: { file_path: '/a' },
        },
        {
          type: 'tool_call',
          id: '',
          name: 'read_file',
          parameters: { file_path: '/b' },
        },
        { type: 'text', text: 'keep calls' },
      ],
      metadata: { responsesStored: true },
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: '',
          toolName: 'read_file',
          result: {
            text: 'keyword image purge must preserve this tool output',
          },
        },
      ],
    },
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'second' },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'Yg==',
          caption: 'second image',
          sourceContentId: 'raw_a',
        },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'Yw==',
          caption: 'third image',
          sourceContentId: 'raw/a',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'after' }],
      metadata: { responsesStored: true },
    },
  ];
  return contents.map((row, index) => ({
    ...row,
    metadata: {
      ...row.metadata,
      id: index === 2 || index === 5 ? 'duplicate' : `row-${index}`,
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 1,
        recordedAt: index + 1,
      },
    },
  }));
}

async function collect(
  source: AsyncIterable<IContent>,
): Promise<readonly IContent[]> {
  const result: IContent[] = [];
  for await (const row of source) result.push(row);
  return result;
}

function requireCandidate(
  value: ReturnType<EagerSemanticPurgeOracle['begin']>,
): NonNullable<ReturnType<EagerSemanticPurgeOracle['begin']>> {
  if (value === undefined) throw new Error('Missing eager candidate');
  return value;
}

async function commitExpected(
  session: SemanticMediaPurgeSession,
  expected: readonly IContent[],
): Promise<void> {
  const attempt = await session.begin(false);
  if (attempt === undefined) throw new Error('Missing native candidate');
  try {
    expect(await collect(attempt.candidateHistory.streamRows())).toStrictEqual(
      expected,
    );
    expect(
      await attempt.complete({
        status: 'success',
        usage: undefined,
        retryHandoff: false,
      }),
    ).toBe(true);
  } finally {
    await attempt.finalize();
  }
}

describe('native semantic purge independent eager policy parity', () => {
  for (const mode of ['remove', 'summary'] satisfies Array<
    'remove' | 'summary'
  >) {
    it(`preserves complete history and token values across repeated ${mode} operations`, async () => {
      const oracleHistory = new HistoryService({});
      const history = new HistoryService({});
      oracleHistory.setTokenizerFactory(exactTokenizer());
      history.setTokenizerFactory(exactTokenizer());
      try {
        await oracleHistory.detachedValues.replace(fixture());
        await history.detachedValues.replace(fixture());
        const oracle = new EagerSemanticPurgeOracle(oracleHistory, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => mode,
          persist: async () => undefined,
        });
        for (let round = 0; round < 3; round++) {
          const expected = oracle.begin({ mode });
          const candidate = requireCandidate(expected);
          const receipt = await operationFileCreates(
            () => commitExpected(session, candidate.candidateHistory),
            true,
          );
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          await oracleHistory.detachedValues.replace(
            candidate.candidateHistory,
          );
          expect(await collect(history.streamRawHistory())).toStrictEqual(
            await collect(oracleHistory.streamRawHistory()),
          );
          expect(history.getTotalTokens()).toBe(oracleHistory.getTotalTokens());
        }
        expect(oracle.begin({ mode })).toBeUndefined();
        const noOp = await operationFileCreates(async () => {
          expect(await session.begin(false)).toBeUndefined();
        }, true);
        expect(noOp).toStrictEqual({ directories: [], files: [] });
      } finally {
        await history.dispose();
        await oracleHistory.dispose();
      }
    });
  }
});
