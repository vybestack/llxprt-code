/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  pieces,
  expected,
  runDiskArrival,
} from '../__tests__/tool-arrival-fixture.js';
import { createStreamingState } from './vercelStreamHandler.js';
import { processStreamPart } from './vercelStreamProcessor.js';
import { emitStreamToolCallsAndMetadata } from './vercelMetadataMapper.js';
import { convertToVercelMessages } from './messageConversion.js';
import { createCaptureBuffer } from './vercelReasoningCapture.js';
import type { ReasoningSettings } from './vercelStreamTypes.js';

const settings: ReasoningSettings = {
  enabled: false,
  includeInResponse: false,
  includeInContext: false,
  stripFromContext: 'all',
  format: 'native',
  fieldName: 'reasoning_content',
};

async function* source(
  gate: (index: number) => Promise<void>,
): AsyncGenerator<IContent> {
  const state = createStreamingState();
  const logger = new DebugLogger('test:vercel-arrival');
  yield* processStreamPart(
    { type: 'tool-input-start', id: 'call_frozen', toolName: 'lookup' },
    state,
    settings,
    logger,
  );
  for (let index = 0; index < pieces.length; index++) {
    yield* processStreamPart(
      { type: 'tool-input-delta', id: 'call_frozen', delta: pieces[index] },
      state,
      settings,
      logger,
    );
    await gate(index);
  }
  yield* processStreamPart(
    {
      type: 'tool-call',
      toolCallId: 'call_frozen',
      toolName: 'lookup',
      input: { path: 'a\nb', count: 2 },
    },
    state,
    settings,
    logger,
  );
  yield* emitStreamToolCallsAndMetadata(state, createCaptureBuffer());
}

async function* parallelSource(
  gate: (index: number) => Promise<void>,
): AsyncGenerator<IContent> {
  const state = createStreamingState();
  const logger = new DebugLogger('test:vercel-parallel');
  for (const id of ['call_first', 'call_second']) {
    yield* processStreamPart(
      { type: 'tool-input-start', id, toolName: 'lookup' },
      state,
      settings,
      logger,
    );
  }
  for (let index = 0; index < pieces.length; index++) {
    for (const id of ['call_first', 'call_second'])
      yield* processStreamPart(
        { type: 'tool-input-delta', id, delta: pieces[index] },
        state,
        settings,
        logger,
      );
    await gate(index);
    yield* processStreamPart(
      { type: 'text-delta', text: String(index) },
      state,
      settings,
      logger,
    );
  }
  for (const toolCallId of ['call_second', 'call_first'])
    yield* processStreamPart(
      {
        type: 'tool-call',
        toolCallId,
        toolName: 'lookup',
        input: expected.parameters,
      },
      state,
      settings,
      logger,
    );
  yield* emitStreamToolCallsAndMetadata(state, createCaptureBuffer());
}

describe('parallel Vercel arrival order', () => {
  it('seals interleaved arguments in legacy completion order after streamed text', async () => {
    const blocks = await runDiskArrival(parallelSource, false);
    expect(blocks).toStrictEqual([
      { type: 'text', text: '012' },
      { ...expected, id: 'hist_tool_second' },
      { ...expected, id: 'hist_tool_first' },
    ]);
    expect(convertToVercelMessages([{ speaker: 'ai', blocks }])).toStrictEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '012' },
          {
            type: 'tool-call',
            toolCallId: 'call_second',
            toolName: 'lookup',
            input: expected.parameters,
          },
          {
            type: 'tool-call',
            toolCallId: 'call_first',
            toolName: 'lookup',
            input: expected.parameters,
          },
        ],
      },
    ]);
  });
  it('rejects retention of interleaved parallel arguments', async () => {
    await expect(runDiskArrival(parallelSource, true)).rejects.toThrow(
      'Argument disk-progress gate failed',
    );
  });
});

describe('Vercel tool argument disk arrival', () => {
  it('rejects exhausted input without a completed SDK tool call', () => {
    const state = createStreamingState();
    const logger = new DebugLogger('test:vercel-incomplete');
    processStreamPart(
      { type: 'tool-input-start', id: 'call_pending', toolName: 'lookup' },
      state,
      settings,
      logger,
    );
    processStreamPart(
      { type: 'tool-input-delta', id: 'call_pending', delta: '{}' },
      state,
      settings,
      logger,
    );

    expect(() =>
      Array.from(emitStreamToolCallsAndMetadata(state, createCaptureBuffer())),
    ).toThrow('without a completed tool call');
  });
  it('records SDK argument deltas before completion and seals frozen parity', async () => {
    expect(await runDiskArrival(source, false)).toStrictEqual([
      { ...expected, id: 'hist_tool_frozen' },
    ]);
  });
  it('rejects a retaining SDK control', async () => {
    await expect(runDiskArrival(source, true)).rejects.toThrow(
      'Argument disk-progress gate failed',
    );
  });
});
