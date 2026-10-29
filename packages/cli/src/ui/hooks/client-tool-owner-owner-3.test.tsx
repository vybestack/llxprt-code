/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { PolicyDecision } from '@vybestack/llxprt-code-core';

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

  it('keeps policy denial local to its Agent', async () => {
    const a = await owner('denied', { decision: PolicyDecision.DENY });
    const b = await owner('allowed');
    await b.release();
    await act(async () => {
      await a.hook.result.current[1](
        a.request('denied'),
        new AbortController().signal,
      );
      await b.hook.result.current[1](
        b.request('allowed'),
        new AbortController().signal,
      );
    });
    expect(await a.effects()).toStrictEqual([]);
    expect(a.completed.flat().map((call) => call.status)).toStrictEqual([
      'error',
    ]);
    expect(await b.effects()).toStrictEqual(['allowed']);
    expect(b.completed.flat().map((call) => call.status)).toStrictEqual([
      'success',
    ]);
  }, 30_000);
});
