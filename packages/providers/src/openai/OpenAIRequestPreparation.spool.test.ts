/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 D3a: the chat request is prepared into a sealed spool, the
 * messages are never held as an array, and everything the preparation opens is
 * released with the request.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { activeWireBodySpoolCount } from '../utils/wire-body-spool.js';
import { readSpooledChatBody } from './__tests__/support/prepareRequestBody.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import {
  prepareRequest,
  type RequestContext,
} from './OpenAIRequestPreparation.js';

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
  } as unknown as NormalizedGenerateChatOptions;
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

describe('prepareRequest spools the chat body', () => {
  let startingSpools: number;
  let startingScratch: Set<string>;
  const prepared: RequestContext[] = [];

  beforeEach(() => {
    startingSpools = activeWireBodySpoolCount();
    startingScratch = scratchNames();
  });

  function releaseAndExpectNothingLeaked(): void {
    for (const context of prepared.splice(0)) context.release();
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
    expect(scratchNames()).toStrictEqual(startingScratch);
  }

  afterEach(() => {
    for (const context of prepared.splice(0)) context.release();
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
      JSON.stringify(readSpooledChatBody(context.spool)),
    );
    expect(sent.toString('utf8')).toBe(expected);
    expect(context.messageCount).toBe(messages.length);
    expect(context.spool.byteLength).toBeGreaterThan(0);
    releaseAndExpectNothingLeaked();
  });

  it('keeps Kimi tool ids in a scratch index that lives until release', async () => {
    const options = optionsFor(HISTORY, 'kimi-k2');
    const context = await prepare(options);

    const withIndex = scratchNames();
    const added = [...withIndex].filter((name) => !startingScratch.has(name));
    expect(added.some((name) => name.startsWith('tool-ids-'))).toBe(true);
    expect(added.some((name) => name.startsWith('openai-chat-'))).toBe(true);
    expect(context.detectedFormat).toBe('kimi');

    const body = readSpooledChatBody(context.spool);
    const assistant = body.messages.find(
      (message) => message.role === 'assistant',
    );
    expect(JSON.stringify(assistant)).toContain('functions.ls:0');
    releaseAndExpectNothingLeaked();
  });

  it('rejects a messages override before writing anything', async () => {
    const options = optionsFor(HISTORY, 'gpt-4o', {
      messages: [{ role: 'user', content: 'replaced' }],
    });

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('cannot replace "messages"');
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
  });

  it('disposes the spool and the tool id index when a row fails mid-body', async () => {
    let readers = 0;
    const failing = {
      ...rowsSelection(HISTORY),
      openReader(signal?: AbortSignal) {
        const inner = rowsSelection(HISTORY).openReader(signal);
        const pass = ++readers;
        let seen = 0;
        return (async function* () {
          for await (const row of inner) {
            seen++;
            // Pass 1 completes; the conversion pass dies after two rows.
            if (pass === 2 && seen === 3) {
              throw new Error('row source failed');
            }
            yield row;
          }
        })();
      },
    };
    const options = optionsFor(HISTORY, 'kimi-k2', {}, failing);

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('row source failed');
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
    expect(scratchNames()).toStrictEqual(startingScratch);
  });

  it('writes the dump form beside the body only when dumpcontext asks for it', async () => {
    const withoutDump = await prepare(optionsFor(HISTORY, 'gpt-4o'));
    expect(withoutDump.dump).toBeUndefined();
    const plainScratch = [...scratchNames()].filter(
      (name) => !startingScratch.has(name),
    );
    expect(
      plainScratch.some((name) => name.startsWith('openai-chat-prompt')),
    ).toBe(false);
    releaseAndExpectNothingLeaked();

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
        JSON.stringify(readSpooledChatBody(context.spool)),
      );
      expect(dumped).toStrictEqual(wire);
      expect(context.estimate).toBeUndefined();
      releaseAndExpectNothingLeaked();
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
    releaseAndExpectNothingLeaked();
  });

  it('removes the dump files with the request when a row fails mid-body', async () => {
    const failing = {
      ...rowsSelection(HISTORY),
      openReader(signal?: AbortSignal) {
        const inner = rowsSelection(HISTORY).openReader(signal);
        return (async function* () {
          let seen = 0;
          for await (const row of inner) {
            if (++seen === 3) throw new Error('row source failed');
            yield row;
          }
        })();
      },
    };
    const options = optionsFor(HISTORY, 'gpt-4o', {}, failing, {
      dumpcontext: 'on',
    });

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('row source failed');
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
    expect(scratchNames()).toStrictEqual(startingScratch);
  });

  it('fails without rows instead of sending an empty history', async () => {
    const options = {
      ...optionsFor(HISTORY, 'gpt-4o'),
      requestRows: undefined,
    } as NormalizedGenerateChatOptions;

    await expect(
      prepareRequest(options, 'gpt-4o', undefined, logger, 'openai'),
    ).rejects.toThrow('require a requestRows selection');
    expect(activeWireBodySpoolCount()).toBe(startingSpools);
  });
});
