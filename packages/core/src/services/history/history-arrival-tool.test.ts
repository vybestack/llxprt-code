/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

describe('incremental tool argument arrival', () => {
  it('preserves provider-normalized JSON when replacing raw arguments', async () => {
    const history = new HistoryService();
    const arrival = await history.openResponseArrival({
      id: 'replace',
      submissionId: 'prompt',
    });
    try {
      await arrival.appendToolArguments({
        sourceId: 'a',
        id: 'call_a',
        name: 'lookup',
        arguments: '{"count":"2"}',
      });
      await arrival.appendToolArguments({
        sourceId: 'a',
        id: 'call_a',
        name: 'lookup',
        arguments: '',
        complete: true,
        replacementArguments: '{"count":2,"path":"a\\nb"}',
      });
      await arrival.seal({});
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows[0].blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: 'call_a',
          name: 'lookup',
          parameters: { count: 2, path: 'a\nb' },
        },
      ]);
    } finally {
      await arrival.interrupt('cancelled');
      await history.dispose();
    }
  });
  it('assembles interleaved source arguments into their original blocks', async () => {
    const history = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'attempt',
        submissionId: 'prompt',
      });
      await arrival.appendToolArguments({
        sourceId: 'a',
        id: 'call_a',
        name: 'first',
        arguments: '{"x":',
      });
      await arrival.appendToolArguments({
        sourceId: 'b',
        id: 'call_b',
        name: 'second',
        arguments: '{"y":2}',
        complete: true,
      });
      await arrival.appendToolArguments({
        sourceId: 'a',
        id: 'call_a',
        name: 'first',
        arguments: '1}',
        complete: true,
      });
      await arrival.seal({});
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows[0].blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: 'call_a',
          name: 'first',
          parameters: { x: 1 },
        },
        {
          type: 'tool_call',
          id: 'call_b',
          name: 'second',
          parameters: { y: 2 },
        },
      ]);
    } finally {
      await history.dispose();
    }
  });
  it('retains invalid raw arguments outside context and rejects completion', async () => {
    const history = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'attempt',
        submissionId: 'prompt',
      });
      await arrival.appendToolArguments({
        sourceId: 'a',
        id: 'call_a',
        name: 'first',
        arguments: '{"x":',
      });
      await expect(
        arrival.appendToolArguments({
          sourceId: 'a',
          id: 'call_a',
          name: 'first',
          arguments: '',
          complete: true,
        }),
      ).rejects.toThrow('Invalid tool call arguments');
      expect(history.length()).toBe(0);
    } finally {
      await history.dispose();
    }
  });
  it('keeps abandoned internal attempts out of the completed response', async () => {
    const history = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'outer',
        submissionId: 'prompt',
      });
      await arrival.appendToolArguments({
        attemptId: 'first',
        sourceId: 'a',
        id: 'call_a',
        name: 'first',
        arguments: '{"x":',
      });
      await arrival.appendToolArguments({
        attemptId: 'retry',
        sourceId: 'a',
        id: 'call_retry',
        name: 'first',
        arguments: '{"x":2}',
        complete: true,
      });
      await arrival.seal({});
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.id).toBe('retry');
      expect(rows[0].blocks).toStrictEqual([
        {
          type: 'tool_call',
          id: 'call_retry',
          name: 'first',
          parameters: { x: 2 },
        },
      ]);
    } finally {
      await history.dispose();
    }
  });
  it('allows a text-only retry after abandoned tool arguments', async () => {
    const history = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'outer',
        submissionId: 'prompt',
      });
      await arrival.appendToolArguments({
        attemptId: 'first',
        sourceId: 'a',
        id: 'call_a',
        name: 'lookup',
        arguments: '{',
      });
      await arrival.selectAttempt('text-retry');
      await arrival.append({ type: 'text', text: 'recovered' });
      await arrival.seal({});
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata?.id).toBe('text-retry');
      expect(rows[0].blocks).toStrictEqual([
        { type: 'text', text: 'recovered' },
      ]);
    } finally {
      await history.dispose();
    }
  });
});
