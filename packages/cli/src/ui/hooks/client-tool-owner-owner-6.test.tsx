/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
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

  it('unmounts a UI tree during channel creation without cancelling the other tree', async () => {
    const b = await owner('beta');
    const a = await owner('alpha', { awaitReady: false });
    a.hook.unmount();
    await a.agent.dispose();
    await b.release();
    await act(async () => {
      await b.hook.result.current[1](
        b.request('after-unmount'),
        new AbortController().signal,
      );
    });
    expect(await a.effects()).toStrictEqual([]);
    expect(await b.effects()).toStrictEqual(['beta']);
    expect(b.completed.flat().map((call) => call.request.callId)).toStrictEqual(
      ['after-unmount'],
    );
  }, 30_000);
});
