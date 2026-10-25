/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core';
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

  it('executes a task child without any renderer', async () => {
    const a = await owner('headless', false);
    const run = a.run();
    await a.entered();
    await a.release();
    await run;
    expect(await a.effects()).toStrictEqual(['headless']);
    expect(a.terminateReasons()).toStrictEqual([SubagentTerminateMode.GOAL]);
  });
});
