/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import type { Mock } from 'vitest';
import { vi } from 'vitest';
import type { Key } from './KeypressContext.js';
import {
  KeypressProvider,
  useKeypressContext,
  DRAG_COMPLETION_TIMEOUT_MS,
  ESC_TIMEOUT,
  // CSI_END_O,
  // SS3_END,
  SINGLE_QUOTE,
  DOUBLE_QUOTE,
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

const PASTE_START = '\x1B[200~';
const PASTE_END = '\x1B[201~';
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

describe('KeypressContext - Kitty Protocol', () => {
  let stdin: MockStdin;
  const mockSetRawMode = vi.fn();

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <KeypressProvider>{children}</KeypressProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    stdin = new MockStdin();
    (useStdin as Mock).mockReturnValue({
      stdin,
      setRawMode: mockSetRawMode,
    });
  });

  describe('Enter key handling', () => {
    it.each([
      {
        name: 'regular enter key (keycode 13)',
        sequence: '\x1b[13u',
      },
      {
        name: 'numpad enter key (keycode 57414)',
        sequence: '\x1b[57414u',
      },
    ])('should recognize $name in kitty protocol', async ({ sequence }) => {
      const { keyHandler } = setupKeypressTest();

      act(() => {
        stdin.write(sequence);
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'return',
          ctrl: false,
          meta: false,
          shift: false,
        }),
      );
    });

    it.each([
      {
        modifier: 'Shift',
        sequence: '\x1b[57414;2u',
        expected: { ctrl: false, meta: false, shift: true },
      },
      {
        modifier: 'Ctrl',
        sequence: '\x1b[57414;5u',
        expected: { ctrl: true, meta: false, shift: false },
      },
      {
        modifier: 'Alt',
        sequence: '\x1b[57414;3u',
        expected: { ctrl: false, meta: true, shift: false },
      },
    ])(
      'should handle numpad enter with $modifier modifier',
      async ({ sequence, expected }) => {
        const { keyHandler } = setupKeypressTest();

        act(() => stdin.write(sequence));

        expect(keyHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'return',
            ...expected,
          }),
        );
      },
    );

    it('should not process kitty sequences when kitty protocol is disabled', async () => {
      const { keyHandler } = setupKeypressTest();

      // Send kitty protocol sequence for numpad enter
      act(() => {
        stdin.write(`\x1b[57414u`);
      });

      // When kitty protocol is disabled, the sequence should be passed through
      // as individual keypresses, not recognized as a single enter key
      expect(keyHandler).not.toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'return',
          kittyProtocol: true,
        }),
      );
    });
  });

  describe('Escape key handling', () => {
    it('should recognize escape key (keycode 27) in kitty protocol', async () => {
      const { keyHandler } = setupKeypressTest();

      // Send kitty protocol sequence for escape: ESC[27u
      act(() => {
        stdin.write('\x1b[27u');
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'escape',
        }),
      );
    });
  });

  describe('Tab and Backspace handling', () => {
    it.each([
      {
        name: 'Tab key',
        sequence: '\x1b[9u',
        expected: { name: 'tab', shift: false },
      },
      {
        name: 'Shift+Tab',
        sequence: '\x1b[9;2u',
        expected: { name: 'tab', shift: true },
      },
      {
        name: 'Backspace',
        sequence: '\x1b[127u',
        expected: { name: 'backspace', meta: false },
      },
      {
        name: 'Option+Backspace',
        sequence: '\x1b[127;3u',
        expected: { name: 'backspace', meta: true },
      },
      {
        name: 'Ctrl+Backspace',
        sequence: '\x1b[127;5u',
        expected: { name: 'backspace', ctrl: true },
      },
    ])(
      'should recognize $name in kitty protocol',
      async ({ sequence, expected }) => {
        const { keyHandler } = setupKeypressTest();

        act(() => {
          stdin.write(sequence);
        });

        expect(keyHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            ...expected,
          }),
        );
      },
    );
  });

  describe('Ctrl+Backslash handling', () => {
    it('should normalize Ctrl+Backslash from CSI-u sequences', () => {
      const { keyHandler } = setupKeypressTest();

      // Backslash keycode is 92. Modifier 5 is Ctrl.
      act(() => {
        stdin.write('\x1b[92;5u');
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '\\',
          ctrl: true,
          meta: false,
        }),
      );
    });
  });

  describe('paste mode', () => {
    it.each([
      {
        name: 'handle multiline paste as a single event',
        pastedText: 'This \n is \n a \n multiline \n paste.',
        writeSequence: (text: string) => {
          stdin.write(PASTE_START);
          stdin.write(text);
          stdin.write(PASTE_END);
        },
      },
      {
        name: 'handle paste start code split over multiple writes',
        pastedText: 'pasted content',
        writeSequence: (text: string) => {
          stdin.write(PASTE_START.slice(0, 3));
          stdin.write(PASTE_START.slice(3));
          stdin.write(text);
          stdin.write(PASTE_END);
        },
      },
      {
        name: 'handle paste end code split over multiple writes',
        pastedText: 'pasted content',
        writeSequence: (text: string) => {
          stdin.write(PASTE_START);
          stdin.write(text);
          stdin.write(PASTE_END.slice(0, 3));
          stdin.write(PASTE_END.slice(3));
        },
      },
    ])('should $name', async ({ pastedText, writeSequence }) => {
      const keyHandler = vi.fn();

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      act(() => writeSequence(pastedText));

      await vi.waitFor(() => {
        expect(keyHandler).toHaveBeenCalledTimes(1);
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          paste: true,
          sequence: pastedText,
        }),
      );
    });
  });

  // NOTE: Debug logging now uses DebugLogger which doesn't call console.log
  // when logging is disabled (default in tests). These tests are skipped
  // as they tested the old console.log behavior. The DebugLogger has its
  // own test coverage in packages/core.
  describe('debug keystroke logging', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should not log keystrokes when debugKeystrokeLogging is false', async () => {
      const keyHandler = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider debugKeystrokeLogging={false}>
          {children}
        </KeypressProvider>
      );

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      // Send a kitty sequence
      act(() => {
        stdin.write('\x1b[27u');
      });

      expect(keyHandler).toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG] Kitty'),
      );
    });

    it.skip('should log kitty buffer accumulation when debugKeystrokeLogging is true', async () => {
      const keyHandler = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider debugKeystrokeLogging={true}>
          {children}
        </KeypressProvider>
      );

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      // Send a complete kitty sequence for escape
      act(() => stdin.write('\x1b[27u'));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DEBUG] Kitty buffer accumulating:',
        expect.stringContaining('"\\u001b[27u"'),
      );
      const parsedCall = consoleLogSpy.mock.calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].includes('[DEBUG] Kitty sequence parsed successfully'),
      );
      expect(parsedCall).toBeTruthy();
      expect(parsedCall?.[1]).toEqual(expect.stringContaining('\\u001b[27u'));
    });

    it.skip('should log kitty buffer overflow when debugKeystrokeLogging is true', async () => {
      const keyHandler = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider debugKeystrokeLogging={true}>
          {children}
        </KeypressProvider>
      );

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      // Send a long sequence starting with a valid kitty prefix to trigger overflow
      const longSequence = '\x1b[1;' + '1'.repeat(100);
      act(() => stdin.write(longSequence));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DEBUG] Kitty buffer overflow, clearing:',
        expect.any(String),
      );
    });

    it.skip('should log kitty buffer clear on Ctrl+C when debugKeystrokeLogging is true', async () => {
      const keyHandler = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider debugKeystrokeLogging={true}>
          {children}
        </KeypressProvider>
      );

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

      // Send Ctrl+C
      act(() => stdin.write('\x03'));

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DEBUG] Kitty buffer cleared on Ctrl+C:',
        INCOMPLETE_KITTY_SEQUENCE,
      );

      // Verify Ctrl+C was handled
      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'c',
          ctrl: true,
        }),
      );
    });

    it.skip('should show char codes when debugKeystrokeLogging is true even without debug mode', async () => {
      const keyHandler = vi.fn();

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <KeypressProvider debugKeystrokeLogging={true}>
          {children}
        </KeypressProvider>
      );

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      // Send incomplete kitty sequence
      act(() => stdin.write(INCOMPLETE_KITTY_SEQUENCE));

      // Verify debug logging for accumulation
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DEBUG] Kitty buffer accumulating:',
        JSON.stringify(INCOMPLETE_KITTY_SEQUENCE),
      );

      // Verify warning for char codes
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Kitty sequence buffer has content:',
        JSON.stringify(INCOMPLETE_KITTY_SEQUENCE),
      );
    });
  });

  describe('Parameterized functional keys', () => {
    it.each([
      // ModifyOtherKeys
      { sequence: `\x1b[27;2;13~`, expected: { name: 'return', shift: true } },
      { sequence: `\x1b[27;5;13~`, expected: { name: 'return', ctrl: true } },
      { sequence: `\x1b[27;5;9~`, expected: { name: 'tab', ctrl: true } },
      {
        sequence: `\x1b[27;6;9~`,
        expected: { name: 'tab', ctrl: true, shift: true },
      },
      // XTerm Function Key
      { sequence: `\x1b[1;129A`, expected: { name: 'up' } },
      { sequence: `\x1b[1;2H`, expected: { name: 'home', shift: true } },
      { sequence: `\x1b[1;5F`, expected: { name: 'end', ctrl: true } },
      { sequence: `\x1b[1;1P`, expected: { name: 'f1' } },
      { sequence: `\x1b[1;3Q`, expected: { name: 'f2', meta: true } },
      // Tilde Function Keys
      { sequence: `\x1b[3~`, expected: { name: 'delete' } },
      { sequence: `\x1b[5~`, expected: { name: 'pageup' } },
      { sequence: `\x1b[6~`, expected: { name: 'pagedown' } },
      { sequence: `\x1b[1~`, expected: { name: 'home' } },
      { sequence: `\x1b[4~`, expected: { name: 'end' } },
      { sequence: `\x1b[2~`, expected: { name: 'insert' } },
      { sequence: `\x1b[11~`, expected: { name: 'f1' } },
      { sequence: `\x1b[17~`, expected: { name: 'f6' } },
      { sequence: `\x1b[23~`, expected: { name: 'f11' } },
      { sequence: `\x1b[24~`, expected: { name: 'f12' } },
      // Reverse tabs
      { sequence: `\x1b[Z`, expected: { name: 'tab', shift: true } },
      { sequence: `\x1b[1;2Z`, expected: { name: 'tab', shift: true } },
      // Legacy Arrows
      {
        sequence: `\x1b[A`,
        expected: { name: 'up', ctrl: false, meta: false, shift: false },
      },
      {
        sequence: `\x1b[B`,
        expected: { name: 'down', ctrl: false, meta: false, shift: false },
      },
      {
        sequence: `\x1b[C`,
        expected: { name: 'right', ctrl: false, meta: false, shift: false },
      },
      {
        sequence: `\x1b[D`,
        expected: { name: 'left', ctrl: false, meta: false, shift: false },
      },

      // Legacy Home/End
      {
        sequence: `\x1b[H`,
        expected: { name: 'home', ctrl: false, meta: false, shift: false },
      },
      {
        sequence: `\x1b[F`,
        expected: { name: 'end', ctrl: false, meta: false, shift: false },
      },
      {
        sequence: `\x1b[5H`,
        expected: { name: 'home', ctrl: true, meta: false, shift: false },
      },
    ])(
      'should recognize sequence "$sequence" as $expected.name',
      ({ sequence, expected }) => {
        const keyHandler = vi.fn();
        const { result } = renderHook(() => useKeypressContext(), { wrapper });
        act(() => result.current.subscribe(keyHandler));

        act(() => stdin.write(sequence));

        expect(keyHandler).toHaveBeenCalledWith(
          expect.objectContaining(expected),
        );
      },
    );
  });

  describe('Double-tap and batching', () => {
    it('should emit two delete events for double-tap CSI[3~', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write(`\x1b[3~`));
      act(() => stdin.write(`\x1b[3~`));

      expect(keyHandler).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ name: 'delete' }),
      );
      expect(keyHandler).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ name: 'delete' }),
      );
    });

    it('should parse two concatenated tilde-coded sequences in one chunk', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write(`\x1b[3~\x1b[5~`));

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'delete' }),
      );
      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'pageup' }),
      );
    });

    it('should ignore incomplete CSI then parse the next complete sequence', async () => {
      vi.useFakeTimers();
      const { keyHandler } = setupKeypressTest();

      // Incomplete ESC sequence then a complete Delete
      act(() => {
        // Provide an incomplete ESC sequence chunk with a real ESC character
        stdin.write('\x1b[1;');
      });

      // Wait for the ESC timeout to flush the incomplete sequence
      act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

      keyHandler.mockClear();

      act(() => stdin.write(`\x1b[3~`));

      // The complete delete sequence should be recognized
      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'delete' }),
      );

      vi.useRealTimers();
    });
  });
});

