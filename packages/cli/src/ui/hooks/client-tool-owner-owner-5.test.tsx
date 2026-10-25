/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { cleanup } from '../../__tests__/render.js';
import {
  openClientToolOwner,
  type ClientToolOwner,
  type ClientToolOwnerOptions,
} from '../../__tests__/client-tool-owner-mcp-fixture.js';

function gate() {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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

  it('joins an in-flight completion callback after observers detach', async () => {
    const a = await owner('alpha');
    const entered = gate();
    const finish = gate();
    releases.push(async () => finish.release());
    const completed: string[] = [];
    const channel = a.agent.tools.openClientChannel(async (calls) => {
      completed.push(...calls.map((call) => call.request.callId));
      entered.release();
      await finish.promise;
    });
    const scheduled = channel.schedule(
      a.request('callback'),
      new AbortController().signal,
    );
    await a.entered();
    await a.release();
    await entered.promise;
    let released = false;
    const release = channel.release().then(() => {
      released = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(released).toBe(false);
    finish.release();
    await Promise.all([release, scheduled]);
    expect(completed).toStrictEqual(['callback']);
  }, 30_000);
});
