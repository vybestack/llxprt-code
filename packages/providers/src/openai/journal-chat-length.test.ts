/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { writeChatMessages } from './OpenAIChatBodyBuilder.js';
import { createHash } from 'node:crypto';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { foldChatUnits } from './journal-chat-length.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  rowFormatKey,
  type RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  plainChatLengthRegistration,
  planStoredChatMessages,
  PLAIN_CHAT_FORMAT_REV,
} from './journal-chat-length.js';
import { analyzeChat } from './__tests__/support/lengthModel/chatLengthModel.js';
import {
  buildMessagesWithReasoning,
  processAssistantMessage,
  processUserMessage,
  normalizeToolCallArguments,
} from './OpenAIRequestBuilder.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools';

const SETTINGS: RowFormatSettings = {
  formatId: 'openai-chat:plain',
  formatRev: PLAIN_CHAT_FORMAT_REV,
  model: 'same-class-a',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};
const ROWS: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: '雪 \\"\n\ud800' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'think 雪' },
      { type: 'text', text: 'answer' },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: '' }] },
];
const MODEL_SETTINGS = {
  toolFormat: undefined,
  strip: 'none',
  includeInContext: true,
  kimiRule: 'lastEligible',
} as const;

async function actualRows(session: JournalSession): Promise<IContent[]> {
  const pin = await session.store.snapshot();
  const request = await IndexedJournalRequestSnapshot.create(pin);
  try {
    const rows: IContent[] = [];
    for await (const row of request.openReader()) rows.push(row);
    return rows;
  } finally {
    await request.close();
    await pin.close();
  }
}
function actualBytes(rows: readonly IContent[], system: string): Buffer {
  const messages = [
    { role: 'system', content: system },
    ...rows.flatMap((row) => {
      const message =
        row.speaker === 'human'
          ? processUserMessage(row)
          : processAssistantMessage(
              row,
              true,
              undefined,
              (call) => normalizeToOpenAIToolId(call.id),
              normalizeToolCallArguments,
            );
      return message === null ? [] : [message];
    }),
  ];
  return Buffer.from(JSON.stringify(messages));
}

function oracleBytes(
  rows: readonly IContent[],
  system: string,
  selected: 0 | 1 = 0,
): Buffer {
  return Buffer.from(
    JSON.stringify([
      { role: 'system', content: system },
      ...buildMessagesWithReasoning(
        structuredClone([...rows]),
        {
          invocation: {
            ephemerals: {
              'reasoning.stripFromContext': selected === 0 ? 'none' : 'all',
              'reasoning.includeInContext': true,
            },
          },
        },
        undefined,
        undefined,
      ),
    ]),
  );
}

async function streamedBytes(
  session: JournalSession,
  system: string,
): Promise<Buffer> {
  const pin = await session.store.snapshot();
  const request = await IndexedJournalRequestSnapshot.create(pin);
  const parts = [
    Buffer.from(`[${JSON.stringify({ role: 'system', content: system })}`),
  ];
  try {
    await writeChatMessages(
      { rows: () => request.openReader() },
      {
        toolFormat: undefined,
        reasoning: {
          invocation: {
            ephemerals: {
              'reasoning.stripFromContext': 'none',
              'reasoning.includeInContext': true,
            },
          },
        },
      },
      {
        message(chunks): void {
          parts.push(Buffer.from(','));
          for (const chunk of chunks) parts.push(Buffer.from(chunk));
        },
      },
    );
    parts.push(Buffer.from(']'));
    return Buffer.concat(parts);
  } finally {
    await request.close();
    await pin.close();
  }
}

async function verifyClone(session: JournalSession): Promise<void> {
  const clone = await session.cloneUnlinked();
  try {
    const copied = await clone.store.snapshot();
    try {
      expect(
        planStoredChatMessages(copied, { ...SETTINGS, model: 'fourth' }, 0, '')
          .bytes,
      ).toBe(actualBytes(await actualRows(clone), '').length);
    } finally {
      await copied.close();
    }
  } finally {
    await clone.close();
  }
}

