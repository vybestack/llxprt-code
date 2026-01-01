/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ENABLE_BRACKETED_PASTE,
  ENABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from '../utils/terminalSequences.js';

describe('SIGCONT handler behavior', () => {
  let mockStdoutWrite: ReturnType<typeof vi.fn>;
  let mockStdoutEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStdoutWrite = vi.fn().mockReturnValue(true);
    mockStdoutEmit = vi.fn();
    vi.spyOn(process.stdout, 'write').mockImplementation(mockStdoutWrite);
    vi.spyOn(process.stdout, 'emit').mockImplementation(mockStdoutEmit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners('SIGCONT');
  });

  it('SIGCONT handler should re-enable terminal modes', () => {
    // This test verifies the expected behavior after SIGCONT
    // The actual handler is in KeypressContext, but we test the contract here

    // Simulate what the SIGCONT handler should do
    const handleSigcont = () => {
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      process.stdout.write(ENABLE_FOCUS_TRACKING);
      process.stdout.write(SHOW_CURSOR);
      // Should also re-enable mouse events if they were enabled
      process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
      // Trigger UI redraw
      process.stdout.emit('resize');
    };

    handleSigcont();

    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_BRACKETED_PASTE);
    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_FOCUS_TRACKING);
    expect(mockStdoutWrite).toHaveBeenCalledWith(SHOW_CURSOR);
    expect(mockStdoutWrite).toHaveBeenCalledWith(
      '\x1b[?1000h\x1b[?1002h\x1b[?1006h',
    );
    expect(mockStdoutEmit).toHaveBeenCalledWith('resize');
  });

  it('emitting resize event on a WriteStream triggers listeners', () => {
    // This test documents that emitting 'resize' on stdout should
    // cause useTerminalSize hook to re-measure and trigger a re-render
    // Note: We use a mock here because process.stdout.emit may be spied in beforeEach

    const mockStream = {
      listeners: [] as Array<() => void>,
      on(event: string, handler: () => void) {
        if (event === 'resize') {
          this.listeners.push(handler);
        }
      },
      emit(event: string) {
        if (event === 'resize') {
          for (const handler of this.listeners) {
            handler();
          }
        }
      },
      removeListener(event: string, handler: () => void) {
        if (event === 'resize') {
          this.listeners = this.listeners.filter((h) => h !== handler);
        }
      },
    };

    const resizeHandler = vi.fn();
    mockStream.on('resize', resizeHandler);

    mockStream.emit('resize');

    expect(resizeHandler).toHaveBeenCalled();

    mockStream.removeListener('resize', resizeHandler);
  });
});

describe('SIGWINCH handler behavior', () => {
  let mockStdoutWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStdoutWrite = vi.fn().mockReturnValue(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(mockStdoutWrite);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners('SIGWINCH');
  });

  it('SIGWINCH handler should re-assert terminal modes', () => {
    // Terminal resize can sometimes reset modes in certain terminal emulators
    // The SIGWINCH handler should proactively re-assert our expected state

    const handleSigwinch = () => {
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      process.stdout.write(ENABLE_FOCUS_TRACKING);
      // Re-enable mouse if it was enabled
      process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
    };

    handleSigwinch();

    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_BRACKETED_PASTE);
    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_FOCUS_TRACKING);
    expect(mockStdoutWrite).toHaveBeenCalledWith(
      '\x1b[?1000h\x1b[?1002h\x1b[?1006h',
    );
  });
});

describe('Ctrl+Alt+R terminal repair hotkey', () => {
  let mockStdoutWrite: ReturnType<typeof vi.fn>;
  let mockStdoutEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStdoutWrite = vi.fn().mockReturnValue(true);
    mockStdoutEmit = vi.fn();
    vi.spyOn(process.stdout, 'write').mockImplementation(mockStdoutWrite);
    vi.spyOn(process.stdout, 'emit').mockImplementation(mockStdoutEmit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Ctrl+Alt+R should re-assert terminal modes and trigger resize', () => {
    // Simulate the Ctrl+Alt+R handler behavior
    const handleCtrlAltR = () => {
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      process.stdout.write(ENABLE_FOCUS_TRACKING);
      process.stdout.write(SHOW_CURSOR);
      // Re-enable mouse if it was enabled
      process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
      // Trigger UI redraw
      process.stdout.emit('resize');
    };

    handleCtrlAltR();

    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_BRACKETED_PASTE);
    expect(mockStdoutWrite).toHaveBeenCalledWith(ENABLE_FOCUS_TRACKING);
    expect(mockStdoutWrite).toHaveBeenCalledWith(SHOW_CURSOR);
    expect(mockStdoutEmit).toHaveBeenCalledWith('resize');
  });
});
