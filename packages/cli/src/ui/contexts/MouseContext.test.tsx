/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { vi, type Mock } from 'vitest';
import { useStdin } from 'ink';
import { EventEmitter } from 'node:events';
import { MouseProvider, useMouseContext } from './MouseContext.js';
import { useMouse } from '../hooks/useMouse.js';

vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal<typeof import('ink')>();
  return {
    ...original,
    useStdin: vi.fn(),
  };
});

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  override on = this.addListener;
  override removeListener = super.removeListener;
  resume = vi.fn();
  pause = vi.fn();

  write(text: string) {
    this.emit('data', text);
  }
}

describe('MouseContext', () => {
  let stdin: MockStdin;
  let wrapper: React.FC<{ children: React.ReactNode }>;

  beforeEach(() => {
    stdin = new MockStdin();
    (useStdin as Mock).mockReturnValue({
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
    act(() => stdin.write('\x1b[<0;10;20M'));
    expect(handler).toHaveBeenCalledTimes(1);

    act(() => result.current.unsubscribe(handler));
    act(() => stdin.write('\x1b[<0;10;20M'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not call handler when hook is inactive', () => {
    const handler = vi.fn();
    renderHook(() => useMouse(handler, { isActive: false }), { wrapper });

    act(() => stdin.write('\x1b[<0;10;20M'));
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
    act(() => stdin.write('\x1b[<0;10;20M'));
    expect(handler).not.toHaveBeenCalled();
  });
});
