/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core';
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
    const opened = await openChildToolOwner(name, mounted);
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('detaches mounted child display during deferred work without replacing execution completion', async () => {
    const a = await owner('detached');
    const b = await owner('peer');
    let run!: Promise<void>;
    act(() => {
      run = a.run(true);
    });
    await a.entered();
    await waitFor(() =>
      expect(
        a.hook?.result.current[0].some(
          (call) => call.request.callId === 'same-child-call',
        ),
      ).toBe(true),
    );
    await b.agent.dispose();
    a.hook?.unmount();
    await a.release();
    await run;
    expect(a.terminateReasons()).toStrictEqual([SubagentTerminateMode.GOAL]);
    expect(await a.effects()).toStrictEqual(['detached']);
    expect(a.completed).toStrictEqual([]);
  });
});
