/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { waitFor } from '@vybestack/llxprt-code-test-utils';

import { cleanup } from '../../__tests__/render.js';
import {
  openChildToolOwner,
  type ChildToolOwner,
} from '../../__tests__/child-tool-owner-agent-fixture.js';

describe('Mounted CLI child execution ownership', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];

  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const release of releases.splice(0)) await release();
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(name: string, mounted = true): Promise<ChildToolOwner> {
    const opened = await openChildToolOwner(name, mounted, {
      outputText: `${name} child display`,
    });
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  const displayedChildAgentId = (value: ChildToolOwner): string | undefined =>
    value.hook?.result.current[0].find(
      (call) => call.request.callId === 'same-child-call',
    )?.request.agentId;

  it('displays actual child owners once, isolates equal labels, and keeps B alive after A detaches and disposes', async () => {
    const a = await owner('A');
    const b = await owner('B');
    let runA!: Promise<void>;
    let runB!: Promise<void>;
    act(() => {
      runA = a.run();
      runB = b.run();
    });
    await Promise.all([a.entered(), b.entered()]);
    await waitFor(() =>
      expect(
        a.hook?.result.current[0].some(
          (call) => call.request.callId === 'same-child-call',
        ),
      ).toBe(true),
    );
    await waitFor(() => {
      expect(displayedChildAgentId(a)).toBeDefined();
      expect(displayedChildAgentId(b)).toBeDefined();
    });
    const displayedA = displayedChildAgentId(a);
    const displayedB = displayedChildAgentId(b);
    if (displayedA === undefined || displayedB === undefined)
      throw new Error('Missing displayed child owners');
    expect(displayedA).not.toBe(displayedB);
    a.hook?.unmount();
    await a.agent.dispose();
    await runA;
    b.hook?.rerender();
    await b.release();
    await act(async () => {
      await runB;
    });
    await waitFor(() =>
      expect(b.completed.some((entry) => !entry.primary)).toBe(true),
    );
    expect(b.childAgentIds()).toStrictEqual([displayedB]);
    expect(await a.effects()).toStrictEqual(['A']);
    expect(await b.effects()).toStrictEqual(['B']);
    expect(a.completed.filter((entry) => !entry.primary)).toStrictEqual([]);
    const childCalls = b.completed
      .filter((entry) => !entry.primary)
      .flatMap((entry) => entry.calls);
    expect(
      childCalls.map((call) => [call.status, call.response.resultDisplay]),
    ).toStrictEqual([['success', 'B child display:undefined']]);
  });
});
