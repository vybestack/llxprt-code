/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core';
import { type Agent } from '@vybestack/llxprt-code-agents';

import { cleanup, renderHook } from '../../__tests__/render.js';
import {
  openChildToolOwner,
  type ChildToolOwner,
} from '../../__tests__/child-tool-owner-agent-fixture.js';
import {
  useChildToolDisplay,
  type SchedulerRefs,
} from '../../runtime/interactiveToolScheduler.js';

function gate() {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const noop = (): void => {};

describe('Mounted CLI child execution ownership', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];

  const finishes: Array<() => void> = [];

  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    finishes.splice(0).forEach((finish) => finish());
    for (const release of releases.splice(0)) await release();
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(name: string, mounted = true): Promise<ChildToolOwner> {
    const opened = await openChildToolOwner(name, mounted, {
      streamingShellText: `${name} streaming child work`,
    });
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('finishes engine work independently of a deferred renderer completion and never updates after unmount', async () => {
    const a = await owner('renderer', false);
    const entered = gate();
    const finishRenderer = gate();
    finishes.push(finishRenderer.release);
    const updates: number[] = [];
    const output: string[] = [];
    const refs: SchedulerRefs = {
      updateToolCallOutput: (_id, _call, update) => {
        if (update.mode === 'append') output.push(update.data);
      },
      replaceToolCallsForScheduler: (_id, calls) => {
        updates.push(calls.length);
      },
      onCompleteRef: {
        current: async () => {
          entered.release();
          await finishRenderer.promise;
        },
      },
      getPreferredEditorRef: { current: () => undefined },
      onEditorCloseRef: { current: noop },
      onEditorOpenRef: { current: noop },
      setLastToolOutputTime: noop,
    };
    const subscribeChildTools: Agent['tools']['subscribeChildTools'] = (
      callbacks,
    ) => a.agent.tools.subscribeChildTools(callbacks);
    const hook = renderHook(() =>
      useChildToolDisplay(subscribeChildTools, refs, noop),
    );
    const run = a.run();
    await a.entered();
    await a.release();
    await entered.promise;
    await run;
    hook.unmount();
    const before = [...updates];
    finishRenderer.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(updates).toStrictEqual(before);
    expect(output.join('')).toContain('renderer streaming child work');
    expect(a.terminateReasons()).toStrictEqual([SubagentTerminateMode.GOAL]);
  });
});
