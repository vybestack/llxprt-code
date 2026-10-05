/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DebugLogger } from '../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../packages/core/src/services/history/historyProviderPipeline.js';
import { enforceTurnMediaRequestContents } from '../../packages/agents/src/core/turnMediaRequest.js';
import { mediaRequestFixture } from '../../packages/agents/src/core/turn-media-request-test-helpers.js';
import { captureCuratedBody } from './provider-curated-body-helpers.js';
const logger = new DebugLogger('test:semantic-purge-body-oracle');
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { withSuffixFixture } from '../../packages/core/src/services/history/history-suffix-test-helpers.js';
import { EagerSemanticPurgeOracle } from '../../packages/core/src/services/history/semantic-purge-eager-test-oracle.js';
import { SemanticMediaPurgeSession } from '../../packages/agents/src/core/semanticMediaPurgeSession.js';

function row(index: number, bytes: number): IContent {
  const text = {
    type: 'text',
    text: `row-${index}:${'x'.repeat(bytes)}`,
  } as const;
  const group = Math.floor(index / 3);
  const id = `call-${group}`;
  if (index % 3 === 0)
    return {
      speaker: 'human',
      blocks: [
        text,
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
        },
      ],
    };
  if (index % 3 === 1)
    return {
      speaker: 'ai',
      blocks: [
        text,
        { type: 'tool_call', id, name: 'inspect', parameters: { group } },
      ],
    };
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: id,
        toolName: 'inspect',
        result: { group, text: text.text },
      },
    ],
  };
}
function saveBodies(
  provider: string,
  size: number,
  explicit: boolean,
  actual: string,
  expected: string,
): void {
  const output = process.env.SEMANTIC_PURGE_BODY_OUTPUT;
  if (!output) return;
  writeFileSync(
    join(output, `production-${provider}-${size}-${explicit}-actual.json`),
    actual,
  );
  writeFileSync(
    join(output, `production-${provider}-${size}-${explicit}-expected.json`),
    expected,
  );
}

async function expectedBody(
  size: number,
  explicit: boolean,
  provider: string,
  caching: boolean,
): Promise<string> {
  const eager = new HistoryService();
  try {
    for (let index = 0; index < size; index++) eager.add(row(index, 2048));
    const transaction = new EagerSemanticPurgeOracle(eager, {
      enabled: true,
      explicitCacheWriteRequired: false,
    }).begin({ mode: 'remove' });
    if (!transaction) throw new Error('Missing eager oracle');
    const oracle = explicit
      ? transaction.baseHistory.map((content, index) =>
          index === transaction.preImageBoundary?.contentIndex
            ? {
                ...content,
                metadata: {
                  ...content.metadata,
                  semanticMediaPurgeBoundary: {
                    blockIndex: transaction.preImageBoundary.blockIndex,
                    boundaryId: transaction.preImageBoundaryIdentity,
                  },
                },
              }
            : content,
        )
      : transaction.candidateHistory;
    return await captureCuratedBody(
      provider,
      buildProviderContent(
        buildCuratedHistory(logger, oracle, false),
        [],
        logger,
      ),
      caching,
    );
  } finally {
    eager.dispose();
  }
}

async function verify(
  size: number,
  explicit: boolean,
  provider: string,
  caching: boolean,
): Promise<{
  readonly actual: string;
  readonly expected: string;
  readonly retried: string;
}> {
  return await withSuffixFixture(
    size,
    async (history) => {
      const session = new SemanticMediaPurgeSession({
        history,
        mode: () => 'remove',
        persist: async () => undefined,
      });
      const attempt = await session.begin(explicit);
      if (!attempt) throw new Error('Missing production attempt');
      try {
        const options = {
          ...mediaRequestFixture(history),
          historyService: history,
          userContents: [],
          promptId: 'semantic-turn-body',
          semanticMediaPurge: attempt,
          estimateFinalizedPromptTokens: async () => 1,
        };
        const actual = await captureCuratedBody(
          provider,
          await enforceTurnMediaRequestContents(options),
          caching,
          provider === 'openai-responses',
        );
        const expected = await expectedBody(size, explicit, provider, caching);
        const retried = await captureCuratedBody(
          provider,
          await enforceTurnMediaRequestContents(options),
          caching,
        );
        saveBodies(`${provider}-${caching}`, size, explicit, actual, expected);
        return { actual, expected, retried };
      } finally {
        attempt.finalize();
      }
    },
    2048,
    row,
  );
}

const cases: Array<[number, boolean, string, boolean]> = [];
const inputs: Array<[number, boolean]> = [
  [512, false],
  [512, true],
  [8192, false],
  [8192, true],
];
for (const [size, explicit] of inputs)
  for (const provider of ['openai-responses', 'anthropic', 'gemini'])
    for (const caching of [false, true])
      cases.push([size, explicit, provider, caching]);
describe('production semantic purge provider bytes through real transports', () => {
  it.each(cases)(
    'preserves %i-row explicit %s %s caching %s body and retry bytes',
    async (size, explicit, provider, caching) => {
      const { actual, expected, retried } = await verify(
        size,
        explicit,
        provider,
        caching,
      );
      expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
      expect(Buffer.from(retried).equals(Buffer.from(expected))).toBe(true);
      if (caching && provider === 'anthropic')
        expect(actual).toContain('"cache_control"');
    },
    300_000,
  );
});
