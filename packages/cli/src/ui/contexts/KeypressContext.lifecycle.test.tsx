/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { act } from 'react';
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
import { useStdin } from 'ink';
import { EventEmitter } from 'node:events';
import {
  KeypressProvider,
  useKeypressContext,
  ESC_TIMEOUT,
} from './KeypressContext.js';
import { useKeypress } from '../hooks/useKeypress.js';

// Only useStdin is replaced; the rest of ink is the real module, so the
// provider runs against a stdin whose isRaw each test controls.
const original = { ...(await import('ink')) };
void vi.mock('ink', () => ({
  ...original,
  useStdin: vi.fn(),
}));

/**
 * Mock stdin whose isRaw is controllable so the raw-mode ownership guard
 * (`wasRaw === false`) can be pinned for every branch. Existing MockStdin
 * classes in the suite never define `isRaw` at all, which makes them
 * unusable for AC1.
 */
class MockStdin extends EventEmitter {
  isTTY = true;
  isRaw: boolean | undefined = false;
  setRawMode = vi.fn();
  override on = this.addListener;
  override removeListener = super.removeListener;
  resume = vi.fn();
  pause = vi.fn();

  write(text: string) {
    this.emit('data', text);
  }
}

const waitForEscTimeout = () => {
  act(() => {
    vi.advanceTimersByTime(ESC_TIMEOUT + 10);
  });
};

/** Mount a KeypressProvider and subscribe a spy to it. */
const setupProvider = () => {
  const keyHandler = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  const { result, unmount } = renderHook(() => useKeypressContext(), {
    wrapper,
  });
  act(() => result.current.subscribe(keyHandler));

  return { keyHandler, unmount };
};

/** Render a toggling useKeypress consumer inside a KeypressProvider. */
const renderTogglingConsumer = (keyHandler: ReturnType<typeof vi.fn>) => {
  const harness = renderHook(
    (isActive: boolean) => {
      useKeypress(keyHandler, { isActive });
      return null;
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider>{children}</KeypressProvider>
      ),
      initialProps: false,
    },
  );
  return harness;
};

describe('KeypressProvider raw mode ownership (AC1)', () => {
  let stdin: MockStdin;
  let mockSetRawMode: ReturnType<typeof vi.fn>;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stdin = new MockStdin();
    mockSetRawMode = vi.fn();
    (useStdin as Mock<(...args: never[]) => unknown>).mockReturnValue({
      stdin,
      setRawMode: mockSetRawMode,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('turns raw mode on at mount and off at unmount once when it owns raw mode (AC1.1, AC1.2)', () => {
    const { unmount } = renderHook(() => useKeypressContext(), { wrapper });

    expect(mockSetRawMode.mock.calls).toStrictEqual([[true]]);

    unmount();

    expect(mockSetRawMode.mock.calls).toStrictEqual([[true], [false]]);
  });

  it('never calls setRawMode when isRaw is true (AC1.3)', () => {
    stdin.isRaw = true;
    const { unmount } = renderHook(() => useKeypressContext(), { wrapper });

    expect(mockSetRawMode).not.toHaveBeenCalled();

    unmount();
    expect(mockSetRawMode).not.toHaveBeenCalled();
  });

  it('never calls setRawMode when isRaw is undefined (AC1.4)', () => {
    stdin.isRaw = undefined;
    const { unmount } = renderHook(() => useKeypressContext(), { wrapper });

    expect(mockSetRawMode).not.toHaveBeenCalled();

    unmount();
    expect(mockSetRawMode).not.toHaveBeenCalled();
  });
});

describe('KeypressProvider subscription lifecycle (AC2)', () => {
  let stdin: MockStdin;
  let mockSetRawMode: ReturnType<typeof vi.fn>;

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stdin = new MockStdin();
    mockSetRawMode = vi.fn();
    (useStdin as Mock<(...args: never[]) => unknown>).mockReturnValue({
      stdin,
      setRawMode: mockSetRawMode,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attaches exactly one stdin data listener and removes it on unmount (AC2.1)', () => {
    const { unmount } = renderHook(() => useKeypressContext(), { wrapper });

    expect(stdin.listenerCount('data')).toBe(1);

    unmount();
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('delivers nothing to a subscribed handler after unmount (AC2.2)', () => {
    const { keyHandler, unmount } = setupProvider();

    // Positive control: without this, a completely broken broadcast path would
    // satisfy the not-called assertion below.
    act(() => stdin.write('a'));
    waitForEscTimeout();
    expect(keyHandler).toHaveBeenCalledTimes(1);

    unmount();

    act(() => stdin.write('a'));
    waitForEscTimeout();
    expect(keyHandler).toHaveBeenCalledTimes(1);
  });

  it('stops delivery to one handler after unsubscribe while another keeps receiving (AC2.3)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });
    act(() => {
      result.current.subscribe(first);
      result.current.subscribe(second);
    });
    act(() => result.current.unsubscribe(first));

    act(() => stdin.write('a'));
    waitForEscTimeout();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('honors isActive toggles without unmounting the provider (AC2.4)', () => {
    const keyHandler = vi.fn();
    const toggling = renderTogglingConsumer(keyHandler);

    // Starts inactive: no delivery.
    act(() => stdin.write('a'));
    waitForEscTimeout();
    expect(keyHandler).not.toHaveBeenCalled();

    // Activate: delivery starts.
    toggling.rerender(true);
    act(() => stdin.write('a'));
    waitForEscTimeout();
    expect(keyHandler).toHaveBeenCalledTimes(1);

    // Deactivate: delivery stops.
    toggling.rerender(false);
    act(() => stdin.write('a'));
    waitForEscTimeout();
    expect(keyHandler).toHaveBeenCalledTimes(1);

    // The provider itself was never unmounted during the flips.
    expect(stdin.listenerCount('data')).toBe(1);
  });
});
