/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import {
  borrowWorkspaceMcp,
  type WorkspaceMcpManager,
} from '../workspace-mcp-lifetime.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function manager() {
  const failures = new Map<string, string>();
  const events: string[] = [];
  const discovery = deferred<void>();
  const stopped = deferred<void>();
  const revoked = deferred<void>();
  const port: WorkspaceMcpManager = {
    startConfiguredMcpServers: () => {
      events.push('start');
      return discovery.promise;
    },
    whenDiscoverySettled: () => discovery.promise,
    getDiscoveryFailures: () => failures,
    getMcpInstructions: () => 'healthy instructions',
    getMcpServers: () => ({ healthy: {}, broken: {} }),
    getDiscoveryState: () => MCPDiscoveryState.COMPLETED,
    restart: async () => {},
    restartServer: async () => {},
    reconcileConfiguredMcpServers: async () => {},
    onFolderTrustRevoked: () => {
      events.push('quarantine');
      events.push('revoke');
      return revoked.promise;
    },
    onFolderTrustGained: async () => {},
    stop: () => {
      events.push('stop');
      return stopped.promise;
    },
  };
  return { port, failures, events, discovery, stopped, revoked };
}

describe('agents-owned workspace MCP lifetime', () => {
  it('shares one discovery and one manager for two borrowers of the exact same workspace', async () => {
    const workspace = {};
    const state = manager();
    const first = borrowWorkspaceMcp(workspace, () => state.port);
    const second = borrowWorkspaceMcp(workspace, () => {
      throw new Error('Duplicate manager construction');
    });
    expect(first.surface).toBe(second.surface);
    expect(state.events).toStrictEqual(['start']);

    state.failures.set('broken', 'connection refused');
    state.discovery.resolve();
    expect(await second.surface.awaitDiscoveryGate()).toStrictEqual(
      state.failures,
    );
    expect(second.surface.status().servers).toHaveProperty('healthy');
    expect(second.surface.status().discoveryFailures).toBe(state.failures);

    await first.release();
    expect(first.surface.disposed).toBe(false);
    const finalRelease = second.release();
    expect(state.events).toStrictEqual(['start', 'stop']);
    state.stopped.resolve();
    await finalRelease;
    await second.release();
    expect(state.events.filter((event) => event === 'stop')).toHaveLength(1);
  });

  it('quarantines synchronously on revocation during discovery and starts cancellation before waiting for trust settlement', async () => {
    const state = manager();
    const lease = borrowWorkspaceMcp({}, () => state.port);
    const trustSettled = deferred<void>();
    const transition = lease.surface.transitionTrust(false);
    expect(state.events).toStrictEqual(['start', 'quarantine', 'revoke']);
    const disposal = lease.release(() => trustSettled.promise);
    expect(state.events).toStrictEqual([
      'start',
      'quarantine',
      'revoke',
      'stop',
    ]);
    state.revoked.resolve();
    await transition;
    state.discovery.resolve();
    state.stopped.resolve();
    let finished = false;
    void disposal.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    trustSettled.resolve();
    await disposal;
  });

  it('joins an in-flight trust revocation on final release without a caller-supplied waiter', async () => {
    const state = manager();
    const lease = borrowWorkspaceMcp({}, () => state.port);
    const transition = lease.surface.transitionTrust(false);
    const release = lease.release();
    expect(state.events).toStrictEqual([
      'start',
      'quarantine',
      'revoke',
      'stop',
    ]);
    state.discovery.resolve();
    state.stopped.resolve();
    const result = await Promise.race([
      release.then(() => 'released'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 0)),
    ]);
    expect(result).toBe('waiting');
    state.revoked.resolve();
    await transition;
    await release;
  });

  it('waits for every launched trust transition before reporting a failure on final release', async () => {
    const state = manager();
    const firstTrust = deferred<void>();
    const secondTrust = deferred<void>();
    let revocations = 0;
    const lease = borrowWorkspaceMcp({}, () => ({
      ...state.port,
      onFolderTrustRevoked: () => {
        state.events.push('quarantine', 'revoke');
        revocations++;
        return revocations === 1 ? firstTrust.promise : secondTrust.promise;
      },
    }));
    const firstTransition = lease.surface.transitionTrust(false);
    const secondTransition = lease.surface.transitionTrust(false);
    const failure = new Error('first revocation failed');
    const firstOutcome = firstTransition.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    const release = lease.release();
    expect(state.events).toStrictEqual([
      'start',
      'quarantine',
      'revoke',
      'quarantine',
      'revoke',
      'stop',
    ]);
    const releaseOutcome = release.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    state.discovery.resolve();
    state.stopped.resolve();
    firstTrust.reject(failure);
    expect(await firstOutcome).toBe(failure);
    const beforeSecond = await Promise.race([
      releaseOutcome.then(() => 'finished'),
      new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 0)),
    ]);
    secondTrust.resolve();
    await secondTransition;
    expect(await releaseOutcome).toBe(failure);
    expect(beforeSecond).toBe('waiting');
  });

  it('does not retain a transition when synchronous revocation fails', async () => {
    const state = manager();
    const failure = new Error('quarantine failed');
    const lease = borrowWorkspaceMcp({}, () => ({
      ...state.port,
      onFolderTrustRevoked: () => {
        state.events.push('quarantine');
        throw failure;
      },
    }));
    expect(() => lease.surface.transitionTrust(false)).toThrow(failure);
    const release = lease.release();
    expect(state.events).toStrictEqual(['start', 'quarantine', 'stop']);
    state.discovery.resolve();
    state.stopped.resolve();
    await expect(release).resolves.toBeUndefined();
  });

  it('disposes once under concurrent release, preserves a borrowed workspace, and isolates another workspace', async () => {
    const first = manager();
    const second = manager();
    let disposedA = false;
    let disposedB = false;
    const configA = {
      dispose: () => {
        disposedA = true;
      },
    };
    const configB = {
      dispose: () => {
        disposedB = true;
      },
    };
    const a = borrowWorkspaceMcp(configA, () => first.port);
    const b = borrowWorkspaceMcp(configB, () => second.port);
    first.discovery.resolve();
    second.discovery.resolve();
    const one = a.release();
    const two = a.release();
    expect(first.events).toStrictEqual(['start', 'stop']);
    expect(second.events).toStrictEqual(['start']);
    first.stopped.resolve();
    await Promise.all([one, two]);
    expect(disposedA).toBe(false);
    expect((await b.surface.awaitDiscoveryGate()).size).toBe(0);
    const releaseB = b.release();
    second.stopped.resolve();
    await releaseB;
    expect(second.events).toStrictEqual(['start', 'stop']);
    expect(disposedB).toBe(false);
  });
});
