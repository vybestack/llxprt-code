/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854: native preparation streams the chat body without scratch files
 * and releases its row readers and body handles with the request.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { closeInOrder } from '../__tests__/support/close-in-order.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { observeNativeBodies } from '../__tests__/support/native-body-lifecycle.js';
import { readPreparedChatBody } from './__tests__/support/prepareRequestBody.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import {
  prepareRequest,
  type RequestContext,
} from './OpenAIRequestPreparation.js';

const liveBodies = observeNativeBodies();

const logger = new DebugLogger('llxprt:provider:openai:spool-test');

const HISTORY: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'list the files' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'sure' },
      {
        type: 'tool_call',
        id: 'hist_tool_1',
        name: 'ls',
        parameters: { path: '.' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_1',
        toolName: 'ls',
        result: 'a.txt\nb.txt',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'thanks \u2028 😀' }] },
];

function optionsFor(
  rows: readonly IContent[],
  model: string,
  modelParams: Record<string, unknown> = {},
  requestRows = rowsSelection(rows),
  ephemerals: Record<string, unknown> = {},
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows,
    contentCount: rows.length,
    tools: undefined,
    metadata: {},
    invocation: createRuntimeInvocationContext({
      runtimeId: 'spool-test',
      providerName: 'openai',
      ephemeralsSnapshot: { openai: modelParams, ...ephemerals },
    }),
    systemInstruction: 'be brief',
    resolved: { model, authToken: 'test-token' },
  };
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

