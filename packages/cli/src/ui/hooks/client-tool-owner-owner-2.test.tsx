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

  it('releases a channel before asynchronous creation without affecting its same-label peer', async () => {
    const a = await owner('alpha');
    const b = await owner('beta');
    const channel = a.agent.tools.openClientChannel();
    const ready = channel.ready.catch((error: unknown) => error);
    await channel.release();
    expect(await ready).toBeInstanceOf(Error);
    await b.release();
    await act(async () => {
      await b.hook.result.current[1](
        b.request('survivor'),
        new AbortController().signal,
      );
    });
    expect(await b.effects()).toStrictEqual(['beta']);
    expect(await a.effects()).toStrictEqual([]);
  }, 30_000);
});
