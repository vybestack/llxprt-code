/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';

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
    const opened = await openChildToolOwner(name, mounted);
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('cancels child work through its owning task signal', async () => {
    const a = await owner('cancel');
    let run!: Promise<void>;
    act(() => {
      run = a.run();
    });
    await a.entered();
    act(() => {
      a.hook?.result.current[3]();
    });
    await act(async () => {
      await run;
    });
    expect(await a.effects()).toStrictEqual(['cancel']);
    expect(
      a.completed
        .flatMap((entry) => entry.calls)
        .some((call) => call.status === 'cancelled'),
    ).toBe(true);
  });
});
