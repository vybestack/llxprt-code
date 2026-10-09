/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

export interface MockTunnelProcess extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: Mock<(signal?: NodeJS.Signals | number) => boolean>;
}

export function createMockTunnelProcess(
  exitCode: number | null = null,
): MockTunnelProcess {
  const fakeProcess = new EventEmitter() as MockTunnelProcess;
  let closed = false;
  const close = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (closed) return;
    closed = true;
    fakeProcess.exitCode = code;
    fakeProcess.signalCode = signal;
    fakeProcess.stdout.end();
    fakeProcess.stderr.end();
    fakeProcess.emit('exit', code, signal);
    fakeProcess.emit('close', code, signal);
  };

  fakeProcess.pid = 99999;
  fakeProcess.exitCode = exitCode;
  fakeProcess.signalCode = null;
  fakeProcess.stdout = new PassThrough();
  fakeProcess.stderr = new PassThrough();
  fakeProcess.kill = vi.fn((signal: NodeJS.Signals | number = 'SIGTERM') => {
    const signalCode = typeof signal === 'string' ? signal : 'SIGTERM';
    close(null, signalCode);
    return true;
  });
  if (exitCode !== null) {
    queueMicrotask(() => close(exitCode, null));
  }

  return fakeProcess;
}
