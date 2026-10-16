/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeBodyFile } from '../../../packages/test-utils/src/body-evidence-writer.js';
import { describe, expect, it } from 'bun:test';

import { join } from 'node:path';
import { DebugLogger } from '../../../packages/core/src/debug/index.js';
import { buildCuratedHistory } from '../../../packages/core/src/services/history/historyCuration.js';
import { buildProviderContent } from '../../../packages/core/src/services/history/historyProviderPipeline.js';
import { sendTurnSource } from '../../../packages/agents/src/core/turnSourceRequest.js';
import { mediaRequestFixture } from '../../../packages/agents/src/core/__tests__/support/turn-media-request-test-helpers.js';
import { captureCuratedBody } from '../provider-curated-body-gemini.js';
const logger = new DebugLogger('test:semantic-purge-body-oracle');
/**
 * Far above the largest history here (8192 rows of about 2 KiB): this test
 * pins request bytes, so every send must stay under the limit and never enter
 * the compression ladder (the fixture's compression factory throws).
 */
const UNCOMPRESSED_CONTEXT_LIMIT = 100_000_000;
import type { RuntimeGenerateChatOptions } from '../../../packages/core/src/runtime/contracts/RuntimeProviderChat.js';
import type { IContent } from '../../../packages/core/src/services/history/IContent.js';
import { HistoryService } from '../../../packages/core/src/services/history/HistoryService.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { EagerSemanticPurgeOracle } from '../../../packages/core/src/services/history/__tests__/support/semantic-purge-eager-test-helpers.js';
import {
  SemanticMediaPurgeSession,
  type SemanticMediaPurgeAttempt,
} from '../../../packages/agents/src/core/semanticMediaPurgeSession.js';

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
async function saveBodies(
  provider: string,
  size: number,
  explicit: boolean,
  actual: string,
  expected: string,
): Promise<void> {
  const output = process.env.SEMANTIC_PURGE_BODY_OUTPUT;
  if (!output) return;
  await writeBodyFile(
    join(output, `production-${provider}-${size}-${explicit}-actual.json`),
    actual,
  );
  await writeBodyFile(
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

/**
 * The production request rows: the turn source route (disk selection, purge
 * override, compression enforcement) read row by row at the send seam.
 */
async function productionRequestRows(
  history: HistoryService,
  attempt: SemanticMediaPurgeAttempt,
): Promise<IContent[]> {
  const fixture = mediaRequestFixture(history, UNCOMPRESSED_CONTEXT_LIMIT);
  const runtime = {
    ...fixture.runtimeContext,
    providerRuntime: {
      ...fixture.runtimeContext.providerRuntime,
      config: { getEnableHooks: () => false },
    },
  } as unknown as Parameters<typeof sendTurnSource>[0]['runtime'];
  const rows: IContent[] = [];
  await sendTurnSource({
    runtime,
    compression: fixture.compressionHandler,
    history,
    provider: fixture.provider,
    promptId: 'semantic-turn-body',
    userContents: [],
    semanticMediaPurge: attempt,
    tools: undefined,
    signal: undefined,
    log: () => undefined,
    buildOptions: (contents) =>
      ({ contents }) as unknown as RuntimeGenerateChatOptions,
    onPrepared: () => undefined,
    attempt: async (prepared) => {
      for await (const row of prepared.options.requestRows.openReader())
        rows.push(row);
      return { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    },
  });
  return rows;
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
        const actual = await captureCuratedBody(
          provider,
          await productionRequestRows(history, attempt),
          caching,
          provider === 'openai-responses',
        );
        const expected = await expectedBody(size, explicit, provider, caching);
        const retried = await captureCuratedBody(
          provider,
          await productionRequestRows(history, attempt),
          caching,
        );
        await saveBodies(
          `${provider}-${caching}`,
          size,
          explicit,
          actual,
          expected,
        );
        return { actual, expected, retried };
      } finally {
        attempt.finalize();
      }
    },
    2048,
    row,
  );
}

/**
 * Registers the explicit-flag x caching cases for the given sizes and
 * providers. Each 8192-row case costs 30 s to 40 s on a CI runner, so the
 * large cases are split per provider across files to stay inside the
 * per-file process budget; every case still runs.
 */
export function registerProductionBodyCases(
  sizes: readonly number[],
  providers: ReadonlyArray<'openai-responses' | 'anthropic' | 'gemini'>,
): void {
  const cases: Array<[number, boolean, string, boolean]> = sizes.flatMap(
    (size) =>
      [false, true].flatMap((explicit) =>
        providers.flatMap((provider) =>
          [false, true].map((caching): [number, boolean, string, boolean] => [
            size,
            explicit,
            provider,
            caching,
          ]),
        ),
      ),
  );
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
}
