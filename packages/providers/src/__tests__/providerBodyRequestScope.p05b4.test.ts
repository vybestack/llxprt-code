/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05b4 target contract: where a provider SDK demands a request body array,
 * the transport builds it REQUEST-SCOPED and releases it after the call. The
 * array must not outlive the request; at most one body is in flight per
 * request; release is explicit, idempotent, and fails loudly if consumed
 * after release.
 *
 * RED (missing API): these tests import the pinned `requestScopedBody` seam
 * that the green session implements per
 * tmp/verify854/p05b4/api_sketch.md. The module does not exist at HEAD, so
 * this file fails at load — the sanctioned red mode for a missing contract.
 *
 * WeakRef probe pattern: packages/core/src/recording/SessionRecordingService.test.ts:631
 *
 * @plan:PLAN-20260917-ISSUE854.P05b4
 * @requirement:G6
 */

import { describe, expect, it } from 'bun:test';
import {
  acquireRequestScopedBody,
  activeRequestBodyCount,
  withRequestScopedBody,
  type RequestScopedBody,
} from '../utils/requestScopedBody.js';

interface BodyRow {
  readonly payload: string;
  readonly blob: string;
}

function buildBody(rows: readonly BodyRow[]): { rows: BodyRow[] } {
  return { rows: [...rows] };
}

describe('P05b4 request-scoped transport body lease @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  it('reports zero in-flight bodies outside a request', () => {
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('bounds the in-flight body to exactly one during the transport call', async () => {
    const rows: readonly BodyRow[] = [
      { payload: 'row-1', blob: 'x'.repeat(64) },
      { payload: 'row-2', blob: 'y'.repeat(64) },
    ];
    let observedInFlight = -1;
    const result = await withRequestScopedBody(
      'anthropic',
      () => buildBody(rows),
      async (body: RequestScopedBody<{ rows: BodyRow[] }>) => {
        observedInFlight = activeRequestBodyCount();
        expect(body.value.rows.length).toBe(2);
        return 'sent';
      },
    );
    expect(result).toBe('sent');
    expect(observedInFlight).toBe(1);
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('releases the body after the call: arrays are spliced and the payload graph is collectible', async () => {
    const unique = 'release-probe-p05b4';
    let observed: { rows: BodyRow[] } | undefined;
    await withRequestScopedBody(
      'openai-responses',
      () => buildBody([{ payload: unique, blob: 'z'.repeat(8192) }]),
      async (body: RequestScopedBody<{ rows: BodyRow[] }>) => {
        observed = body.value;
        return 'sent';
      },
    );
    // Release must have spliced the wire array even though the consumer's
    // reference to the body object is still in scope here.
    expect(observed?.rows.length).toBe(0);

    // Collectibility claim: a released lease must not pin its payload graph.
    // The probe target is created and released inside a sync frame (the
    // SessionRecordingService.test.ts:631 idiom): bun retains any object that
    // transits an async frame until the test ends, so a WeakRef threaded
    // through the async lease path can never observe collection.
    let probe: WeakRef<object> | undefined;
    const probeLease = (): Promise<void> => {
      const rows: readonly BodyRow[] = [
        { payload: unique, blob: 'z'.repeat(8192) },
      ];
      const lease = acquireRequestScopedBody(
        'openai-responses',
        buildBody(rows),
      );
      probe = new WeakRef<object>(lease.value.rows[0] as object);
      return lease.release();
    };
    await probeLease();
    Bun.gc(true);
    expect(probe?.deref()).toBeUndefined();
  });

  it('releases the body when the consumer throws, and propagates the error', async () => {
    const rows: readonly BodyRow[] = [
      { payload: 'boom-row', blob: 'w'.repeat(64) },
    ];
    await expect(
      withRequestScopedBody(
        'openai',
        () => buildBody(rows),
        async () => {
          throw new Error('transport failed mid-flight');
        },
      ),
    ).rejects.toThrow('transport failed mid-flight');
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('fails fast on consume-after-release and keeps double release idempotent', async () => {
    const rows: readonly BodyRow[] = [
      { payload: 'late-row', blob: 'v'.repeat(64) },
    ];
    let held: RequestScopedBody<{ rows: BodyRow[] }> | undefined;
    await withRequestScopedBody(
      'anthropic',
      () => buildBody(rows),
      async (body: RequestScopedBody<{ rows: BodyRow[] }>) => {
        held = body;
        await body.release();
        expect(() => body.value).toThrow(
          'Request-scoped body consumed after release (issue #854 P05b4)',
        );
        await expect(body.release()).resolves.toBeUndefined();
        return 'sent';
      },
    );
    expect(held).toBeDefined();
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('sequential requests never stack in-flight bodies', async () => {
    const rows: readonly BodyRow[] = [
      { payload: 'seq-row', blob: 'u'.repeat(64) },
    ];
    const peaks: number[] = [];
    for (let request = 0; request < 3; request += 1) {
      await withRequestScopedBody(
        'openai',
        () => buildBody(rows),
        async (body: RequestScopedBody<{ rows: BodyRow[] }>) => {
          peaks.push(activeRequestBodyCount());
          expect(body.value.rows.length).toBe(1);
          return 'sent';
        },
      );
    }
    expect(peaks).toStrictEqual([1, 1, 1]);
    expect(activeRequestBodyCount()).toBe(0);
  });
});
