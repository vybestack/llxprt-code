import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import type { WorkspaceTrustTransition } from '@vybestack/llxprt-code-core/services/workspace-trust-transition.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('Explicit workspace trust lifetime', () => {
  it('preserves IDE precedence without borrowing another workspace snapshot', async (): Promise<void> => {
    const first = new WorkspaceTrustLifecycle({
      localTrust: false,
      ideTrust: true,
    });
    const peer = new WorkspaceTrustLifecycle({
      localTrust: true,
      ideTrust: false,
    });
    await first.setTrustedFolderLive(false);
    expect(first.isTrustedFolder()).toBe(true);
    expect(peer.isTrustedFolder()).toBe(false);
    await first.setIdeTrustLive(undefined);
    expect(first.isTrustedFolder()).toBe(false);
    await peer.setIdeTrustLive(undefined);
    expect(peer.isTrustedFolder()).toBe(true);
    await Promise.all([first.dispose(), peer.dispose()]);
  });

  it('publishes effective admission immediately despite blocked asynchronous settlement and ignores redundant writes', async (): Promise<void> => {
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const entered = deferred();
    const release = deferred();
    const admissions: boolean[] = [];
    const unsubscribe = trust.subscribeTrustChange((transition) => {
      admissions.push(transition.trusted);
    });
    trust.subscribeTrustTransition(async (): Promise<void> => {
      entered.resolve();
      await release.promise;
    });
    const grant = trust.setTrustedFolderLive(true);
    await entered.promise;
    const deny = trust.setTrustedFolderLive(false);
    expect(trust.isTrustedFolder()).toBe(false);
    expect(admissions).toStrictEqual([true, false]);
    const duplicate = trust.setTrustedFolderLive(false);
    expect(admissions).toStrictEqual([true, false]);
    release.resolve();
    await Promise.all([grant, deny, duplicate]);
    unsubscribe();
    await trust.dispose();
  });

  it('rejects publication from an earlier grant after denial and regrant', async (): Promise<void> => {
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const entered = deferred();
    const release = deferred();
    const publications: number[] = [];
    const results: boolean[] = [];
    trust.subscribeTrustTransition(async (transition): Promise<void> => {
      if (!transition.trusted) return;
      entered.resolve();
      await release.promise;
      results.push(
        transition.commitIfCurrent(() => {
          publications.push(transition.generation);
        }),
      );
    });
    const first = trust.setTrustedFolderLive(true);
    await entered.promise;
    const denial = trust.setTrustedFolderLive(false);
    const next = trust.setTrustedFolderLive(true);
    release.resolve();
    await Promise.all([first, denial, next]);
    expect(results).toStrictEqual([false, true]);
    expect(publications).toHaveLength(1);
    await trust.dispose();
  });

  it('joins both accepted transitions when disposed while settlement is blocked', async (): Promise<void> => {
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const entered = deferred();
    const release = deferred();
    const settled: boolean[] = [];
    trust.subscribeTrustTransition(async (transition): Promise<void> => {
      entered.resolve();
      await release.promise;
      settled.push(transition.trusted);
    });
    const grant = trust.setTrustedFolderLive(true);
    await entered.promise;
    const denial = trust.setTrustedFolderLive(false);
    let disposed = false;
    const closing = trust.dispose().then(() => {
      disposed = true;
    });
    expect(disposed).toBe(false);
    await expect(trust.setTrustedFolderLive(true)).rejects.toThrow('disposed');
    release.resolve();
    await Promise.all([grant, denial, closing]);
    expect(settled).toStrictEqual([true, false]);
  });

  it('retains synchronous subscriber errors alongside asynchronous failures', async (): Promise<void> => {
    const trust = new WorkspaceTrustLifecycle();
    const admissionFailure = new Error('frontend failed');
    const settlementFailure = new Error('policy settlement failed');
    trust.subscribeTrustChange(() => {
      throw admissionFailure;
    });
    trust.subscribeTrustTransition(async (): Promise<void> => {
      throw settlementFailure;
    });
    const errors: unknown[] = [];
    try {
      await trust.setTrustedFolderLive(false);
    } catch (error) {
      if (!(error instanceof AggregateError)) throw error;
      errors.push(...error.errors);
    }
    expect(errors).toContain(admissionFailure);
    expect(errors).toContain(settlementFailure);
    await expect(trust.whenSettled()).rejects.toBeInstanceOf(AggregateError);
    await trust.dispose();
  });

  it('releases only a borrowed subscriber without retiring caller trust or peer listeners', async (): Promise<void> => {
    const trust = new WorkspaceTrustLifecycle();
    const first: WorkspaceTrustTransition[] = [];
    const peer: WorkspaceTrustTransition[] = [];
    const unsubscribe = trust.subscribeTrustChange((transition) => {
      first.push(transition);
    });
    trust.subscribeTrustChange((transition) => {
      peer.push(transition);
    });
    await trust.setTrustedFolderLive(false);
    unsubscribe();
    await trust.setTrustedFolderLive(true);
    expect(first).toHaveLength(1);
    expect(peer).toHaveLength(2);
    expect(trust.isTrustedFolder()).toBe(true);
    await trust.dispose();
  });
  it('joins the admitted physical transition even when a synchronous revocation subscriber retires trust', async (): Promise<void> => {
    const directory = await mkdtemp(join(tmpdir(), 'trust-reentrant-close-'));
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    let closing: Promise<void> | undefined;
    trust.subscribeTrustRevocation(() => {
      closing = trust.dispose();
    });
    trust.subscribeTrustTransition(async (transition): Promise<void> => {
      await writeFile(
        join(directory, 'admitted'),
        String(transition.generation),
      );
      transition.commitIfCurrent(() =>
        writeFileSync(join(directory, 'late'), 'unauthorized'),
      );
    });
    try {
      await trust.setTrustedFolderLive(false);
      await closing;
      expect(existsSync(join(directory, 'admitted'))).toBe(true);
      expect(
        Number(await readFile(join(directory, 'admitted'), 'utf8')),
      ).toBeGreaterThan(0);
      expect(existsSync(join(directory, 'late'))).toBe(false);
      await expect(trust.setTrustedFolderLive(true)).rejects.toThrow(
        'disposed',
      );
    } finally {
      await trust.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
