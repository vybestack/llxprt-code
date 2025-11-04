/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { render } from '../../test-utils/render.js';
import { useKeypress } from './useKeypress.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { useStdin } from 'ink';
import { EventEmitter } from 'node:events';
import type { Mock } from 'vitest';
import { vi } from 'vitest';

// Mock the 'ink' module to control stdin
vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal<typeof import('ink')>();
  return {
    ...original,
    useStdin: vi.fn(),
  };
});

const PASTE_START = '\x1B[200~';
const PASTE_END = '\x1B[201~';

class MockStdin extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode = vi.fn();
  override on = this.addListener;
  override removeListener = super.removeListener;
  resume = vi.fn();
  pause = vi.fn();

  write(text: string) {
    this.emit('data', text);
  }
}

describe.each([true, false])(`useKeypress with useKitty=%s`, (useKitty) => {
  let stdin: MockStdin;
  const mockSetRawMode = vi.fn();
  const onKeypress = vi.fn();
  let originalNodeVersion: string;

  const renderKeypressHook = (isActive = true) => {
    function TestComponent() {
      useKeypress(onKeypress, { isActive });
      return null;
    }
    return render(
      <KeypressProvider kittyProtocolEnabled={useKitty}>
        <TestComponent />
      </KeypressProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stdin = new MockStdin();
    (useStdin as Mock).mockReturnValue({
      stdin: stdin as any,
      setRawMode: mockSetRawMode,
      isRawModeSupported: true,
      internal_exitOnCtrlC: true,
      internal_eventEmitter: stdin,
    });

    // Mock process.versions.node for Node.js version checks
    originalNodeVersion = process.versions.node;
    Object.defineProperty(process.versions, 'node', {
      value: '20.0.0',
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.versions, 'node', {
      value: originalNodeVersion,
      configurable: true,
    });
  });

  it('should not listen if isActive is false', () => {
    renderKeypressHook(false);
    act(() => stdin.write('a'));
    expect(onKeypress).not.toHaveBeenCalled();
  });

  it.each([
    { key: { name: 'a', sequence: 'a' } },
    { key: { name: 'left', sequence: '\x1b[D' } },
    { key: { name: 'right', sequence: '\x1b[C' } },
    { key: { name: 'up', sequence: '\x1b[A' } },
    { key: { name: 'down', sequence: '\x1b[B' } },
    { key: { name: 'tab', sequence: '\x1b[Z', shift: true } },
  ])('should listen for keypress when active for key $key.name', ({ key }) => {
    renderKeypressHook(true);
    act(() => stdin.write(key.sequence));
    expect(onKeypress).toHaveBeenCalledWith(expect.objectContaining(key));
  });

  it('should set and release raw mode', () => {
    const { unmount } = renderKeypressHook(true);
    expect(mockSetRawMode).toHaveBeenCalledWith(true);
    unmount();
    expect(mockSetRawMode).toHaveBeenCalledWith(false);
  });

  it('should stop listening after being unmounted', () => {
    const { unmount } = renderKeypressHook(true);
    unmount();
    act(() => stdin.write('a'));
    expect(onKeypress).not.toHaveBeenCalled();
  });

  it('should correctly identify alt+enter (meta key)', () => {
    renderKeypressHook(true);
    const key = { name: 'return', sequence: '\x1B\r' };
    act(() => stdin.write(key.sequence));
    expect(onKeypress).toHaveBeenCalledWith(
      expect.objectContaining({ ...key, meta: true, paste: false }),
    );
  });
});
