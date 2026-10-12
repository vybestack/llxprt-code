import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import {
  IdeClient,
  IDEConnectionStatus,
} from '@vybestack/llxprt-code-ide-integration';
import { Config } from '../config/config.js';
import { WorkspaceIdeOwner } from '@vybestack/llxprt-code-core/services/workspace-ide-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function config(): Config {
  return new Config({
    sessionId: 'same-label',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'offline',
  });
}

describe('Explicit workspace IDE ownership', () => {
  it('uses distinct acquired clients for roots sharing the same Config and session label', async (): Promise<void> => {
    const declaration = config();
    const firstTrust = new WorkspaceTrustLifecycle({ localTrust: false });
    const peerTrust = new WorkspaceTrustLifecycle();
    const first = new WorkspaceIdeOwner(declaration, firstTrust, firstTrust);
    const peer = new WorkspaceIdeOwner(declaration, peerTrust, peerTrust);
    await Promise.all([first.initialize(), peer.initialize()]);
    expect(first.getClient()).not.toBe(peer.getClient());
    await first.dispose();
    expect(() => first.getClient()).toThrow('disposed');
    expect(peer.getClient()?.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    await peerTrust.setTrustedFolderLive(false);
    expect(peerTrust.isTrustedFolder()).toBe(false);
    await Promise.all([
      peer.dispose(),
      firstTrust.dispose(),
      peerTrust.dispose(),
      declaration.dispose(),
    ]);
  });

  it('joins a client acquired after admission closes and installs no late trust authority', async (): Promise<void> => {
    const declaration = config();
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const acquired = await IdeClient.create();
    const release = deferred();
    const owner = new WorkspaceIdeOwner(
      declaration,
      trust,
      trust,
      async (): Promise<IdeClient> => {
        await release.promise;
        return acquired;
      },
    );
    const initializing = owner.initialize().then(
      () => undefined,
      (error: unknown) => error,
    );
    let closed = false;
    const closing = owner.dispose().then(() => {
      closed = true;
    });
    expect(closed).toBe(false);
    release.resolve();
    const failure = await initializing;
    expect(failure).toBeInstanceOf(Error);
    if (!(failure instanceof Error))
      throw new Error('Initialization did not reject');
    expect(failure.message).toContain('disposed');
    await closing;
    expect(acquired.getConnectionStatus().status).toBe(
      IDEConnectionStatus.Disconnected,
    );
    await trust.setTrustedFolderLive(true);
    expect(trust.isTrustedFolder()).toBe(true);
    await Promise.all([trust.dispose(), declaration.dispose()]);
  });

  it('retains initialization failure and borrowed trust settlement failures during cleanup', async (): Promise<void> => {
    const declaration = config();
    const trust = new WorkspaceTrustLifecycle({
      localTrust: true,
      ideTrust: false,
    });
    const failure = new Error('trust refresh failed');
    const unsubscribe = trust.subscribeTrustTransition(
      async (): Promise<void> => {
        throw failure;
      },
    );
    const owner = new WorkspaceIdeOwner(declaration, trust, trust);
    await expect(owner.initialize()).rejects.toBe(failure);
    await expect(owner.dispose()).rejects.toBeInstanceOf(AggregateError);
    unsubscribe();
    await trust.setTrustedFolderLive(false);
    expect(trust.isTrustedFolder()).toBe(false);
    await Promise.all([trust.dispose(), declaration.dispose()]);
  });
  it('joins actual client disconnect after listener installation fails and preserves borrowed trust', async (): Promise<void> => {
    const declaration = config();
    const trust = new WorkspaceTrustLifecycle({ localTrust: false });
    const client = await IdeClient.create();
    const registration = new Error('listener installation failed');
    const cleanup = new Error('disconnect cleanup failed');
    const disconnect = client.disconnect.bind(client);
    const listener = vi
      .spyOn(client, 'addTrustChangeListener')
      .mockImplementation(() => {
        throw registration;
      });
    const release = vi
      .spyOn(client, 'disconnect')
      .mockImplementation(async (): Promise<void> => {
        await disconnect();
        throw cleanup;
      });
    const owner = new WorkspaceIdeOwner(
      declaration,
      trust,
      trust,
      async () => client,
    );
    try {
      await expect(owner.initialize()).rejects.toBe(registration);
      const failure = await owner.dispose().catch((error: unknown) => error);
      if (!(failure instanceof AggregateError))
        throw new Error('Missing cleanup aggregate');
      expect(failure.errors).toContain(registration);
      expect(failure.errors).toContain(cleanup);
      await trust.setTrustedFolderLive(true);
      expect(trust.isTrustedFolder()).toBe(true);
    } finally {
      listener.mockRestore();
      release.mockRestore();
      await Promise.allSettled([
        owner.dispose(),
        client.disconnect(),
        trust.dispose(),
        declaration.dispose(),
      ]);
    }
  });

  it('retains physical acquisition failure in disposal without retiring borrowed trust', async (): Promise<void> => {
    const declaration = config();
    const trust = new WorkspaceTrustLifecycle();
    const owner = new WorkspaceIdeOwner(
      declaration,
      trust,
      trust,
      async (): Promise<IdeClient> => {
        await readFile(join(tmpdir(), randomUUID(), 'missing-ide-lease'));
        return IdeClient.create();
      },
    );
    try {
      await expect(owner.initialize()).rejects.toThrow('ENOENT');
      await expect(owner.dispose()).rejects.toBeInstanceOf(AggregateError);
      await trust.setTrustedFolderLive(false);
      expect(trust.isTrustedFolder()).toBe(false);
    } finally {
      await Promise.allSettled([
        owner.dispose(),
        trust.dispose(),
        declaration.dispose(),
      ]);
    }
  });

  it('joins an in-flight trust reconciliation and reports failures from settled ones at disposal', async (): Promise<void> => {
    const declaration = config();
    const client = await IdeClient.create();
    let notify: ((trusted: boolean | undefined) => void) | undefined;
    vi.spyOn(client, 'addTrustChangeListener').mockImplementation(
      (listener): void => {
        notify = listener;
      },
    );
    const failure = new Error('reconciliation failed');
    const held = deferred();
    const calls: Array<boolean | undefined> = [];
    const writer = {
      isTrustedFolder: (): boolean => true,
      setTrustedFolderLive: async (): Promise<void> => {},
      setIdeTrustLive: async (trusted: boolean | undefined): Promise<void> => {
        calls.push(trusted);
        if (calls.length === 2) throw failure;
        if (calls.length === 4) await held.promise;
      },
      whenSettled: async (): Promise<void> => {},
    };
    const owner = new WorkspaceIdeOwner(
      declaration,
      writer,
      writer,
      async (): Promise<IdeClient> => client,
    );
    await owner.initialize();
    if (notify === undefined) throw new Error('Listener was not installed');
    notify(true);
    notify(false);
    notify(true);
    await Promise.resolve();
    expect(calls).toHaveLength(4);
    let closed = false;
    const closing = owner.dispose().then(
      () => undefined,
      (error: unknown) => error,
    );
    void closing.then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    held.resolve();
    const reported = await closing;
    expect(reported).toBeInstanceOf(AggregateError);
    if (!(reported instanceof AggregateError))
      throw new Error('Disposal did not reject');
    expect(reported.errors).toStrictEqual([failure]);
    await declaration.dispose();
  });
});
