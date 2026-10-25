/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { PolicyDecision } from '@vybestack/llxprt-code-core';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
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

  it('routes equal-call-id confirmations to their own bus', async () => {
    const a = await owner('alpha', { decision: PolicyDecision.ASK_USER });
    const b = await owner('beta', { decision: PolicyDecision.ASK_USER });
    act(() => {
      void a.hook.result.current[1](
        a.request('same-id'),
        new AbortController().signal,
      );
      void b.hook.result.current[1](
        b.request('same-id'),
        new AbortController().signal,
      );
    });
    await waitFor(() => {
      expect(a.hook.result.current[0][0]?.status).toBe('awaiting_approval');
      expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    });
    const approval = a.hook.result.current[0][0];
    if (
      approval.status !== 'awaiting_approval' ||
      !('onConfirm' in approval.confirmationDetails)
    )
      throw new Error('Missing confirmation');
    const approve = approval.confirmationDetails.onConfirm;
    await a.release();
    await act(async () => {
      await approve(ToolConfirmationOutcome.ProceedOnce);
    });
    await waitFor(() => expect(a.completed).toHaveLength(1));
    expect(await a.effects()).toStrictEqual(['alpha']);
    expect(await b.effects()).toStrictEqual([]);
    expect(b.hook.result.current[0][0]?.status).toBe('awaiting_approval');
    const denial = b.hook.result.current[0][0];
    if (
      denial.status !== 'awaiting_approval' ||
      !('onConfirm' in denial.confirmationDetails)
    )
      throw new Error('Missing second confirmation');
    const deny = denial.confirmationDetails.onConfirm;
    await act(async () => {
      await deny(ToolConfirmationOutcome.Cancel);
    });
    await waitFor(() => expect(b.completed).toHaveLength(1));
    expect(b.completed[0]?.[0]?.status).toBe('cancelled');
  }, 30_000);
});
