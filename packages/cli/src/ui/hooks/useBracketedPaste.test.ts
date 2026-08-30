/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { useBracketedPaste } from './useBracketedPaste.js';

// The terminal escape bytes are emitted through core's writeToStdout, which is
// infrastructure; stub that boundary so the exact bytes can be captured while
// bracketedPaste.ts and the hook run for real.
const realCore = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...realCore,
  writeToStdout: vi.fn(),
}));

import { writeToStdout } from '@vybestack/llxprt-code-core';

/** Bytes routed through core's writeToStdout, in order, for the current test. */
const writtenBytes: string[] = [];

const readWrittenBytes = (): string[] => [...writtenBytes];

type LifecycleSignal = 'exit' | 'SIGINT' | 'SIGTERM';

/** What a clean teardown looks like: nothing new left on any signal. */
const NO_SURVIVING_LISTENERS: Record<LifecycleSignal, unknown[]> = {
  exit: [],
  SIGINT: [],
  SIGTERM: [],
};

/**
 * Listeners present on the lifecycle signals right now, captured by identity.
 *
 * Counting is not enough: the ink test renderer registers its own SIGINT and
 * SIGTERM handlers during any render, so a count that merely grew proves
 * nothing about the hook. Diffing the identity sets isolates exactly the
 * handlers this hook added.
 */
const listenerSets = (): Record<LifecycleSignal, Set<unknown>> => ({
  exit: new Set<unknown>(process.listeners('exit')),
  SIGINT: new Set<unknown>(process.listeners('SIGINT')),
  SIGTERM: new Set<unknown>(process.listeners('SIGTERM')),
});

const addedSince = (
  current: readonly unknown[],
  before: Set<unknown>,
): unknown[] => current.filter((listener) => !before.has(listener));

/** Listeners added since the snapshot that are still registered. */
const survivorsSince = (
  before: Record<LifecycleSignal, Set<unknown>>,
): Record<LifecycleSignal, unknown[]> => ({
  exit: addedSince(process.listeners('exit'), before.exit),
  SIGINT: addedSince(process.listeners('SIGINT'), before.SIGINT),
  SIGTERM: addedSince(process.listeners('SIGTERM'), before.SIGTERM),
});

describe('useBracketedPaste (AC4.7)', () => {
  const mockedWriteToStdout = writeToStdout as Mock<typeof writeToStdout>;

  beforeEach(() => {
    writtenBytes.length = 0;
    mockedWriteToStdout.mockImplementation(
      (chunk: Parameters<typeof writeToStdout>[0]) => {
        writtenBytes.push(String(chunk));
        return true;
      },
    );
  });

  afterEach(() => {
    mockedWriteToStdout.mockReset();
  });

  it('writes the enable sequence on mount and the disable sequence on unmount', () => {
    const { unmount } = renderHook(() => useBracketedPaste());

    expect(readWrittenBytes()).toStrictEqual(['\x1b[?2004h']);

    unmount();

    expect(readWrittenBytes()).toStrictEqual(['\x1b[?2004h', '\x1b[?2004l']);
  });

  it('registers the same cleanup handler on exit, SIGINT and SIGTERM', () => {
    const before = listenerSets();

    renderHook(() => useBracketedPaste());

    // ink's renderer adds its own SIGINT and SIGTERM handlers but none on
    // 'exit', so the single handler added there is unambiguously the hook's.
    // The hook registers one shared cleanup callback, so that exact reference
    // is what must also appear on the two signals ink pollutes — a count
    // comparison there would be satisfied by ink alone.
    const addedOnExit = addedSince(process.listeners('exit'), before.exit);
    expect(addedOnExit).toHaveLength(1);

    const [cleanup] = addedOnExit;
    expect(addedSince(process.listeners('SIGINT'), before.SIGINT)).toContain(
      cleanup,
    );
    expect(addedSince(process.listeners('SIGTERM'), before.SIGTERM)).toContain(
      cleanup,
    );

    // Registration alone is not the contract. The handler exists so that a
    // Ctrl-C or a kill does not leave the terminal in bracketed-paste mode,
    // so run it and require the disable sequence on the wire.
    expect(cleanup).toBeInstanceOf(Function);
    (cleanup as () => void)();
    expect(readWrittenBytes()).toStrictEqual(['\x1b[?2004h', '\x1b[?2004l']);
  });

  it('removes every handler it registered on unmount', () => {
    const before = listenerSets();

    const { unmount } = renderHook(() => useBracketedPaste());
    unmount();

    expect(survivorsSince(before)).toStrictEqual(NO_SURVIVING_LISTENERS);
  });

  it('repeated mount/unmount cycles do not accumulate process listeners', () => {
    const before = listenerSets();

    for (let cycle = 0; cycle < 3; cycle++) {
      const { unmount } = renderHook(() => useBracketedPaste());
      unmount();
    }

    expect(survivorsSince(before)).toStrictEqual(NO_SURVIVING_LISTENERS);
  });
});
