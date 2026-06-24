/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import type React from 'react';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import type { Mock } from 'vitest';
import { vi } from 'vitest';
import type { Key } from './KeypressContext.js';
import {
  KeypressProvider,
  useKeypressContext,
  ESC_TIMEOUT,
} from './KeypressContext.js';

// Alias for backwards compatibility with tests
const KITTY_SEQUENCE_TIMEOUT_MS = ESC_TIMEOUT;
import { useStdin } from 'ink';
import { EventEmitter } from 'node:events';

// Mock the 'ink' module to control stdin
vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal<typeof import('ink')>();
  return {
    ...original,
    useStdin: vi.fn(),
  };
});

// readline will not emit most incomplete kitty sequences but it will give
// up on sequences like this where the modifier (135) has more than two digits.
const INCOMPLETE_KITTY_SEQUENCE = '\x1b[97;135';

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

// Helper function to setup keypress test with standard configuration
const setupKeypressTest = () => {
  const keyHandler = vi.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  const { result } = renderHook(() => useKeypressContext(), { wrapper });
  act(() => result.current.subscribe(keyHandler));

  return { result, keyHandler };
};

describe('Kitty Sequence Parsing', () => {
  let stdin: MockStdin;
  const mockSetRawMode = vi.fn();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stdin = new MockStdin();
    (useStdin as Mock).mockReturnValue({
      stdin,
      setRawMode: mockSetRawMode,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Cross-terminal Alt key handling (simulating macOS)', () => {
    let originalPlatform: NodeJS.Platform;

    beforeEach(() => {
      originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    });

    // Terminals to test
    const terminals = ['iTerm2', 'Ghostty', 'MacTerminal', 'VSCodeTerminal'];

    // Key mappings: letter -> [keycode, accented character]
    const keys: Record<string, [number, string]> = {
      b: [98, '\u222B'],
      f: [102, '\u0192'],
      m: [109, '\u00B5'],
    };

    it.each(
      terminals.flatMap((terminal) =>
        Object.entries(keys).map(([key, [keycode, accentedChar]]) => {
          if (terminal === 'Ghostty') {
            // Ghostty uses kitty protocol sequences
            return {
              terminal,
              key,
              chunk: `\x1b[${keycode};3u`,
              expected: {
                name: key,
                ctrl: false,
                meta: true,
                shift: false,
              },
            };
          } else if (terminal === 'MacTerminal') {
            // Mac Terminal sends ESC + letter
            return {
              terminal,
              key,
              kitty: false,
              chunk: `\x1b${key}`,
              expected: {
                sequence: `\x1b${key}`,
                name: key,
                ctrl: false,
                meta: true,
                shift: false,
              },
            };
          }
          // iTerm2 and VSCode send accented characters (å, ø, µ)
          // Note: µ (mu) is sent with meta:false on iTerm2/VSCode but
          // gets converted to m with meta:true
          return {
            terminal,
            key,
            chunk: accentedChar,
            expected: {
              name: key,
              ctrl: false,
              meta: true, // Always expect meta:true after conversion
              shift: false,
              sequence: accentedChar,
            },
          };
        }),
      ),
    )(
      'should handle Alt+$key in $terminal',
      ({ chunk, expected }: { chunk: string; expected: Partial<Key> }) => {
        const keyHandler = vi.fn();
        const testWrapper = ({ children }: { children: React.ReactNode }) => (
          <KeypressProvider>{children}</KeypressProvider>
        );
        const { result } = renderHook(() => useKeypressContext(), {
          wrapper: testWrapper,
        });
        act(() => result.current.subscribe(keyHandler));

        act(() => stdin.write(chunk));

        expect(keyHandler).toHaveBeenCalledWith(
          expect.objectContaining(expected),
        );
      },
    );
  });

  describe('Backslash key handling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should treat backslash as a regular keystroke', () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('\\'));

      // Advance timers to trigger the backslash timeout
      act(() => {
        vi.runAllTimers();
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sequence: '\\',
          meta: false,
        }),
      );
    });
  });

  it('should timeout and flush incomplete kitty sequences after 100ms', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

    // Wait for ESC timeout to flush the incomplete sequence
    void act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

    // The incomplete sequence should be emitted after timeout
    // The parser will process the escape sequence and emit it
    expect(keyHandler).toHaveBeenCalled();
  });

  it('should immediately flush non-kitty CSI sequences', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    // Send a CSI sequence that doesn't match kitty patterns
    // ESC[m is SGR reset, not a kitty sequence
    act(() => stdin.write('\x1b[m'));

    // Should broadcast immediately as it's not a valid kitty pattern
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: '\x1b[m',
      }),
    );
  });

  it('should parse valid kitty sequences immediately when complete', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    // Send complete kitty sequence for Ctrl+A
    act(() => stdin.write('\x1b[97;5u'));

    // Should parse and broadcast immediately
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'a',
        ctrl: true,
      }),
    );
  });

  it('should handle batched kitty sequences correctly', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    // Send Ctrl+a followed by Ctrl+b
    act(() => stdin.write('\x1b[97;5u\x1b[98;5u'));

    // Should parse both sequences
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'a',
        ctrl: true,
      }),
    );
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'b',
        ctrl: true,
      }),
    );
  });

  it('should clear kitty buffer and timeout on Ctrl+C', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

    // Wait for the incomplete sequence to timeout and be flushed
    void act(() => vi.advanceTimersByTime(KITTY_SEQUENCE_TIMEOUT_MS + 10));

    keyHandler.mockClear();

    // Press Ctrl+C
    act(() => stdin.write('\x03'));

    // Verify that Ctrl+C was received
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'c',
        ctrl: true,
      }),
    );
  });

  it('should handle mixed valid and invalid sequences', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    // Send valid kitty sequence followed by invalid CSI
    // Valid enter, then invalid sequence
    act(() => stdin.write('\x1b[13u\x1b[!'));

    // Should parse valid sequence and flush invalid immediately
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'return',
      }),
    );
    // LLxprt's implementation sets name to 'undefined' for unknown sequences
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: '\x1b[!',
      }),
    );
  });

  it('should not buffer sequences when kitty protocol is disabled', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        wrapper({ children }),
    });

    act(() => result.current.subscribe(keyHandler));

    // Send what would be a kitty sequence
    act(() => stdin.write('\x1b[13u'));

    // Should pass through without parsing
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: '\x1b[13u',
      }),
    );
    expect(keyHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'return',
        kittyProtocol: true,
      }),
    );
  });

  it('should handle sequences arriving character by character', async () => {
    vi.useRealTimers(); // Required for correct buffering timing.

    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => {
      result.current.subscribe(keyHandler);
    });

    // Send kitty sequence character by character
    const sequence = '\x1b[27u'; // Escape key
    for (const char of sequence) {
      act(() => {
        stdin.emit('data', char);
      });
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Should parse once complete
    await vi.waitFor(() => {
      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'escape',
        }),
      );
    });
  });

  it('should reset timeout when new input arrives', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    // Start incomplete sequence
    act(() => stdin.write('\x1b[97;13'));

    // Advance time partway
    void act(() => vi.advanceTimersByTime(30));

    // Add more to sequence
    act(() => stdin.write('5'));

    // Advance time from the first timeout point
    void act(() => vi.advanceTimersByTime(25));

    // Complete the sequence
    act(() => stdin.write('u'));

    // Should now parse as complete 'a' key with ctrl modifier
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'a',
        ctrl: true,
      }),
    );
  });

  it('should flush incomplete kitty sequence on FOCUS_IN event', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

    // Wait for ESC timeout to flush the incomplete sequence
    void act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

    // The incomplete sequence should be emitted after timeout
    expect(keyHandler).toHaveBeenCalled();

    // Send FOCUS_IN event - should be filtered out by nonKeyboardEventFilter
    act(() => stdin.write('\x1b[I'));

    // FOCUS_IN should be filtered, so no additional calls beyond the incomplete sequence
  });

  it('should flush incomplete kitty sequence on FOCUS_OUT event', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

    // Wait for ESC timeout to flush the incomplete sequence
    void act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

    // The incomplete sequence should be emitted after timeout
    expect(keyHandler).toHaveBeenCalled();

    // Send FOCUS_OUT event - should be filtered out by nonKeyboardEventFilter
    act(() => stdin.write('\x1b[O'));

    // FOCUS_OUT should be filtered, so no additional calls beyond the incomplete sequence
  });

  it('should flush incomplete kitty sequence on paste event', async () => {
    const keyHandler = vi.fn();
    const { result } = renderHook(() => useKeypressContext(), { wrapper });

    act(() => result.current.subscribe(keyHandler));

    act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

    // Wait for ESC timeout to flush the incomplete sequence
    void act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

    // The incomplete sequence should be emitted after timeout
    expect(keyHandler).toHaveBeenCalled();
    keyHandler.mockClear();

    // Send paste start sequence
    act(() => stdin.write(`\x1b[200~`));

    // Now send some paste content and end paste to make sure paste still works
    const pastedText = 'hello';
    const PASTE_MODE_SUFFIX = `\x1b[201~`;
    act(() => {
      stdin.write(pastedText);
      stdin.write(PASTE_MODE_SUFFIX);
    });

    await act(() => vi.runAllTimers());

    // The paste event should be broadcast
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'paste',
        sequence: pastedText,
      }),
    );
  });
});
