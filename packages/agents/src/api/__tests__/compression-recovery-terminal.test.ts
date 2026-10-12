/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { runAdapterStatic } from './helpers/eventAdapterStatic.js';
import {
  wrapStream,
  streamContextOverflow,
  streamFinished,
  streamContent,
  streamError,
  streamIdleTimeout,
  streamLoopDetected,
  streamUserCancelled,
} from './helpers/eventHarness.js';

describe('compression recovery terminal events', () => {
  it('reports a completed continuation after an earlier context warning', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamContextOverflow(13000, 12000)),
      wrapStream(streamContent('Continuation completed')),
      wrapStream(streamFinished('stop', 'stop')),
    ]);
    expect(events.filter((event) => event.type === 'done')).toMatchObject([
      { reason: 'stop', finished: { reason: 'stop', stopReason: 'stop' } },
    ]);
  });

  it('retains an unrecovered overflow without a model completion', async () => {
    const events = await runAdapterStatic([
      wrapStream(streamContextOverflow(13000, 12000)),
    ]);
    expect(events.filter((event) => event.type === 'done')).toMatchObject([
      { reason: 'context-overflow' },
    ]);
  });

  it.each([
    { terminal: streamError({ message: 'send failed' }), reason: 'error' },
    { terminal: streamIdleTimeout({ message: 'idle' }), reason: 'error' },
    { terminal: streamLoopDetected(), reason: 'loop-detected' },
    { terminal: streamUserCancelled(), reason: 'aborted' },
  ])(
    'preserves $reason after a context warning and completion',
    async ({ terminal, reason }) => {
      const events = await runAdapterStatic([
        wrapStream(streamContextOverflow(13000, 12000)),
        wrapStream(terminal),
        wrapStream(streamFinished('stop', 'stop')),
      ]);
      expect(events.filter((event) => event.type === 'done')).toMatchObject([
        { reason },
      ]);
    },
  );
});
