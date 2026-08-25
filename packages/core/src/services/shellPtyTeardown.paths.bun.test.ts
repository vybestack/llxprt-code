/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'node:events';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from 'bun:test';
import type { ShellExecutionResult } from './shellExecutionTypes.js';

/**
 * Deterministic teardown coverage for the PTY resolution paths of
 * issue #3329 that complete without a real PTY exit event: caller abort,
 * overlapping inactivity + abort kill chains, and a late exit event after
 * resolution. These paths must detach the caller abort listener, resolve
 * exactly once, and must never touch the raw collector after teardown.
 *
 * The pty is a fake (same seam as shellPtyMemory.bun.test.ts) and
 * process.kill is mocked so the escalation chains run against mocks only.
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

const mockProcessKill = vi
  .spyOn(process, 'kill')
  .mockImplementation(() => true);

/** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-03 */
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * AbortSignal is an EventTarget without listenerCount, so track the
 * function listeners production registers/detaches by intercepting the
 * registration APIs. Once-listeners deregister themselves when they fire.
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-02
 */
function trackSignalListeners(controller: AbortController): () => number {
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const registered = new Map<EventListener, EventListener>();
  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    if (typeof listener === 'function') {
      const once = typeof options === 'object' && options.once === true;
      const effective = once
        ? (...args: Parameters<EventListener>) => {
            registered.delete(listener);
            return listener(...args);
          }
        : listener;
      registered.set(listener, effective);
      return originalAdd(type, effective, options);
    }
    return originalAdd(type, listener, options);
  }) as AbortSignal['addEventListener'];
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => {
    if (typeof listener === 'function') {
      const effective = registered.get(listener) ?? listener;
      registered.delete(listener);
      return originalRemove(type, effective);
    }
    return originalRemove(type, listener);
  }) as AbortSignal['removeEventListener'];
  return () => registered.size;
}

function startExecution(
  signal: AbortSignal,
  inactivityTimeoutMs: number,
): Promise<{ result: Promise<ShellExecutionResult> }> {
  return ShellExecutionService.execute(
    'echo hi',
    process.cwd(),
    () => undefined,
    signal,
    true,
    {
      showColor: false,
      scrollback: 600000,
      terminalWidth: 80,
      terminalHeight: 24,
      inactivityTimeoutMs,
    },
  ).then((handle) => ({ result: handle.result }));
}

function waitFor<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}`));
    }, 5_000);
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

describe('PTY teardown paths without a real exit event (issue #3329)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessKill.mockClear();
    mockProcessKill.mockImplementation(() => true);
    fakePty = buildFakePty();
  });

  afterEach(() => {
    // Do NOT restore the process.kill spy between tests: restoring
    // detaches it permanently and later mockImplementation calls become
    // no-ops, letting real process.kill(-pid, ...) signals escape. The
    // spy stays installed for this file's lifetime.
    mockProcessKill.mockClear();
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-02
   */
  it('removes the caller abort listener on synthetic inactivity resolution', async () => {
    const caller = new AbortController();
    const listenerCount = trackSignalListeners(caller);
    // The caller signal never aborts here, so its once-listener cannot
    // self-remove; only explicit teardown may detach it. Pre-fix, the
    // listener stayed registered and retained the whole execution state.
    const { result } = await startExecution(caller.signal, 30);
    await tick();
    fakePty.emitData('hi\r\n');

    const resolved = await waitFor(result, 'inactivity resolution');
    expect(resolved.output).toContain('hi');
    expect(listenerCount()).toBe(0);

    // A late real exit must not throw into the collected-null raw collector
    // nor resolve a second time; an uncaught error fails the test run.
    fakePty.emitExit({ exitCode: 0, signal: 0 });
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-03
   */
  it('stays silent when a late caller abort and exit outlive the resolution', async () => {
    const caller = new AbortController();
    const listenerCount = trackSignalListeners(caller);
    const { result } = await startExecution(caller.signal, 30);
    await tick();
    fakePty.emitData('hi\r\n');

    // The inactivity chain resolves first. A promise settles exactly once
    // by construction, so this test targets what a second internal
    // finalize would actually break: post-teardown state access. A late
    // abort chain and a late exit must not throw into the collected-null
    // raw collector, re-render, or leave listeners behind.
    const resolved = await waitFor(result, 'inactivity-first resolution');
    expect(resolved.output).toContain('hi');

    caller.abort();
    await new Promise((resolve) => setTimeout(resolve, 450));
    fakePty.emitExit({ exitCode: 0, signal: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(listenerCount()).toBe(0);
  });

  /**
   * @plan PLAN-20260825-SHELLMEM.P01
   * @requirement REQ-3329-02
   */
  it('detaches the exit-race abort listener when a fallback resolves first', async () => {
    const caller = new AbortController();
    const listenerCount = trackSignalListeners(caller);
    const { result } = await startExecution(caller.signal, 30);
    await tick();
    fakePty.emitData('hi\r\n');

    // Inactivity fires at ~30ms and arms the kill-chain fallback (~430ms).
    // A real exit then arrives with the fallback still armed and the final
    // write's processing pending (data and exit are emitted back-to-back),
    // so ptyExitRace registers its temporary listener on the caller
    // signal. Whichever path resolves, teardown must leave no listener:
    // the race either settles naturally or teardown invokes the stored
    // exitRaceCleanup detacher.
    await new Promise((resolve) => setTimeout(resolve, 100));
    fakePty.emitData('x');
    fakePty.emitExit({ exitCode: 0, signal: 0 });

    const resolved = await waitFor(result, 'fallback-or-exit resolution');
    expect(resolved.output).toContain('hi');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(listenerCount()).toBe(0);
  });
});
