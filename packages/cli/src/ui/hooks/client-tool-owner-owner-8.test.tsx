/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { type ToolCallRequestInfo } from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  openClientToolOwner,
  type ClientToolOwner,
} from '../../__tests__/client-tool-owner-agent-fixture.js';
import { renderHook, cleanup } from '../../__tests__/render.js';
import {
  useScheduler,
  type SchedulerRefs,
} from '../../runtime/interactiveToolScheduler.js';

function gate() {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const noop = (): void => {};

describe('Agent-owned CLI client tools', () => {
  const closes: Array<() => Promise<void>> = [];

  const releases: Array<() => void> = [];

  afterEach(async () => {
    cleanup();
    releases.splice(0).forEach((release) => release());
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
  it('detaches rendering while joining a pending renderer callback', async () => {
    const a = await owner('alpha');
    const entered = gate();
    const finish = gate();
    releases.push(finish.release);
    const updates: string[][] = [];
    const refs: SchedulerRefs = {
      updateToolCallOutput: noop,
      replaceToolCallsForScheduler: (_id, calls) => {
        updates.push(calls.map((call) => call.request.callId));
      },
      onCompleteRef: {
        current: async () => {
          entered.release();
          await finish.promise;
        },
      },
      getPreferredEditorRef: { current: () => undefined },
      onEditorOpenRef: { current: noop },
      onEditorCloseRef: { current: noop },
      setLastToolOutputTime: noop,
    };
    const id = Symbol('pending-renderer');
    const pending = { current: [] };
    const openClientChannel = () => a.agent.tools.openClientChannel();
    const renderer = renderHook(() =>
      useScheduler(openClientChannel, id, refs, pending),
    );
    await waitFor(() => expect(renderer.result.current).not.toBeNull());
    const handle = renderer.result.current;
    if (handle === null) throw new Error('Missing client channel');
    const scheduled = handle.schedule(
      request('pending-renderer', a.toolName),
      new AbortController().signal,
    );
    await a.entered();
    await a.release();
    await entered.promise;
    renderer.unmount();
    const before = [...updates];
    let disposed = false;
    const disposal = a.agent.dispose().then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(disposed).toBe(false);
    finish.release();
    await Promise.all([disposal, scheduled]);
    expect(updates).toStrictEqual(before);
  });
});