describe('stored plain chat tools', () => {
  it('counts identical thinking variants once per converted unit', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'reason' },
          { type: 'text', text: 'conclusion' },
        ],
      },
    ];
    const inputs: string[] = [];
    async function* source(): AsyncGenerator<IContent> {
      yield* rows;
    }
    const { summary } = await foldChatUnits(source(), SETTINGS, {
      count: async (messages) => {
        const input = JSON.stringify(messages);
        inputs.push(input);
        return Buffer.byteLength(input);
      },
    });
    expect(inputs).toHaveLength(4);
    if (summary.kind !== 'chat') throw new Error('Expected Chat summary');
    expect(summary.tokens).toStrictEqual([
      Buffer.byteLength(inputs[0]) +
        Buffer.byteLength(inputs[1]) +
        Buffer.byteLength(inputs[2]),
      Buffer.byteLength(inputs[0]) +
        Buffer.byteLength(inputs[1]) +
        Buffer.byteLength(inputs[3]),
    ]);
  });
  it.each(['excluded reasoning', 'strict OpenAI tool call'])(
    'counts identical converted messages once with %s',
    async (scenario) => {
      const toolCall = scenario === 'strict OpenAI tool call';
      const answer: IContent['blocks'] = toolCall
        ? [
            {
              type: 'tool_call',
              id: 'call_x',
              name: 'lookup',
              parameters: {},
            },
          ]
        : [{ type: 'text', text: 'answer' }];
      const row: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'reason' }, ...answer],
      };
      async function* source(): AsyncGenerator<IContent> {
        yield row;
      }
      let counts = 0;
      const { summary } = await foldChatUnits(
        source(),
        {
          ...SETTINGS,
          chat: { toolFormat: 'openai', includeInContext: toolCall },
        },
        {
          count: async (messages) => {
            counts++;
            return Buffer.byteLength(JSON.stringify(messages));
          },
        },
      );
      const message = processAssistantMessage(
        row,
        toolCall,
        'openai',
        (call) => normalizeToOpenAIToolId(call.id),
        normalizeToolCallArguments,
      );
      const tokens = Buffer.byteLength(JSON.stringify([message]));
      if (summary.kind !== 'chat') throw new Error('Expected Chat summary');
      expect({ counts, tokens: summary.tokens }).toStrictEqual({
        counts: 1,
        tokens: [tokens, tokens],
      });
    },
  );
  it('measures tool pairs, escaped names, relocated image media and updated best responses', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append([
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_x',
              name: '查找"',
              parameters: { path: '雪\\file' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_x',
              toolName: '查找"',
              result: 'first',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'base64',
              data: 'AQID',
            },
          ],
        },
      ]);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const pin = await session.store.snapshot();
      try {
        const rows = await actualRows(session);
        const actual = await streamedBytes(session, 'sys');
        const expected = oracleBytes(rows, 'sys');
        expect(planStoredChatMessages(pin, SETTINGS, 0, 'sys').bytes).toBe(
          actual.length,
        );
        expect(createHash('sha256').update(actual).digest('hex')).toBe(
          createHash('sha256').update(expected).digest('hex'),
        );
        expect(actual.length).toBe(
          analyzeChat(rows, MODEL_SETTINGS, 'sys', 31).predicted,
        );
      } finally {
        await pin.close();
      }
      await session.append([
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_x',
              toolName: 'lookup',
              result: 'a better result that changes the earlier holder',
              isComplete: true,
            },
          ],
        },
      ]);
      const changed = await session.store.snapshot();
      try {
        expect(planStoredChatMessages(changed, SETTINGS, 0, 'sys').bytes).toBe(
          analyzeChat(await actualRows(session), MODEL_SETTINGS, 'sys', 32)
            .predicted,
        );
      } finally {
        await changed.close();
      }
    } finally {
      await session.close();
    }
  });
});

