/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import {
  type CompletedToolCall,
  type ToolCallRequestInfo,
} from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  openClientToolOwner,
  type ClientToolOwner,
} from '../../__tests__/client-tool-owner-agent-fixture.js';
import { cleanup } from '../../__tests__/render.js';

describe('Agent-owned CLI client tools', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const close of closes.splice(0)) await close();
  });

  async function owner(name: string): Promise<ClientToolOwner> {
    const opened = await openClientToolOwner(name);
    closes.push(opened.close);
    return opened.owner;
  }

  function request(callId: string, toolName: string): ToolCallRequestInfo {
    return {
      callId,
      name: toolName,
      args: {},
      isClientInitiated: true,
      prompt_id: callId,
    };
  }

  it('cancels only its client channel and leaves borrowed Config and bus reusable', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    const first = a.hook.result.current[1](
      request('cancelled', a.toolName),
      new AbortController().signal,
    );
    await a.entered();
    act(() => {
      void a.hook.result.current[3]();
    });
    await waitFor(() =>
      expect(a.completed.flat().map((call) => call.status)).toStrictEqual([
        'cancelled',
      ]),
    );
    await a.release();
    await first;
    await a.agent.dispose();
    const adopted = await a.borrow();
    const completed: CompletedToolCall[][] = [];
    const channel = adopted.tools.openClientChannel((calls) => {
      completed.push(calls);
    });
    await channel.schedule(
      request('borrowed-resources', a.toolName),
      new AbortController().signal,
    );
    expect(completed.flat().map((call) => call.status)).toStrictEqual([
      'success',
    ]);
    expect(await a.effects()).toStrictEqual(['alpha', 'alpha']);
    await b.release();
    await act(async () => {
      await b.hook.result.current[1](
        request('peer', b.toolName),
        new AbortController().signal,
      );
    });
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['peer'],
    );
    await channel.release();
  });
});
