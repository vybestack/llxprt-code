/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { journalSendFixture } from '../__tests__/support/journal-send-fixture.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import type { ChatHttpBody } from '../utils/chat-http-body.js';
import { withChatHttpBody } from '../utils/chat-http-body.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import type { ContinuationToolCall } from './OpenAIRequestBuilder.js';

const logger = new DebugLogger('native-chat-continuation');
const calls: ContinuationToolCall[] = [
  {
    id: '',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"雪"}' },
  },
  {
    id: 'call_duplicate',
    type: 'function',
    function: { name: 'lookup', arguments: '{}' },
  },
  {
    id: 'call_duplicate',
    type: 'function',
    function: { name: 'lookup', arguments: '{}' },
  },
];
const rows: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] },
  { speaker: 'ai', blocks: [{ type: 'thinking', thought: 'only thought 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'thought 雪' },
      {
        type: 'tool_call',
        id: 'hist_image',
        name: 'read_file',
        parameters: {},
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_image',
        toolName: 'read_file',
        result: 'done',
      },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'AQID',
      },
    ],
  },
];
function options(
  selection: ProviderRequestSelection,
  streaming: boolean,
  strip: string,
  signal?: AbortSignal,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: selection,
    contentCount: selection.count,
    metadata: { abortSignal: signal },
    systemInstruction: 'system 雪',
    invocation: createRuntimeInvocationContext({
      runtimeId: 'native-continuation',
      providerName: 'openai',
      ephemeralsSnapshot: {
        streaming: streaming ? 'enabled' : 'disabled',
        'reasoning.includeInContext': true,
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
function prepare(
  input: NormalizedGenerateChatOptions,
): ReturnType<typeof prepareRequest> {
  return prepareRequest(input, 'gpt-4o', undefined, logger, 'openai');
}
async function bytes(body: ChatHttpBody): Promise<Uint8Array> {
  return withChatHttpBody(body, async (stream, length) => {
    const result = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(result.byteLength).toBe(length);
    return result;
  });
}

describe('captured native plain Chat continuation', () => {
  for (const { streaming, strip } of [false, true].flatMap((streaming) =>
    ['none', 'all', 'allButLast'].map((strip) => ({ streaming, strip })),
  )) {
    it(`preserves old bytes and forces continuation stream=true after initial stream=${streaming}/${strip}`, async () => {
      const pending: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'pending 雪' }] },
      ];
      const fixture = await journalSendFixture(rows, pending, {
        directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
      });
      const old = await prepare(
        options(
          rowsSelection(await normalizedRows([...rows, ...pending])),
          streaming,
          strip,
        ),
      );
      const actual = await prepare(
        options(fixture.selection, streaming, strip),
      );
      try {
        const expected = await old.continuation.build(calls);
        const continued = await actual.continuation.build(calls);
        try {
          expect(await bytes(actual.spool)).toStrictEqual(
            await bytes(old.spool),
          );
          const expectedBytes = await bytes(expected.spool);
          const receipt = await operationFileCreates(async () => {
            expect(await bytes(continued.spool)).toStrictEqual(expectedBytes);
            expect(await bytes(continued.spool)).toStrictEqual(expectedBytes);
          }, true);
          expect(receipt).toStrictEqual({ files: [], directories: [] });
          const parsed: unknown = JSON.parse(
            new TextDecoder().decode(expectedBytes),
          );
          expect(parsed).toHaveProperty('stream', true);
        } finally {
          await continued.release();
          await expected.release();
        }
      } finally {
        await actual.release();
        await old.release();
        await fixture.close();
      }
    });
  }

  it('keeps a trailing tool-media flush before the current assistant tail', async () => {
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
    });
    const old = await prepare(
      options(rowsSelection(await normalizedRows(rows)), true, 'none'),
    );
    const actual = await prepare(options(fixture.selection, true, 'none'));
    try {
      const expected = await old.continuation.build(calls);
      const continued = await actual.continuation.build(calls);
      try {
        expect(await bytes(continued.spool)).toStrictEqual(
          await bytes(expected.spool),
        );
      } finally {
        await continued.release();
        await expected.release();
      }
    } finally {
      await actual.release();
      await old.release();
      await fixture.close();
    }
  });

  it('releases unsent continuations idempotently and forbids builds after request retirement', async () => {
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
    });
    const actual = await prepare(options(fixture.selection, true, 'none'));
    try {
      const body = await actual.continuation.build(calls);
      await body.release();
      await body.release();
      expect(() => body.spool.openStream()).toThrow('disposed');
      const owned = await actual.continuation.build(calls);
      await Promise.all([actual.release(), actual.release()]);
      expect(() => owned.spool.openStream()).toThrow('disposed');
      await expect(actual.continuation.build(calls)).rejects.toThrow(
        'released',
      );
      const next = await prepare(options(fixture.selection, true, 'none'));
      try {
        expect((await bytes(next.spool)).byteLength).toBeGreaterThan(0);
      } finally {
        await next.release();
      }
    } finally {
      await actual.release();
      await fixture.close();
    }
  });

  it('preserves the abort reason before continuation construction', async () => {
    const controller = new AbortController();
    const failure = new Error('cancel before continuation');
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
    });
    const actual = await prepare(
      options(fixture.selection, true, 'none', controller.signal),
    );
    try {
      controller.abort(failure);
      await expect(actual.continuation.build(calls)).rejects.toBe(failure);
    } finally {
      await actual.release();
      await fixture.close();
    }
  });

  it('awaits a paused continuation reader before request release completes and allows retry after HTTP failure', async () => {
    const fixture = await journalSendFixture(rows, [], {
      directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
    });
    const actual = await prepare(options(fixture.selection, true, 'none'));
    let opened = 0;
    let retired = 0;
    let unblock: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const observed: ProviderRequestSelection = {
      ...fixture.selection,
      native: fixture.selection.native,
      async *openReader(signal) {
        opened++;
        try {
          yield* fixture.selection.openReader(signal);
        } finally {
          await barrier;
          retired++;
        }
      },
    };
    const prepared = await prepare(options(observed, true, 'none'));
    try {
      const body = await prepared.continuation.build(calls);
      const handle = body.spool.openStream();
      const reader = handle.stream.getReader();
      while (opened === 0) expect((await reader.read()).done).toBe(false);
      let done = false;
      const release = Promise.resolve(prepared.release()).then(() => {
        done = true;
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(done).toBe(false);
      expect(retired).toBe(0);
      unblock?.();
      await release;
      expect(retired).toBe(1);
      reader.releaseLock();
      await handle.dispose();
      await body.release();
      const retry = await actual.continuation.build(calls);
      const old = await prepare(
        options(rowsSelection(await normalizedRows(rows)), true, 'none'),
      );
      const expected = await old.continuation.build(calls);
      try {
        const beforeFailure = await bytes(expected.spool);
        const failure = new Error('HTTP failed');
        await expect(
          withChatHttpBody(retry.spool, async (stream) => {
            const reader = stream.getReader();
            await reader.read();
            reader.releaseLock();
            throw failure;
          }),
        ).rejects.toBe(failure);
        expect(await bytes(retry.spool)).toStrictEqual(beforeFailure);
      } finally {
        await expected.release();
        await old.release();
        await retry.release();
      }
    } finally {
      unblock?.();
      await prepared.release();
      await actual.release();
      await fixture.close();
    }
  });
});
