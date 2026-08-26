/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { createCpResultPromise } from './shellCpExecution.js';

/**
 * Heap-retention regression coverage for the child_process execution path of
 * issue #3329: once an execution completes while its inactivity deadline is
 * still in the future, the per-execution state (inactivity AbortController,
 * abort listener closure, child references, raw collector) must be
 * collectable, and output written just before exit must survive
 * finalization.
 *
 * The child is a fake (EventEmitter + PassThrough streams) driven directly
 * through the production createCpResultPromise, because bun's test runner
 * intermittently drops every event for real detached child_process spawns
 * (verified with a minimal spawn-only repro on Bun 1.3.14; independent of
 * this code). The PTY counterpart lives in shellPtyMemory.bun.test.ts.
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */

const EXECUTION_COUNT = 40;
const RETAINED_CLASS_THRESHOLD = 8;
const INACTIVITY_TIMEOUT_MS = 60_000;

interface FakeChild extends EventEmitter {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => boolean;
}

function buildFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
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

/**
 * Drives one execution through the exact race that lost output before the
 * drain fix: the final stdout chunk is written, then 'exit' fires in the
 * same tick, before the queued 'data' event is delivered.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 * @requirement REQ-3329-03
 */
async function executeFakeChild(
  signal: AbortSignal,
): Promise<{ output: string; exitCode: number | null }> {
  const child = buildFakeChild();
  const promise = createCpResultPromise(
    child as unknown as ChildProcess,
    false,
    () => undefined,
    signal,
    INACTIVITY_TIMEOUT_MS,
    undefined,
  );
  child.stdout.write('hi\n');
  child.emit('exit', 0, null);
  await new Promise((resolve) => setImmediate(resolve));
  child.stdout.end();
  child.stderr.end();
  const result = await waitFor(promise, 'fake child result');
  return { output: result.output, exitCode: result.exitCode };
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

describe('ShellExecutionService completed child_process execution memory (issue #3329)', () => {
  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-02
   * @requirement REQ-3329-03
   */
  it('releases child-process execution state while the inactivity deadline remains in the future', async () => {
    collectGarbage();
    const abortControllerBaseline = countHeapClass('AbortController');
    const uint8ArrayBaseline = countHeapClass('Uint8Array');

    const sharedSignal = new AbortController().signal;
    for (let index = 0; index < EXECUTION_COUNT; index += 1) {
      const { output, exitCode } = await executeFakeChild(sharedSignal);
      expect(output).toContain('hi');
      expect(exitCode).toBe(0);
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
