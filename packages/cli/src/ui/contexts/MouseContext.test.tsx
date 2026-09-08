/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'bun:test';
import { useStdin } from 'ink';
import { EventEmitter } from 'node:events';
import { renderHook } from '../../test-utils/render.js';
import { MouseProvider, useMouseContext } from './MouseContext.js';
import { useMouse } from '../hooks/useMouse.js';
import type { MouseEvent } from '../utils/mouse.js';

const SGR_PRESS = '\x1b[<0;10;20M';
const SGR_RELEASE = '\x1b[<0;10;20m';

/**
 * Mirrors MAX_MOUSE_BUFFER_SIZE in MouseContext.tsx, which is module-private.
 * The junk-recovery tests below must exceed it for the buffer trim to run at
 * all; if the production cap is ever raised above this value, update it here
 * too or those tests stop exercising the boundary they were written for.
 */
const MAX_MOUSE_BUFFER_SIZE = 4096;

const original = { ...(await import('ink')) };
void vi.mock('ink', () => ({
  ...original,
  useStdin: vi.fn(),
}));

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  override on = this.addListener;
  override removeListener = super.removeListener;
  resume = vi.fn();
  pause = vi.fn();

  write(text: string): void {
    this.emit('data', text);
  }
}

function renderMouseProvider(
  mouseEventsEnabled: boolean | undefined,
  events: MouseEvent[] = [],
): { unmount: () => void } {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    mouseEventsEnabled === undefined ? (
      <MouseProvider>{children}</MouseProvider>
    ) : (
      <MouseProvider mouseEventsEnabled={mouseEventsEnabled}>
        {children}
      </MouseProvider>
    );
  const { result, unmount } = renderHook(() => useMouseContext(), { wrapper });
  const collectEvent = (event: MouseEvent): void => {
    events.push(event);
  };
  act(() => result.current.subscribe(collectEvent));
  return { unmount };
}

describe('MouseContext', () => {
  let stdin: MockStdin;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdin = new MockStdin();
    (useStdin as Mock<(...args: never[]) => unknown>).mockReturnValue({
      stdin,
      setRawMode: vi.fn(),
    });
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <MouseProvider mouseEventsEnabled={true}>{children}</MouseProvider>
    );
  });

  it('subscribes and unsubscribes handlers', () => {
    const handler = vi.fn();
    const { result } = renderHook(() => useMouseContext(), { wrapper });

    act(() => result.current.subscribe(handler));
    act(() => stdin.write(SGR_PRESS));
    expect(handler).toHaveBeenCalledTimes(1);

    act(() => result.current.unsubscribe(handler));
    act(() => stdin.write(SGR_PRESS));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not call handler when hook is inactive', () => {
    const handler = vi.fn();
    renderHook(() => useMouse(handler, { isActive: false }), { wrapper });

    act(() => stdin.write(SGR_PRESS));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not listen when mouseEventsEnabled is false', () => {
    const handler = vi.fn();
    const disabledWrapper = ({ children }: { children: React.ReactNode }) => (
      <MouseProvider mouseEventsEnabled={false}>{children}</MouseProvider>
    );
    const { result } = renderHook(() => useMouseContext(), {
      wrapper: disabledWrapper,
    });

    act(() => result.current.subscribe(handler));
    act(() => stdin.write(SGR_PRESS));
    expect(handler).not.toHaveBeenCalled();
  });

  it('attaches exactly one data listener when enabled and removes it on unmount (AC2.5)', () => {
    const rendered = renderMouseProvider(true);

    expect(stdin.listenerCount('data')).toBe(1);

    rendered.unmount();
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('attaches no data listener when mouseEventsEnabled is omitted (AC2.5)', () => {
    const omitted = renderMouseProvider(undefined);
    expect(stdin.listenerCount('data')).toBe(0);
    omitted.unmount();

    const enabled = renderMouseProvider(true);
    expect(stdin.listenerCount('data')).toBe(1);
    enabled.unmount();
  });

  it('attaches and detaches the data listener as mouseEventsEnabled changes (AC2.5)', () => {
    let enabled = false;
    const togglingWrapper = ({ children }: { children: React.ReactNode }) => (
      <MouseProvider mouseEventsEnabled={enabled}>{children}</MouseProvider>
    );
    const rendered = renderHook(() => useMouseContext(), {
      wrapper: togglingWrapper,
    });
    expect(stdin.listenerCount('data')).toBe(0);

    enabled = true;
    rendered.rerender();
    expect(stdin.listenerCount('data')).toBe(1);

    enabled = false;
    rendered.rerender();
    expect(stdin.listenerCount('data')).toBe(0);
  });

  it('broadcasts a split SGR sequence once after the final chunk arrives (AC6.1)', () => {
    const events: MouseEvent[] = [];
    renderMouseProvider(true, events);

    act(() => stdin.write('\x1b[<0;10;'));
    expect(events).toStrictEqual([]);

    act(() => stdin.write('20M'));
    expect(events).toStrictEqual([
      {
        name: 'left-press',
        col: 10,
        row: 20,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      },
    ]);
  });

  it('broadcasts two complete sequences from one chunk in arrival order (AC6.2)', () => {
    const events: MouseEvent[] = [];
    renderMouseProvider(true, events);

    act(() => stdin.write(`${SGR_PRESS}${SGR_RELEASE}`));

    expect(events.map(({ name }) => name)).toStrictEqual([
      'left-press',
      'left-release',
    ]);
  });

  it('discards garbage before a valid sequence and broadcasts the valid event (AC6.3)', () => {
    const events: MouseEvent[] = [];
    renderMouseProvider(true, events);

    act(() => stdin.write(`not-a-mouse-event${SGR_PRESS}`));

    expect(events).toStrictEqual([
      {
        name: 'left-press',
        col: 10,
        row: 20,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      },
    ]);
  });

  it('does not wedge on a very large run of junk and still broadcasts a later event (AC6.4)', () => {
    const events: MouseEvent[] = [];
    renderMouseProvider(true, events);

    act(() => stdin.write('x'.repeat(MAX_MOUSE_BUFFER_SIZE + 1)));
    expect(events).toStrictEqual([]);

    act(() => stdin.write(SGR_PRESS));
    expect(events.map(({ name }) => name)).toStrictEqual(['left-press']);
  });

  it('does not wedge on junk that looks like an unterminated SGR sequence (AC6.4)', () => {
    const events: MouseEvent[] = [];
    renderMouseProvider(true, events);

    // Starts like an SGR sequence and never terminates, so it survives the
    // parse attempt rather than being discarded outright. This is the input
    // the buffer cap exists for.
    act(() => stdin.write(`\x1b[<${'1'.repeat(MAX_MOUSE_BUFFER_SIZE * 2)}`));
    expect(events).toStrictEqual([]);

    act(() => stdin.write(SGR_PRESS));
    expect(events.map(({ name }) => name)).toStrictEqual(['left-press']);
  });
});
