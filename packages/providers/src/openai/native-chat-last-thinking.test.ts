/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../runtime/promptEnvelopeProjections.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { prepareRequestBody } from './__tests__/support/prepareRequestBody.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  plainChatLengthRegistration,
  planRequestChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from './journal-chat-length.js';

const logger = new DebugLogger('native-chat-last-thinking');
const human = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});
const ai = (thought: string, text = 'answer'): IContent => ({
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought },
    { type: 'text', text },
  ],
});
const call: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought: 'call thought' },
    { type: 'tool_call', id: 'call_x', name: 'lookup', parameters: {} },
  ],
};
const response: IContent = {
  speaker: 'tool',
  blocks: [
    {
      type: 'tool_response',
      callId: 'call_x',
      toolName: 'lookup',
      result: 'real response',
    },
  ],
};
const cases: ReadonlyArray<{
  name: string;
  base: readonly IContent[];
  pending: readonly IContent[];
}> = [
  {
    name: 'start',
    base: [ai('start'), human('middle'), human('end')],
    pending: [],
  },
  {
    name: 'middle',
    base: [human('start'), ai('middle'), human('end')],
    pending: [],
  },
  { name: 'end', base: [ai('old'), human('middle'), ai('last')], pending: [] },
  {
    name: 'no thinking',
    base: [human('start'), { speaker: 'ai', blocks: [] }],
    pending: [],
  },
  { name: 'empty thinking blocks', base: [ai('old'), ai('', '')], pending: [] },
  {
    name: 'empty thinking with visible text',
    base: [ai('old'), ai('', 'visible')],
    pending: [],
  },
  {
    name: 'pending empty AI remains a unit',
    base: [ai('old')],
    pending: [ai('', '')],
  },
  {
    name: 'multiple thinking blocks',
    base: [
      ai('old'),
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'first' },
          { type: 'text', text: 'between' },
          { type: 'thinking', thought: 'second' },
        ],
      },
    ],
    pending: [],
  },
  {
    name: 'human thinking overrides AI',
    base: [
      ai('old'),
      {
        speaker: 'human',
        blocks: [
          { type: 'thinking', thought: 'human thought' },
          { type: 'text', text: 'human' },
        ],
      },
    ],
    pending: [],
  },
  {
    name: 'tool thinking filtered by normalization',
    base: [
      ai('old'),
      {
        ...response,
        blocks: [
          ...response.blocks,
          { type: 'thinking', thought: 'tool thought' },
        ],
      },
    ],
    pending: [],
  },
  { name: 'orphan call', base: [ai('old'), call], pending: [] },
  {
    name: 'repeated ID',
    base: [call, response, ai('between'), call, response],
    pending: [],
  },
  {
    name: 'pending user',
    base: [ai('old'), ai('last')],
    pending: [human('pending')],
  },
  {
    name: 'pending AI overrides history',
    base: [ai('old'), human('middle')],
    pending: [ai('pending')],
  },
  {
    name: 'pending response changes holder',
    base: [ai('old'), call, ai('last')],
    pending: [response],
  },
  {
    name: 'pending response before call',
    base: [response, ai('old')],
    pending: [call],
  },
];
function options(
  rows: ProviderRequestSelection,
  strip: string,
  include: boolean,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: rows,
    contentCount: rows.count,
    metadata: {},
    systemInstruction: 'system 雪',
    invocation: createRuntimeInvocationContext({
      fetch: (input, init) => globalThis.fetch(input, init),
      runtimeId: 'last-thinking',
      providerName: 'openai',
      ephemeralsSnapshot: {
        'reasoning.includeInContext': include,
        'reasoning.stripFromContext': strip,
      },
    }),
    resolved: {
      model: 'gpt-4o',
      baseURL: 'https://example.test/v1',
      authToken: 'test',
    },
  };
}
async function readBody(
  prepared: Awaited<ReturnType<typeof prepareRequest>>,
): Promise<string> {
  const handle = prepared.spool.openStream();
  try {
    return Buffer.from(
      await new Response(handle.stream).arrayBuffer(),
    ).toString();
  } finally {
    await handle.dispose();
  }
}
async function measuredTokens(
  prepared: Awaited<ReturnType<typeof prepareRequest>>,
): Promise<number> {
  if (prepared.estimate === undefined)
    throw new Error('Missing native estimate');
  const projected = projectOpenAIChatPromptEnvelopeFromSource(
    prepared.estimate.projection,
    { model: 'gpt-4o', releaseIfUnsent: async () => undefined },
  );
  return (
    await estimatePromptEnvelope(
      'openai',
      projected,
      createRuntimeTokenizerFactory(),
    )
  ).estimatedPromptTokens;
}