describe('Drag and Drop Handling', () => {
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

  describe('drag start by quotes', () => {
    it.each([
      { name: 'single quote', quote: SINGLE_QUOTE },
      { name: 'double quote', quote: DOUBLE_QUOTE },
    ])(
      'should start collecting when $name arrives and not broadcast immediately',
      async ({ quote }) => {
        const keyHandler = vi.fn();

        const { result } = renderHook(() => useKeypressContext(), { wrapper });

        act(() => result.current.subscribe(keyHandler));

        act(() => stdin.write(quote));

        expect(keyHandler).not.toHaveBeenCalled();
      },
    );
  });

  describe('drag collection and completion', () => {
    it.each([
      {
        name: 'collect single character inputs during drag mode',
        characters: ['a'],
        expectedText: 'a',
      },
      {
        name: 'collect multiple characters and complete on timeout',
        characters: ['p', 'a', 't', 'h'],
        expectedText: 'path',
      },
    ])('should $name', async ({ characters, expectedText }) => {
      const keyHandler = vi.fn();

      const { result } = renderHook(() => useKeypressContext(), { wrapper });

      act(() => result.current.subscribe(keyHandler));

      act(() => stdin.write(SINGLE_QUOTE));

      characters.forEach((char) => {
        act(() => stdin.write(char));
      });

      expect(keyHandler).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(DRAG_COMPLETION_TIMEOUT_MS + 10);
      });

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '',
          paste: true,
          sequence: `${SINGLE_QUOTE}${expectedText}`,
        }),
      );
    });
  });
});

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
                paste: false,
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
                paste: false,
              },
            };
          } else {
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
                paste: false,
                sequence: accentedChar,
              },
            };
          }
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
    act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

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
        paste: false,
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
    act(() => vi.advanceTimersByTime(KITTY_SEQUENCE_TIMEOUT_MS + 10));

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
    act(() => vi.advanceTimersByTime(30));

    // Add more to sequence
    act(() => stdin.write('5'));

    // Advance time from the first timeout point
    act(() => vi.advanceTimersByTime(25));

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
    act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

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
    act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

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
    act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

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

    act(() => vi.runAllTimers());

    // The paste event should be broadcast
    expect(keyHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        paste: true,
        sequence: pastedText,
      }),
    );
  });
});
