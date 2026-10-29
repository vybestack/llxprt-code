/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  startSourceRouteHarness,
  type SourceRouteHarness,
} from './__tests__/support/source-route-harness.js';

const storedToolCallParent: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'one' }] },
  {
    speaker: 'ai',
    metadata: {
      id: 'resp_parent',
      responsesStored: true,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    },
    blocks: [
      { type: 'text', text: 'calling' },
      {
        type: 'tool_call',
        id: 'hist_call_1',
        name: 'shell',
        parameters: { command: 'ls' },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_call_1',
        toolName: 'shell',
        result: 'file-a',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'two' }] },
];

describe('Responses source route with an active stored parent', () => {
  let harness: SourceRouteHarness;
  beforeEach(async () => {
    harness = await startSourceRouteHarness();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('keeps the real tool result that answers a call held by the stored parent', async () => {
    await harness.sendProjected(
      harness.options(storedToolCallParent, { 'responses-stateful': true }),
    );
    expect(harness.bodies).toHaveLength(1);
    const body = JSON.parse(harness.bodies[0]) as Record<string, unknown>;
    // Bytes captured by running origin/main with the same history: the result
    // of the parent's call is kept even though the call lives server-side.
    expect(body['previous_response_id']).toBe('resp_parent');
    expect(body['input']).toStrictEqual([
      {
        type: 'function_call_output',
        call_id: 'call_hist_call_1',
        output: 'file-a',
      },
      { role: 'user', content: 'two' },
    ]);
  }, 60000);
});
