/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';
import {
  responsesLengthRegistration,
  planStoredResponsesRequest,
} from './journal-responses-length.js';

const SETTINGS: RowFormatSettings = {
  formatId: 'responses',
  formatRev: 1,
  model: 'model-a',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
};
const REQUEST: OpenAIResponsesRequest = {
  model: SETTINGS.model,
  instructions: 'sys 雪\\"\ud800',
  input: [],
  stream: true,
  tools: [
    {
      type: 'function',
      strict: null,
      name: '查找"',
      description: '雪',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ],
  reasoning: { effort: 'high', summary: 'auto' },
  extra_json: { escaped: '\\"\n雪' },
};
const TIME = 1_780_000_000_123;
const ROWS: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: '雪\\"\n\ud800' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'reason 雪', encryptedContent: 'abc"\\' },
      {
        type: 'thinking',
        thought: 'server',
        encryptedContent: 'def',
        providerMetadata: { 'openai.responses.reasoningId': 'rs_genuine' },
      },
      { type: 'tool_call', id: '', name: 'empty', parameters: {} },
      {
        type: 'tool_call',
        id: 'call_',
        name: '查找"',
        parameters: { path: '雪\\' },
      },
      { type: 'tool_call', id: 'hist_tool_x', name: 'orphan', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_',
        toolName: '查找"',
        result: { text: '雪' },
      },
      {
        type: 'media',
        mimeType: 'application/pdf',
        encoding: 'base64',
        data: 'AQID',
        filename: '雪".pdf',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'url',
        data: 'https://example.test/雪?q="',
      },
    ],
  },
];

async function normalized(session: JournalSession): Promise<IContent[]> {
  const pin = await session.store.snapshot();
  const query = await IndexedJournalRequestSnapshot.create(pin);
  try {
    const rows: IContent[] = [];
    for await (const row of query.openReader()) rows.push(row);
    return rows;
  } finally {
    await query.close();
    await pin.close();
  }
}
function expectedBody(
  rows: IContent[],
  selected: 0 | 1,
  settings = SETTINGS,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      ...REQUEST,
      model: settings.model,
      input: buildOpenAIResponsesInput(rows, {
        includeReasoningInContext: selected === 0,
        outputLimits: settings.outputLimits ?? parseOutputLimits({}),
        debug: () => undefined,
        mediaPdfEnabled: settings.mediaPdfEnabled,
        reasoningIdTime: TIME,
      }),
    }),
  );
}

describe('native Responses stored request lengths', () => {
  it('measures normalized units including empty-ID collisions, completed orphans, media and both reasoning variants', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.append(ROWS);
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      const rows = await normalized(session);
      const pin = await session.store.snapshot();
      try {
        for (const selected of [0, 1] as const) {
          const actual = expectedBody(rows, selected);
          const plan = planStoredResponsesRequest(
            pin,
            SETTINGS,
            selected,
            REQUEST,
            TIME,
          );
          expect(plan.contentLength).toBe(actual.byteLength);
          expect(plan.inputBytes).toBe(
            Buffer.byteLength(
              JSON.stringify(JSON.parse(actual.toString()).input),
            ),
          );
          expect(plan.pdfBytes).toBe(3);
        }
        for await (const entry of pin.entries())
          expect(entry.lensRef[0]).toBeGreaterThan(0);
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('counts generated reasoning IDs across decimal boundaries and reuses a complete format', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      await session.append(
        Array.from(
          { length: 101 },
          (_, index): IContent => ({
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: `r${index}`,
                encryptedContent: '雪',
              },
            ],
          }),
        ),
      );
      const pin = await session.store.snapshot();
      try {
        expect(
          planStoredResponsesRequest(pin, SETTINGS, 0, REQUEST, TIME)
            .contentLength,
        ).toBe(expectedBody(await normalized(session), 0).byteLength);
        expect(
          planStoredResponsesRequest(pin, SETTINGS, 0, REQUEST, TIME)
            .generatedIds,
        ).toBe(101);
        const seq = session.store.published?.commitSeq;
        await session.registerRowFormat(
          responsesLengthRegistration({ ...SETTINGS }),
        );
        expect(session.store.published?.commitSeq).toBe(seq);
      } finally {
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('fails explicitly for parent cursors, pending tails, input overrides and unsupported converter settings', async () => {
    const session = await JournalSession.createUnlinked();
    try {
      await session.registerRowFormat(responsesLengthRegistration(SETTINGS));
      const pin = await session.store.snapshot();
      try {
        expect(() =>
          planStoredResponsesRequest(
            pin,
            SETTINGS,
            0,
            { ...REQUEST, previous_response_id: 'resp_parent' },
            TIME,
          ),
        ).toThrow(/parent/);
        expect(() =>
          planStoredResponsesRequest(pin, SETTINGS, 0, REQUEST, TIME, {
            cursor: 1,
          }),
        ).toThrow(/cursor/);
        expect(() =>
          planStoredResponsesRequest(pin, SETTINGS, 0, REQUEST, TIME, {
            pendingInputCount: 1,
          }),
        ).toThrow(/pending/);
        expect(() =>
          planStoredResponsesRequest(
            pin,
            SETTINGS,
            0,
            { ...REQUEST, input: [{ role: 'user', content: 'override' }] },
            TIME,
          ),
        ).toThrow(/input override/);
        expect(() =>
          planStoredResponsesRequest(
            pin,
            SETTINGS,
            0,
            { ...REQUEST, model: 'other' },
            TIME,
          ),
        ).toThrow(/model/);
        for (const settings of [
          { ...SETTINGS, isOAuth: true },
          { ...SETTINGS, toolNameTransform: 'oauth' },
          { ...SETTINGS, supportsUrlImages: false },
          { ...SETTINGS, reasoningEnabled: true },
          { ...SETTINGS, unsupportedMedia: 'reject' },
        ] as const) {
          expect(() => responsesLengthRegistration(settings)).toThrow(
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
});
