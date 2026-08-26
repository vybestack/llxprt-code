/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'node:events';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';

/**
 * Heap-retention regression coverage for the PTY execution path of
 * issue #3329: once an execution completes while its inactivity deadline is
 * still in the future, the per-execution state (inactivity AbortController,
 * abort listener closure, headless terminal, raw collector) must be
 * collectable.
 *
 * The real (Bun/native) pty is replaced with a fake via mock.module because
 * sequentially spawning real bun-pty processes in one process wedges the
 * event loop inside native code (pre-existing, independent of #3329; the
 * same seam is used by shellPtySignal.bun.test.ts). The full PTY lifecycle
 * under test — createPtyResultPromise, inactivity timer, teardown — is the
 * production code; only the native process boundary is faked.
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */

interface FakePty extends EventEmitter {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  emitData: (data: string) => void;
  emitExit: (exit: { exitCode: number; signal?: number }) => void;
}

type DataHandler = (data: string) => void;
type ExitHandler = (exit: { exitCode: number; signal?: number }) => void;

let fakePty: FakePty;

await mock.module('../utils/getPty.js', () => ({
  getPty: async () => ({
    module: { spawn: () => fakePty },
    name: 'node-pty',
    supportsBackpressure: true,
  }),
}));

const { ShellExecutionService } = await import('./shellExecutionService.js');

const PTY_EXECUTION_COUNT = 40;
// Calibration: a leaked execution retains exactly one collector array per
// run (delta 40 on pre-fix code). Post-fix residue is ~9 Uint8Arrays from
// bounded @xterm/headless module-level caches. 16 splits the two regimes.
const RETAINED_CLASS_THRESHOLD = 16;
const INACTIVITY_TIMEOUT_MS = 60_000;

function buildFakePty(): FakePty {
  const pty = new EventEmitter() as FakePty;
  let dataHandler: DataHandler = () => undefined;
  let exitHandler: ExitHandler = () => undefined;
  pty.pid = 4242;
  pty.kill = vi.fn();
  pty.onData = vi.fn((handler: DataHandler) => {
    dataHandler = handler;
    return { dispose: vi.fn() };
  });
  pty.onExit = vi.fn((handler: ExitHandler) => {
    exitHandler = handler;
    return { dispose: vi.fn() };
  });
  pty.write = vi.fn();
  pty.resize = vi.fn();
  pty.emitData = (data: string) => dataHandler(data);
  pty.emitExit = (exit: { exitCode: number; signal?: number }) =>
    exitHandler(exit);
  return pty;
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-02 */
function collectGarbage(): void {
  Bun.gc(true);
  Bun.gc(true);
}

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-02 */
function countHeapClass(name: string): number {
  const snapshot = Bun.generateHeapSnapshot();
  // Validate the snapshot layout via a class every JavaScript heap has; a
  // Bun format change must fail loudly instead of silently counting zero.
  if (
    snapshot.nodes.length % 4 !== 0 ||
    snapshot.nodeClassNames.indexOf('Object') < 0
  ) {
    throw new Error(
      'Unexpected heap snapshot encoding; class counts would be unreliable',
    );
  }
  const classIndex = snapshot.nodeClassNames.indexOf(name);
  if (classIndex < 0) {
    return 0;
  }

  let count = 0;
  for (let position = 2; position < snapshot.nodes.length; position += 4) {
    if (snapshot.nodes[position] === classIndex) {
      count += 1;
    }
  }
  return count;
}

function waitFor<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for PTY result'));
    }, 10_000);
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

describe('ShellExecutionService completed PTY execution memory (issue #3329)', () => {
  beforeEach(() => {
    fakePty = buildFakePty();
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-02
   * @requirement REQ-3329-03
   */
  it('releases PTY execution state while the inactivity deadline remains in the future', async () => {
    collectGarbage();
    const abortControllerBaseline = countHeapClass('AbortController');
    const uint8ArrayBaseline = countHeapClass('Uint8Array');

    const sharedSignal = new AbortController().signal;
    for (let index = 0; index < PTY_EXECUTION_COUNT; index += 1) {
      fakePty = buildFakePty();
      const handle = await ShellExecutionService.execute(
        'echo hi',
        process.cwd(),
        () => undefined,
        sharedSignal,
        true,
        {
          showColor: false,
          scrollback: 600000,
          terminalWidth: 80,
          terminalHeight: 24,
          inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
        },
      );
      // Let spawn + handler registration settle before driving the pty.
      await new Promise((resolve) => setImmediate(resolve));
      fakePty.emitData('hi\r\n');
      await new Promise((resolve) => setImmediate(resolve));
      fakePty.emitExit({ exitCode: 0, signal: 0 });

      const result = await waitFor(handle.result);
      expect(result.executionMethod).toBe('node-pty');
      expect(result.output).toContain('hi');
    }

    collectGarbage();
    expect(
      countHeapClass('AbortController') - abortControllerBaseline,
    ).toBeLessThanOrEqual(RETAINED_CLASS_THRESHOLD);
    expect(
      countHeapClass('Uint8Array') - uint8ArrayBaseline,
    ).toBeLessThanOrEqual(RETAINED_CLASS_THRESHOLD);
  }, 60_000);
});
