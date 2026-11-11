/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';

import { cleanup } from '../../__tests__/render.js';
import {
  openChildToolOwner,
  type ChildToolDecision,
  type ChildToolOwner,
} from '../../__tests__/child-tool-owner-agent-fixture.js';

const APPROVAL_READY_TIMEOUT_MS = 30_000;

describe('Mounted CLI child execution ownership', () => {
  const cleanupOwners: Array<() => Promise<void>> = [];

  const releases: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const release of releases.splice(0)) await release();
    for (const dispose of cleanupOwners.splice(0).reverse()) await dispose();
  });

  async function owner(
    name: string,
    mounted = true,
    decision: ChildToolDecision = 'allow',
  ): Promise<ChildToolOwner> {
    const opened = await openChildToolOwner(name, mounted, { decision });
    cleanupOwners.push(opened.close);
    releases.push(opened.owner.release);
    return opened.owner;
  }

  it('routes equal child call IDs to independent approval buses and honors each owner policy', async () => {
    const a = await owner('approve', true, 'ask');
    const b = await owner('deny', true, 'ask');
    let runA!: Promise<void>;
    let runB!: Promise<void>;
    act(() => {
      runA = a.run();
      runB = b.run();
    });
    const waiting = (value: ChildToolOwner) =>
      value.hook?.result.current[0].find(
        (call) => call.request.callId === 'same-child-call',
      );
    // Each owner starts a real stdio MCP server and child agent before its
    // approval is raised; that takes about a second, which is the default
    // waitFor budget. The bound only decides when a missing approval is
    // reported as a failure.
    await waitFor(
      () => {
        expect(waiting(a)?.status).toBe('awaiting_approval');
        expect(waiting(b)?.status).toBe('awaiting_approval');
      },
      { timeout: APPROVAL_READY_TIMEOUT_MS },
    );
    const approval = waiting(a);
    const denial = waiting(b);
    if (
      approval?.status !== 'awaiting_approval' ||
      denial?.status !== 'awaiting_approval' ||
      !('onConfirm' in approval.confirmationDetails) ||
      !('onConfirm' in denial.confirmationDetails)
    )
      throw new Error('Missing child confirmations');
    const approve = approval.confirmationDetails.onConfirm;
    const deny = denial.confirmationDetails.onConfirm;
    await a.release();
    await act(async () => {
      await approve(ToolConfirmationOutcome.ProceedOnce);
    });
    await runA;
    expect(await a.effects()).toStrictEqual(['approve']);
    expect(await b.effects()).toStrictEqual([]);
    expect(waiting(b)?.status).toBe('awaiting_approval');
    await act(async () => {
      await deny(ToolConfirmationOutcome.Cancel);
      await runB;
    });
    expect(
      b.completed
        .filter((entry) => !entry.primary)
        .flatMap((entry) => entry.calls)
        .map((call) => call.status),
    ).toStrictEqual(['cancelled']);
    const c = await owner('policy-denied', true, 'deny');
    await act(async () => {
      await c.run();
    });
    expect(await c.effects()).toStrictEqual([]);
    expect(
      c.completed
        .filter((entry) => !entry.primary)
        .flatMap((entry) => entry.calls)
        .map((call) => call.status),
    ).toStrictEqual(['error']);
  });
});
