/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type Anthropic from '@anthropic-ai/sdk';
import { processAnthropicStream } from '@vybestack/llxprt-code-providers/anthropic/AnthropicStreamProcessor.js';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

async function* events(): AsyncGenerator<Anthropic.MessageStreamEvent> {
  yield {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'tool_use',
      id: 'call_a',
      name: 'lookup',
      input: {},
    },
  };
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '{"x":' },
  };
  yield {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'input_json_delta', partial_json: '1}' },
  };
  yield { type: 'content_block_stop', index: 0 };
  yield {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: {
      output_tokens: 4,
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: null,
    },
  };
  yield { type: 'message_stop' };
}

async function responseBlock(
  path: string,
): Promise<{ status: number; text: string }> {
  const file = await openJournalReadOnly(path);
  try {
    const reader = new TranscriptReader(file, sha256KeyHash);
    const entries = await reader.page({ direction: 'forward', limit: 10 });
    const response = entries.find((entry) => entry.attemptRef !== 0);
    if (response === undefined) throw new Error('Missing response arrival');
    let text = '';
    for await (const block of reader.blocks(response))
      for await (const part of block.parts())
        text += new TextDecoder().decode(part);
    return { status: response.status, text };
  } finally {
    await file.close();
  }
}

async function finishToolStream(
  stream: AsyncGenerator<unknown>,
  complete: boolean,
): Promise<void> {
  if (!complete) {
    await stream.return(undefined);
    return;
  }
  for await (const _chunk of stream) {
    /* Drain through terminal usage. */
  }
}

describe('production tool argument recording', () => {
  const root = sourceRootSetup();
  for (const complete of [false, true]) {
    it(`records raw provider pieces before another pull (complete=${complete})`, async () => {
      const setup = await processorFixture(
        root(),
        'http://127.0.0.1:1/v1',
        false,
        0,
      );
      setup.provider.generateChatCompletion = () =>
        processAnthropicStream(events(), {
          isOAuth: false,
          tools: undefined,
          unprefixToolName: (name) => name,
          findToolSchema: () => undefined,
          logger: { debug: () => undefined },
          cacheLogger: { debug: () => undefined },
          rateLimitLogger: { debug: () => undefined },
          includeThinkingInResponse: true,
        });
      const recording = createSessionRecorder({
        sessionId: 'tool-arrival',
        projectHash: 'tool-arrival',
        chatsDir: root(),
        workspaceDirs: [],
        provider: 'test',
        model: 'gpt-5.6',
      });
      await setup.history.attachJournal(recording);
      const stream = await setup.processor.makeApiCallAndProcessStream(
        { message: 'test', config: {} },
        'submission',
        sourcePending,
      );
      try {
        await Bun.sleep(100);
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing recording');
        const pending = await responseBlock(path);
        expect(pending.status).toBe(0);
        expect(pending.text).toContain('"parameters":{"x":');
        await finishToolStream(stream, complete);
        const terminal = await responseBlock(path);
        expect(terminal.status).toBe(complete ? 1 : 2);
        expect(terminal.text).toBe(
          complete ? pending.text.replace('"x":}', '"x":1}}') : pending.text,
        );
      } finally {
        await stream.return(undefined);
        await setup.history.dispose();
        await recording.dispose();
        await setup.config.dispose();
      }
    });
  }
});
