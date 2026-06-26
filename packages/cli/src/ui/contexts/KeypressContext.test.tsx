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
import {
  KeypressProvider,
  useKeypressContext,
  DRAG_COMPLETION_TIMEOUT_MS,
  ESC_TIMEOUT,
  SINGLE_QUOTE,
  DOUBLE_QUOTE,
  FAST_RETURN_TIMEOUT,
} from './KeypressContext.js';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';

// Alias for backwards compatibility with tests
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

    it('should recognize \n (LF) as ctrl+j', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('\n'));

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'j',
          ctrl: true,
          meta: false,
          shift: false,
        }),
      );
    });

    it('should recognize \\x1b\\n as Alt+Enter (return with meta)', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('\x1b\n'));

      expect(keyHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'return',
          ctrl: false,
          meta: true,
          shift: false,
        }),
      );
    });
  });

  describe('Fast return buffering', () => {
    let kittySpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.useFakeTimers();
      kittySpy = vi
        .spyOn(terminalCapabilityManager, 'isKittyProtocolEnabled')
        .mockReturnValue(false);
    });

    afterEach(() => {
      vi.useRealTimers();
      kittySpy.mockRestore();
    });

    it('should always buffer return key pressed quickly after another key (unconditional)', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('a'));
      expect(keyHandler).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'a' }),
      );

      act(() => stdin.write('\r'));

      expect(keyHandler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'return',
          sequence: '\r',
          insertable: true,
          shift: true,
          ctrl: false,
          meta: false,
        }),
      );
    });

    it('should buffer return key even when kitty protocol is enabled', async () => {
      // Override the spy to return true for kitty enabled
      kittySpy.mockReturnValue(true);

      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('a'));
      expect(keyHandler).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'a' }),
      );

      act(() => stdin.write('\r'));

      // Now bufferFastReturn is always applied, so return should be buffered
      expect(keyHandler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'return',
          sequence: '\r',
          insertable: true,
          shift: true,
          ctrl: false,
          meta: false,
        }),
      );
    });

    it('should NOT buffer return key if delay is long enough', async () => {
      const { keyHandler } = setupKeypressTest();

      act(() => stdin.write('a'));

      vi.advanceTimersByTime(FAST_RETURN_TIMEOUT + 1);

      act(() => stdin.write('\r'));

      expect(keyHandler).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'return',
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

  describe('Tab, Backspace, and Space handling', () => {
    it.each([
      {
        name: 'Tab key',
        inputSequence: '\x1b[9u',
        expected: { name: 'tab', shift: false },
      },
      {
        name: 'Shift+Tab',
        inputSequence: '\x1b[9;2u',
        expected: { name: 'tab', shift: true },
      },
      {
        name: 'Backspace',
        inputSequence: '\x1b[127u',
        expected: { name: 'backspace', meta: false },
      },
      {
        name: 'Option+Backspace',
        inputSequence: '\x1b[127;3u',
        expected: { name: 'backspace', meta: true },
      },
      {
        name: 'Ctrl+Backspace',
        inputSequence: '\x1b[127;5u',
        expected: { name: 'backspace', ctrl: true },
      },
      {
        name: 'Shift+Space',
        inputSequence: '\x1b[32;2u',
        expected: {
          name: 'space',
          shift: true,
          insertable: true,
          sequence: ' ',
        },
      },
      {
        name: 'Ctrl+Space',
        inputSequence: '\x1b[32;5u',
        expected: {
          name: 'space',
          ctrl: true,
          insertable: false,
          sequence: '\x1b[32;5u',
        },
      },
    ])(
      'should recognize $name in kitty protocol',
      async ({ inputSequence, expected }) => {
        const { keyHandler } = setupKeypressTest();

        act(() => {
          stdin.write(inputSequence);
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
          name: 'paste',
          sequence: pastedText,
        }),
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
      void act(() => vi.advanceTimersByTime(ESC_TIMEOUT + 10));

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
          name: 'paste',
          sequence: `${SINGLE_QUOTE}${expectedText}`,
        }),
      );
    });
  });
});
