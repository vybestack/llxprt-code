/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AcquisitionRelease } from './acquisition-release.js';

describe('AcquisitionRelease', () => {
  it('closes the network phase after oauth and before tokens', async () => {
    const release = new AcquisitionRelease();
    const order: string[] = [];
    release.acquire('tokens', () => void order.push('tokens'));
    release.acquire('network', () => void order.push('network'));
    release.acquire('oauth', () => void order.push('oauth'));
    release.acquire('manager', () => void order.push('manager'));

    await release.close();

    expect(order).toStrictEqual(['manager', 'oauth', 'network', 'tokens']);
  });

  it('runs before-release actions once, in order, ahead of every entry on close', async () => {
    const release = new AcquisitionRelease();
    const order: string[] = [];
    release.acquire('files', () => void order.push('entry'));
    release.beforeRelease(() => void order.push('first'));
    release.beforeRelease(() => void order.push('second'));

    await release.close();
    await release.close();

    expect(order).toStrictEqual(['first', 'second', 'entry']);
  });

  it('runs before-release actions ahead of every entry on rollback', async () => {
    const release = new AcquisitionRelease();
    const order: string[] = [];
    release.acquire('files', () => void order.push('files'));
    release.acquire('network', () => void order.push('network'));
    release.beforeRelease(() => void order.push('before'));

    await release.rollback();
    await release.rollback();

    expect(order).toStrictEqual(['before', 'network', 'files']);
  });

  it('runs before-release actions synchronously when release starts', () => {
    const release = new AcquisitionRelease();
    const order: string[] = [];
    release.beforeRelease(() => void order.push('before'));

    const closing = release.close();

    expect(order).toStrictEqual(['before']);
    return closing;
  });

  it('still runs every entry when a before-release action throws and rethrows that error alone', async () => {
    const release = new AcquisitionRelease();
    const order: string[] = [];
    const failure = new Error('abort failed');
    release.beforeRelease(() => {
      throw failure;
    });
    release.acquire('files', () => void order.push('files'));
    release.acquire('network', () => void order.push('network'));

    await expect(release.close()).rejects.toBe(failure);

    expect(order).toStrictEqual(['files', 'network']);
  });

  it('reports a before-release failure together with entry failures', async () => {
    const release = new AcquisitionRelease();
    const beforeFailure = new Error('before failed');
    const entryFailure = new Error('entry failed');
    release.beforeRelease(() => {
      throw beforeFailure;
    });
    release.acquire('network', () => {
      throw entryFailure;
    });

    const error = await release.rollback().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toStrictEqual([
      beforeFailure,
      entryFailure,
    ]);
  });

  it('rejects before-release registration after the owner is closed', async () => {
    const release = new AcquisitionRelease();
    await release.close();

    expect(() => release.beforeRelease(() => undefined)).toThrow(
      'Acquisition owner is closed',
    );
  });
});