describe('prepareRequest streams the native chat body', () => {
  let startingSpools: number;
  let startingScratch: Set<string>;
  const prepared: RequestContext[] = [];

  beforeEach(() => {
    startingSpools = liveBodies();
    startingScratch = scratchNames();
  });

  function releasePrepared(): Promise<void> {
    return closeInOrder(
      undefined,
      ...prepared.splice(0).map((context) => ({
        close: () => context.release(),
      })),
    );
  }

  async function releaseAndExpectNothingLeaked(): Promise<void> {
    await releasePrepared();
    expect(liveBodies()).toBe(startingSpools);
    expect(scratchNames()).toStrictEqual(startingScratch);
  }

  afterEach(async () => {
    await releasePrepared();
  });

  async function prepare(
    options: NormalizedGenerateChatOptions,
  ): Promise<RequestContext> {
    const context = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );
    prepared.push(context);
    return context;
  }

  it('writes exactly the bytes of the array route and counts the system message', async () => {
    const options = optionsFor(HISTORY, 'gpt-4o');
    const context = await prepare(options);

    const messages = [
      { role: 'system', content: 'be brief' },
      ...buildMessagesWithReasoning(
        HISTORY.map((row) => structuredClone(row)),
        options,
        'openai',
        undefined,
      ),
    ];
    const expected = JSON.stringify({
      model: 'gpt-4o',
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    const sent = Buffer.from(
      JSON.stringify(await readPreparedChatBody(context.spool)),
    );
    expect(sent.toString('utf8')).toBe(expected);
    expect(context.messageCount).toBe(messages.length);
    expect(context.spool.byteLength).toBeGreaterThan(0);
    await releaseAndExpectNothingLeaked();
  });

  it('keeps Kimi tool ids stable without scratch files', async () => {
    const options = optionsFor(HISTORY, 'kimi-k2');
    const context = await prepare(options);

    expect(scratchNames()).toStrictEqual(startingScratch);
    expect(context.detectedFormat).toBe('kimi');

    const body = await readPreparedChatBody(context.spool);
    const assistant = body.messages.find(
      (message) => message.role === 'assistant',
    );
    expect(JSON.stringify(assistant)).toContain('functions.ls:0');
    await releaseAndExpectNothingLeaked();
  });

  it('rejects a messages override before writing anything', async () => {
    const options = optionsFor(HISTORY, 'gpt-4o', {
      messages: [{ role: 'user', content: 'replaced' }],
    });

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('cannot replace "messages"');
    expect(liveBodies()).toBe(startingSpools);
  });

  it('closes the native reader, body and request when a row fails mid-body', async () => {
    let fail = false;
    let returned = 0;
    const failing = {
      ...rowsSelection(HISTORY),
      async *openReader(signal?: AbortSignal) {
        try {
          let seen = 0;
          for await (const row of rowsSelection(HISTORY).openReader(signal)) {
            if (fail && ++seen === 3) throw new Error('row source failed');
            yield row;
          }
        } finally {
          returned++;
        }
      },
    };
    const context = await prepare(optionsFor(HISTORY, 'kimi-k2', {}, failing));
    const before = returned;
    fail = true;
    await expect(readPreparedChatBody(context.spool)).rejects.toThrow(
      'row source failed',
    );
    expect(returned).toBe(before + 1);
    await releaseAndExpectNothingLeaked();
    expect(() => context.spool.openStream()).toThrow('disposed');
    await expect(context.continuation.build([])).rejects.toThrow('released');
  });

  it('provides a file-free dump form only when dumpcontext asks for it', async () => {
    const withoutDump = await prepare(optionsFor(HISTORY, 'gpt-4o'));
    expect(withoutDump.dump).toBeUndefined();
    const plainScratch = [...scratchNames()].filter(
      (name) => !startingScratch.has(name),
    );
    expect(
      plainScratch.some((name) => name.startsWith('openai-chat-prompt')),
    ).toBe(false);
    await releaseAndExpectNothingLeaked();

    for (const mode of ['on', 'error']) {
      const options = optionsFor(
        HISTORY,
        'gpt-4o',
        {},
        rowsSelection(HISTORY),
        { dumpcontext: mode },
      );
      const context = await prepare(options);
      expect(context.dump).toBeDefined();
      const parts: Uint8Array[] = [];
      for await (const part of context.dump?.bytes() ?? []) parts.push(part);
      const dumped: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const wire: unknown = JSON.parse(
        JSON.stringify(await readPreparedChatBody(context.spool)),
      );
      expect(dumped).toStrictEqual(wire);
      expect(context.estimate).toBeUndefined();
      await releaseAndExpectNothingLeaked();
    }
  });

  it('streams a large dump form in bounded chunks', async () => {
    const rows: IContent[] = Array.from({ length: 160 }, (_, index) => ({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `${index} ${'x'.repeat(30_000)}` }],
    }));
    const context = await prepare(
      optionsFor(rows, 'gpt-4o', {}, rowsSelection(rows), {
        dumpcontext: 'on',
      }),
    );

    let total = 0;
    let largest = 0;
    for await (const part of context.dump?.bytes() ?? []) {
      total += part.byteLength;
      largest = Math.max(largest, part.byteLength);
    }
    expect(total).toBeGreaterThan(4_800_000);
    expect(largest).toBeLessThanOrEqual(64 * 1024);
    await releaseAndExpectNothingLeaked();
  });

  it('closes the dump reader and request when a lazy row read fails', async () => {
    let fail = false;
    let returned = 0;
    const failing = {
      ...rowsSelection(HISTORY),
      async *openReader(signal?: AbortSignal) {
        try {
          let seen = 0;
          for await (const row of rowsSelection(HISTORY).openReader(signal)) {
            if (fail && ++seen === 3) throw new Error('row source failed');
            yield row;
          }
        } finally {
          returned++;
        }
      },
    };
    const context = await prepare(
      optionsFor(HISTORY, 'gpt-4o', {}, failing, { dumpcontext: 'on' }),
    );
    const before = returned;
    fail = true;
    const consume = async (): Promise<void> => {
      if (context.dump === undefined) throw new Error('Missing dump');
      for await (const part of context.dump.bytes()) void part;
    };
    await expect(consume()).rejects.toThrow('row source failed');
    expect(returned).toBe(before + 1);
    await releaseAndExpectNothingLeaked();
    expect(() => context.spool.openStream()).toThrow('disposed');
  });

  it('fails without rows instead of sending an empty history', async () => {
    const options = {
      ...optionsFor(HISTORY, 'gpt-4o'),
      requestRows: undefined,
    };

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('requires a native or caller-owned request selection');
    expect(liveBodies()).toBe(startingSpools);
  });
});