describe('native stored last-thinking policy', () => {
  const directory = useTempDir('native-last-thinking-');
  cases.forEach((input) => {
    it(`${input.name} matches the independent old converter for every strip and inclusion setting`, async () => {
      const fixture = await journalSendFixture(input.base, input.pending, {
        directory: directory(),
      });
      const oldRows = await normalizedRows([
        ...buildCuratedHistory(logger, input.base, false),
        ...input.pending,
      ]);
      try {
        for (const { include, strip } of [true, false, true].flatMap(
          (include) =>
            ['none', 'all', 'allButLast'].map((strip) => ({ include, strip })),
        )) {
          const inputOptions = options(fixture.selection, strip, include);
          const old = await prepareRequestBody(
            { ...inputOptions, requestRows: rowsSelection(oldRows) },
            'gpt-4o',
            undefined,
            logger,
            'openai',
          );
          const actual = await prepareRequest(
            inputOptions,
            'gpt-4o',
            undefined,
            logger,
            'openai',
            undefined,
            {},
            true,
          );
          try {
            const expected = Buffer.from(JSON.stringify(old.requestBody));
            expect(await readBody(actual)).toBe(expected.toString());
            expect(actual.spool.byteLength).toBe(expected.byteLength);
            const tokens = await measuredTokens(actual);
            const expectedTokens = await projectOpenAIChatPromptEnvelope(
              old.requestBody,
            ).legacyEstimate();
            expect(tokens).toBeGreaterThan(0);
            expect(Math.abs(tokens - expectedTokens)).toBeLessThanOrEqual(
              Math.max(16, expectedTokens * 0.005),
            );
          } finally {
            await actual.estimate?.projection.dispose();
            await actual.release();
          }
        }
      } finally {
        await fixture.close();
      }
    });
  });
  it.each(['last', 'allbutlast', '', 'invalid'])(
    'rejects invalid policy %s before creating a transport body',
    async (policy) => {
      const fixture = await journalSendFixture([ai('reason')], [], {
        directory: directory(),
      });
      try {
        await expect(
          prepareRequest(
            options(fixture.selection, policy, true),
            'gpt-4o',
            undefined,
            logger,
            'openai',
          ),
        ).rejects.toThrow(`Invalid reasoning.stripFromContext: ${policy}`);
      } finally {
        await fixture.close();
      }
    },
  );

  it('carries last-unit ranks through append, old pins, pop, rewrite, clone, compaction and reopen', async () => {
    const path = `${directory()}/lifecycle.llxj`;
    const session = await JournalSession.create(path);
    const settings: RowFormatSettings = {
      formatId: 'openai-chat:plain',
      formatRev: PLAIN_CHAT_FORMAT_REV,
      model: 'gpt-4o',
      endpoint: 'https://example.test/v1',
      isOAuth: false,
      toolNameTransform: 'none',
      supportsUrlImages: true,
      reasoningEnabled: false,
      reasoningFieldName: 'reasoning_content',
      mediaPdfEnabled: false,
      unsupportedMedia: 'notice',
      outputLimits: null,
      chat: { includeInContext: true, toolFormat: 'openai' },
    };
    const base = [ai('first '.repeat(20)), human('between'), ai('last')];
    async function check(
      current: JournalSession,
      rows: readonly IContent[],
    ): Promise<void> {
      await current.registerRowFormat(plainChatLengthRegistration(settings));
      const snapshot = await current.store.snapshot();
      const indexed = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        const plan = await planRequestChatMessages(
          snapshot,
          indexed,
          settings,
          2,
          'system 雪',
        );
        const normalized = await normalizedRows(rows);
        const expected = await prepareRequestBody(
          options(rowsSelection(normalized), 'allButLast', true),
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );
        expect(plan.bytes).toBe(
          Buffer.byteLength(JSON.stringify(expected.messagesWithSystem)),
        );
        let lastThinking = -1;
        normalized.forEach((row, index) => {
          if (row.blocks.some((block) => block.type === 'thinking'))
            lastThinking = index;
        });
        expect(plan.lastThinking).toBe(lastThinking);
      } finally {
        await indexed.close();
        await snapshot.close();
      }
    }
    try {
      await session.append(base);
      await check(session, base);
      const oldSnapshot = await session.store.snapshot();
      const oldIndexed =
        await IndexedJournalRequestSnapshot.create(oldSnapshot);
      try {
        await session.append([ai('new latest'), human('tail')]);
        await check(session, [...base, ai('new latest'), human('tail')]);
        expect(
          (
            await planRequestChatMessages(
              oldSnapshot,
              oldIndexed,
              settings,
              2,
              '',
            )
          ).lastThinking,
        ).toBe(2);
      } finally {
        await oldIndexed.close();
        await oldSnapshot.close();
      }
      const snapshot = await session.store.snapshot();
      const cut = (await snapshot.entryAt(3)).label;
      const replace = await snapshot.entryAt(2);
      await snapshot.close();
      await session.store.commit([
        { kind: 'pop', cutLabel: cut, expectedRemoved: 2 },
      ]);
      await check(session, base);
      await session.store.commit([
        { kind: 'density', removed: [replace.label], replacements: [] },
      ]);
      await check(session, base.slice(0, 2));
      const clone = await session.cloneUnlinked();
      try {
        await check(clone, base.slice(0, 2));
      } finally {
        await clone.close();
      }
      await session.store.compact();
      await check(session, base.slice(0, 2));
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      await check(reopened, base.slice(0, 2));
    } finally {
      await reopened.close();
    }
  });
});
