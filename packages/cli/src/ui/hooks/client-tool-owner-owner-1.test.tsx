/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { type CompletedToolCall } from '@vybestack/llxprt-code-core';

import { cleanup } from '../../__tests__/render.js';
import {
  openClientToolOwner,
  type ClientToolOwner,
  type ClientToolOwnerOptions,
} from '../../__tests__/client-tool-owner-agent-fixture.js';

describe('Agent-owned CLI client tools', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];

  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const release of releases.splice(0)) await release();
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(
    name: string,
    options?: ClientToolOwnerOptions,
  ): Promise<ClientToolOwner> {
    const opened = await openClientToolOwner(name, options);
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('keeps execution completion fixed when rendering observers detach during work', async () => {
    const a = await owner('alpha');
    const completed: CompletedToolCall[][] = [];
    const channel = a.agent.tools.openClientChannel((calls) => {
      completed.push(calls);
    });
    const displayed: CompletedToolCall[][] = [];
    const detach = channel.subscribe({
      onAllToolCallsComplete: (calls) => {
        displayed.push(calls);
      },
    });
    const scheduled = channel.schedule(
      a.request('stable'),
      new AbortController().signal,
    );
    await a.entered();
    detach();
    await a.release();
    await scheduled;
    expect(completed.flat().map((call) => call.request.callId)).toStrictEqual([
      'stable',
    ]);
    expect(displayed).toStrictEqual([]);
    const responses: string[] = [];
    for await (const message of a.agent.streamHistory()) {
      for (const block of message.blocks) {
        if (block.type === 'tool_response') responses.push(block.callId);
      }
    }
    expect(responses).toStrictEqual(['stable']);
    await channel.release();
  }, 30_000);
});