describe('stored plain chat lengths', () => {
  it('matches old conversion for both thinking variants and inline media URI bytes', async () => {
    const session = await JournalSession.createUnlinked();
    const rows: readonly IContent[] = [
      ...ROWS,
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'image 雪\\"' },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.test/雪?quote="&slash=\\',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            filename: '雪".pdf',
            data: 'AQID',
          },
        ],
      },
    ];
    try {
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const empty = await session.store.snapshot();
      expect(planStoredChatMessages(empty, SETTINGS, 0, '').bytes).toBe(
        oracleBytes([], '').byteLength,
      );
      await empty.close();
      await session.append(rows);
      const pin = await session.store.snapshot();
      const variants: ReadonlyArray<0 | 1> = [0, 1];
      try {
        for (const selected of variants) {
          const expected = oracleBytes(
            await actualRows(session),
            'sys 雪',
            selected,
          );
          const plan = planStoredChatMessages(
            pin,
            SETTINGS,
            selected,
            'sys 雪',
          );
          expect(plan.bytes).toBe(expected.byteLength);
          expect(plan.items).toBe(JSON.parse(expected.toString()).length);
        }
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
  it('fills real normalized contributions and plans from the pinned aggregate without decoding again', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append(ROWS);
      const missing = await session.store.snapshot();
      expect(() => planStoredChatMessages(missing, SETTINGS, 0, 'sys')).toThrow(
        /registered/,
      );
      await missing.close();
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const pin = await session.store.snapshot();
      try {
        const rows = await actualRows(session);
        const expected = Buffer.from(
          JSON.stringify([
            { role: 'system', content: 'sys' },
            ...buildMessagesWithReasoning(
              structuredClone(rows),
              {
                invocation: {
                  ephemerals: {
                    'reasoning.stripFromContext': 'none',
                    'reasoning.includeInContext': true,
                  },
                },
              },
              undefined,
              undefined,
            ),
          ]),
        );
        const plan = planStoredChatMessages(pin, SETTINGS, 0, 'sys');
        expect(plan.bytes).toBe(expected.byteLength);
        expect(plan.bytes).toBe(
          analyzeChat(rows, MODEL_SETTINGS, 'sys', 23).predicted,
        );
        expect(plan.items).toBe(JSON.parse(expected.toString()).length);
        expect(
          createHash('sha256').update(actualBytes(rows, 'sys')).digest('hex'),
        ).toBe(createHash('sha256').update(expected).digest('hex'));
        for await (const entry of pin.entries())
          expect(entry.lensRef[0]).toBeGreaterThan(0);
        const seq = session.store.published?.commitSeq;
        if (seq === undefined) throw new Error('No filled version');
        await session.registerRowFormat(
          plainChatLengthRegistration({ ...SETTINGS }),
        );
        expect((session.store.published?.commitSeq ?? -1) - seq).toBe(0);
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps an old pin and its captured settings valid across append, eviction and clone', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append(ROWS);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const old = await session.store.snapshot();
      const oldBytes = actualBytes(ROWS, '').length;
      try {
        await session.append([
          { speaker: 'human', blocks: [{ type: 'text', text: 'new' }] },
        ]);
        const current = await session.store.snapshot();
        try {
          expect(planStoredChatMessages(current, SETTINGS, 0, '').bytes).toBe(
            actualBytes(await actualRows(session), '').length,
          );
        } finally {
          await current.close();
        }
        for (const model of ['same-class-b', 'third', 'fourth'])
          await session.registerRowFormat(
            plainChatLengthRegistration({ ...SETTINGS, model }),
          );
        expect(planStoredChatMessages(old, SETTINGS, 0, '').bytes).toBe(
          oldBytes,
        );
        const evicted = await session.store.snapshot();
        try {
          expect(() =>
            planStoredChatMessages(evicted, SETTINGS, 0, ''),
          ).toThrow(/registered/);
        } finally {
          await evicted.close();
        }
        await verifyClone(session);
      } finally {
        await old.close();
      }
    } finally {
      await session.close();
    }
  });

  it('rejects settings without implemented plain-chat conversion at registration and planning', async () => {
    const unsupported: readonly RowFormatSettings[] = [
      { ...SETTINGS, formatId: 'openai-chat:openai' },
      { ...SETTINGS, formatId: 'openai-chat:kimi' },
      { ...SETTINGS, formatId: 'openai-chat:mistral' },
      { ...SETTINGS, formatId: 'responses' },
      { ...SETTINGS, formatId: 'anthropic' },
      { ...SETTINGS, formatRev: PLAIN_CHAT_FORMAT_REV + 1 },
      { ...SETTINGS, isOAuth: true },
      { ...SETTINGS, toolNameTransform: 'oauth' },
      { ...SETTINGS, supportsUrlImages: false },
      { ...SETTINGS, reasoningEnabled: true },
      { ...SETTINGS, reasoningFieldName: 'reasoning' },
      { ...SETTINGS, mediaPdfEnabled: true },
      { ...SETTINGS, unsupportedMedia: 'reject' },
    ];
    const session = await JournalSession.createUnlinked();
    try {
      await session.append(ROWS);
      await session.registerRowFormat(plainChatLengthRegistration(SETTINGS));
      const pin = await session.store.snapshot();
      try {
        for (const settings of unsupported) {
          expect(() => plainChatLengthRegistration(settings)).toThrow(
            /does not support/,
          );
          expect(() => planStoredChatMessages(pin, settings, 0, '')).toThrow(
            /does not support/,
          );
        }
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('includes every declared setting and nested output option in the deterministic key', () => {
    const changes: readonly RowFormatSettings[] = [
      { ...SETTINGS, formatId: 'anthropic' },
      { ...SETTINGS, formatRev: PLAIN_CHAT_FORMAT_REV + 1 },
      { ...SETTINGS, model: 'same-class-b' },
      { ...SETTINGS, endpoint: 'https://other.test/v1' },
      { ...SETTINGS, isOAuth: true },
      { ...SETTINGS, toolNameTransform: 'oauth' },
      { ...SETTINGS, supportsUrlImages: false },
      { ...SETTINGS, reasoningEnabled: true },
      { ...SETTINGS, reasoningFieldName: 'reasoning' },
      { ...SETTINGS, mediaPdfEnabled: true },
      { ...SETTINGS, unsupportedMedia: 'reject' },
      {
        ...SETTINGS,
        outputLimits: {
          tokenLimit: { kind: 'disabled' },
          truncateMode: 'warn',
        },
      },
      {
        ...SETTINGS,
        outputLimits: {
          tokenLimit: { kind: 'limited', maxTokens: 3 },
          truncateMode: 'truncate',
        },
      },
    ];
    for (const changed of changes)
      expect(rowFormatKey(changed)).not.toBe(rowFormatKey(SETTINGS));
    expect(
      rowFormatKey({
        ...SETTINGS,
        outputLimits: {
          truncateMode: 'warn',
          tokenLimit: { kind: 'limited', maxTokens: 3 },
        },
      }),
    ).toBe(
      rowFormatKey({
        ...SETTINGS,
        outputLimits: {
          tokenLimit: { maxTokens: 3, kind: 'limited' },
          truncateMode: 'warn',
        },
      }),
    );
  });
});
