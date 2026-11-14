/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type OpenAI from 'openai';
import { encodeRowDraft } from '@vybestack/llxprt-code-core/journal/rowDraft.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { decodeRowHeader } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  decodeStoredRow,
  encodeContentRow,
} from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import { nativeChatMessages } from '@vybestack/llxprt-code-providers/openai/native-chat-messages.js';

/** Tool data with object-machinery key names as own keys at several depths. */
const OWN_KEY_JSON = [
  '{"__proto__":{"constructor":{"prototype":{"polluted":true}},',
  '"__proto__":[{"__proto__":null,"prototype":1}]},',
  '"constructor":"c","prototype":{"__proto__":"deep"}}',
].join('');

const settings: RowFormatSettings = {
  formatId: 'openai-chat:openai',
  formatRev: 1,
  model: 'gpt-test',
  endpoint: 'https://api.openai.invalid/v1',
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

/** The entry as the journal hands it back: written to row bytes, then decoded. */
function throughJournal(content: IContent): IContent {
  const draft = encodeContentRow(content, { owner: 0 });
  const { record } = encodeRowDraft(4096n, draft);
  return decodeStoredRow({
    header: decodeRowHeader(record.kindHeader),
    rawIds: draft.ids.map((id) => id.rawId),
    meta: draft.meta,
    blocks: draft.blocks.map((block) => block.bytes),
  });
}

async function* rowsOf(rows: readonly IContent[]): AsyncGenerator<IContent> {
  yield* rows;
}

async function chatBody(
  rows: readonly IContent[],
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const chunks: Uint8Array[] = [Buffer.from('[{"role":"system","content":""}')];
  for await (const chunk of nativeChatMessages(
    rowsOf(rows),
    settings,
    'none',
    -1,
  ))
    chunks.push(chunk);
  chunks.push(Buffer.from(']'));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

describe('tool data keys named like object machinery on the Chat wire', () => {
  it('sends __proto__, constructor and prototype keys read from the journal', async () => {
    const rows = [
      throughJournal({
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'fetch',
            parameters: JSON.parse(OWN_KEY_JSON),
          },
        ],
      }),
      throughJournal({
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_1',
            toolName: 'fetch',
            result: JSON.parse(OWN_KEY_JSON),
          },
        ],
      }),
    ];

    const messages = await chatBody(rows);
    const assistant = messages.find((message) => message.role === 'assistant');
    const tool = messages.find((message) => message.role === 'tool');
    if (assistant?.role !== 'assistant' || tool?.role !== 'tool') {
      throw new Error('Expected the assistant call and the tool message');
    }
    const call = assistant.tool_calls?.[0];
    if (call?.type !== 'function') {
      throw new Error('Expected a function tool call');
    }
    expect(JSON.stringify(JSON.parse(call.function.arguments))).toBe(
      OWN_KEY_JSON,
    );
    if (typeof tool.content !== 'string') {
      throw new Error('Expected text tool content');
    }
    const output = tool.content.slice(
      tool.content.indexOf('output:\n') + 'output:\n'.length,
    );
    expect(JSON.stringify(JSON.parse(output))).toBe(OWN_KEY_JSON);
  });
});
