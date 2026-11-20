/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior of the proxy sidecar watch (#3573 review round 6): an unasked
 * sidecar exit is recorded whenever it happens, including before any sandbox
 * child exists, and an intended stop is never reported as a failure.
 */

import { describe, expect, it } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  watchProxyContainer,
  type ProxyContainerHandle,
} from './sandbox-containers.js';

function fakeSidecar(): {
  readonly handle: ProxyContainerHandle;
  readonly process: EventEmitter;
  stop(): void;
} {
  const process = new EventEmitter();
  let stopRequested = false;
  return {
    handle: {
      process: process as unknown as ChildProcess,
      command: 'docker run proxy',
      isStopRequested: () => stopRequested,
    },
    process,
    stop: () => {
      stopRequested = true;
    },
  };
}

function fakeChild(): {
  readonly child: ChildProcess;
  readonly kills: string[];
} {
  const kills: string[] = [];
  const child = {
    kill: (signal: string) => {
      kills.push(signal);
      return true;
    },
  } as unknown as ChildProcess;
  return { child, kills };
}

describe('watchProxyContainer', () => {
  it('records an unasked exit that happens before a sandbox child exists', () => {
    const sidecar = fakeSidecar();
    const watch = watchProxyContainer(sidecar.handle);

    sidecar.process.emit('close', 137, null);

    expect(() => watch.throwIfFailed()).toThrowError(FatalSandboxError);
    expect(() => watch.throwIfFailed()).toThrowError(
      "Proxy container command 'docker run proxy' exited with code 137",
    );
  });

  it('ends a sandbox child attached after the sidecar already failed', () => {
    const sidecar = fakeSidecar();
    const watch = watchProxyContainer(sidecar.handle);
    sidecar.process.emit('close', 1, null);
    const { child, kills } = fakeChild();

    watch.endOnFailure(child);

    expect(kills).toStrictEqual(['SIGTERM']);
  });

  it('ends an attached sandbox child when the sidecar fails later', () => {
    const sidecar = fakeSidecar();
    const watch = watchProxyContainer(sidecar.handle);
    const { child, kills } = fakeChild();
    watch.endOnFailure(child);
    expect(kills).toStrictEqual([]);

    sidecar.process.emit('close', 1, null);

    expect(kills).toStrictEqual(['SIGTERM']);
  });

  it('treats an intended stop as no failure and leaves the child alone', () => {
    const sidecar = fakeSidecar();
    const watch = watchProxyContainer(sidecar.handle);
    const { child, kills } = fakeChild();
    watch.endOnFailure(child);

    sidecar.stop();
    sidecar.process.emit('close', 143, 'SIGTERM');

    expect(() => watch.throwIfFailed()).not.toThrow();
    expect(kills).toStrictEqual([]);
  });

  it('reports nothing for a launch without a sidecar', () => {
    const watch = watchProxyContainer(undefined);
    const { child, kills } = fakeChild();

    watch.endOnFailure(child);

    expect(() => watch.throwIfFailed()).not.toThrow();
    expect(kills).toStrictEqual([]);
  });
});
