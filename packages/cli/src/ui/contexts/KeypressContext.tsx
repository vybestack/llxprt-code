/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger, type Config } from '@vybestack/llxprt-code-core';
import {
  KittySequenceOverflowEvent,
  logKittySequenceOverflow,
} from '@vybestack/llxprt-code-core';
import { useStdin } from 'ink';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import {
  BACKSLASH_ENTER_DETECTION_WINDOW_MS,
  CHAR_CODE_ESC,
  KITTY_CTRL_C,
  KITTY_KEYCODE_BACKSPACE,
  KITTY_KEYCODE_ENTER,
  KITTY_KEYCODE_NUMPAD_ENTER,
  KITTY_KEYCODE_TAB,
  MAX_KITTY_SEQUENCE_LENGTH,
  KITTY_MODIFIER_BASE,
  KITTY_MODIFIER_EVENT_TYPES_OFFSET,
  MODIFIER_SHIFT_BIT,
  MODIFIER_ALT_BIT,
  MODIFIER_CTRL_BIT,
} from '../utils/platformConstants.js';

import { FOCUS_IN, FOCUS_OUT } from '../hooks/useFocus.js';
import {
  ENABLE_BRACKETED_PASTE,
  DISABLE_BRACKETED_PASTE,
  ENABLE_FOCUS_TRACKING,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from '../utils/terminalSequences.js';
import { enableSupportedProtocol } from '../utils/kittyProtocolDetector.js';
import { isIncompleteMouseSequence, parseMouseEvent } from '../utils/mouse.js';

const ESC = '\u001B';
const keypressLogger = new DebugLogger('llxprt:ui:keypress');
export const PASTE_MODE_PREFIX = `${ESC}[200~`;
export const PASTE_MODE_SUFFIX = `${ESC}[201~`;
export const DRAG_COMPLETION_TIMEOUT_MS = 100; // Broadcast full path after 100ms if no more input
export const KITTY_SEQUENCE_TIMEOUT_MS = 50; // Flush incomplete kitty sequences after 50ms
export const SINGLE_QUOTE = "'";
export const DOUBLE_QUOTE = '"';
const MAX_MOUSE_BUFFER_SIZE = 4096;

const ALT_KEY_CHARACTER_MAP: Record<string, string> = {
  '\u00E5': 'a',
  '\u222B': 'b',
  '\u00E7': 'c',
  '\u2202': 'd',
  '\u00B4': 'e',
  '\u0192': 'f',
  '\u00A9': 'g',
  '\u02D9': 'h',
  '\u02C6': 'i',
  '\u2206': 'j',
  '\u02DA': 'k',
  '\u00AC': 'l',
  '\u00B5': 'm',
  '\u02DC': 'n',
  '\u00F8': 'o',
  '\u03C0': 'p',
  '\u0153': 'q',
  '\u00AE': 'r',
  '\u00DF': 's',
  '\u2020': 't',
  '\u00A8': 'u',
  '\u25CA': 'v',
  '\u201E': 'w',
  '\u02DB': 'x',
  '\u00C1': 'y',
  '\u03A9': 'z',
};

// IME interference handling constants - moved to module level for performance
const IME_CTRL_C_MAPPINGS = new Map<number, 'c'>([
  [12559, 'c'], // Chinese Bopomofo: ㄏ
  [12363, 'c'], // Japanese Hiragana: か
  [12459, 'c'], // Japanese Katakana: カ
  [12622, 'c'], // Korean Hangul: ᄎ
  [231, 'c'], // French/Portuguese: ç
]);

const IME_ESSENTIAL_MAPPINGS = new Map<number, string>([
  // Basic editing shortcuts - highest frequency usage
  [12558, 'v'], // Chinese Bopomofo: ㄎ - Ctrl+V (paste)
  [12557, 'x'], // Chinese Bopomofo: ㄍ - Ctrl+X (cut)
  [12556, 'z'], // Chinese Bopomofo: ㄐ - Ctrl+Z (undo)
  [12554, 'a'], // Chinese Bopomofo: ㄒ - Ctrl+A (select all)
  [12553, 's'], // Chinese Bopomofo: ㄓ - Ctrl+S (save)

  // Japanese IME - most common interference
  [12364, 'v'], // Hiragana: き - Ctrl+V
  [12366, 'x'], // Hiragana: く - Ctrl+X
  [12378, 'z'], // Hiragana: ず - Ctrl+Z
  [12354, 'a'], // Hiragana: あ - Ctrl+A
  [12377, 's'], // Hiragana: す - Ctrl+S

  // Korean Hangul - essential patterns
  [48708, 'v'], // 비 - Ctrl+V
  [49828, 'x'], // 시 - Ctrl+X
  [51652, 'z'], // 지 - Ctrl+Z
  [50500, 'a'], // 아 - Ctrl+A
  [49836, 's'], // 사 - Ctrl+S

  // Common European diacritics that interfere with Ctrl shortcuts
  [226, 'v'], // Vietnamese: â - Ctrl+V
  [225, 'a'], // Vietnamese: á - Ctrl+A
  [234, 'e'], // Vietnamese: ê - Ctrl+E
  [233, 'e'], // French: é - Ctrl+E
  [228, 'a'], // German: ä - Ctrl+A
  [246, 'o'], // German: ö - Ctrl+O
  [252, 'u'], // German: ü - Ctrl+U
]);

/**
 * Maps symbols from parameterized functional keys `\x1b[1;1<letter>`
 * to their corresponding key names (e.g., 'up', 'f1').
 */
const LEGACY_FUNC_TO_NAME: { [k: string]: string } = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
};

/**
 * Maps key codes from tilde-coded functional keys `\x1b[<code>~`
 * to their corresponding key names.
 */
const TILDE_KEYCODE_TO_NAME: Record<number, string> = {
  1: 'home',
  2: 'insert',
  3: 'delete',
  4: 'end',
  5: 'pageup',
  6: 'pagedown',
  11: 'f1',
  12: 'f2',
  13: 'f3',
  14: 'f4',
  15: 'f5',
  17: 'f6', // skipping 16 is intentional
  18: 'f7',
  19: 'f8',
  20: 'f9',
  21: 'f10',
  23: 'f11', // skipping 22 is intentional
  24: 'f12',
};
export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  paste: boolean;
  sequence: string;
  kittyProtocol?: boolean;
  insertable?: boolean;
}

export type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
  refresh: () => void;
}

const KeypressContext = createContext<KeypressContextValue | undefined>(
  undefined,
);

export function useKeypressContext() {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error(
      'useKeypressContext must be used within a KeypressProvider',
    );
  }
  return context;
}

/**
 * Provides a React context that captures terminal keypresses and broadcasts parsed key events to subscribers.
 *
 * This component manages stdin raw mode and emits normalized Key objects (including support for Kitty protocol parsing,
 * paste start/end payloads, drag-like quote buffering, modifier mapping, and the `insertable` flag) to handlers
 * registered via the KeypressContext. It also flushes buffered input on focus/paste interruptions and on unmount.
 *
 * @param children - React children to be wrapped by the provider
 * @param kittyProtocolEnabled - Enable parsing and buffering of Kitty/CSI parameterized sequences
 * @param config - Optional runtime configuration used for logging and overflow events
 * @param debugKeystrokeLogging - When true, enable verbose debug logging of internal key parsing and buffering
 * @returns The provider React element that supplies the KeypressContext to descendants
 */
export function KeypressProvider({
  children,
  kittyProtocolEnabled,
  config,
  debugKeystrokeLogging,
  mouseEventsEnabled,
}: {
  children: React.ReactNode;
  kittyProtocolEnabled: boolean;
  config?: Config;
  debugKeystrokeLogging?: boolean;
  mouseEventsEnabled?: boolean;
}) {
  const { stdin, setRawMode } = useStdin();
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;
  const isDraggingRef = useRef(false);
  const dragBufferRef = useRef('');
  const draggingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const subscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.add(handler);
    },
    [subscribers],
  );

  const unsubscribe = useCallback(
    (handler: KeypressHandler) => {
      subscribers.delete(handler);
    },
    [subscribers],
  );

  const [refreshGeneration, setRefreshGeneration] = useState(0);

  useEffect(() => {
    if (keypressLogger.enabled) {
      keypressLogger.debug(
        () =>
          `Initializing keypress listeners (generation ${refreshGeneration})`,
      );
    }
    const clearDraggingTimer = () => {
      if (draggingTimerRef.current) {
        clearTimeout(draggingTimerRef.current);
        draggingTimerRef.current = null;
      }
    };

    const wasRaw = stdin.isRaw;
    const rawManaged = wasRaw === false;
    if (rawManaged) {
      setRawMode(true);
    }

    const keypressStream = new PassThrough();
    let usePassthrough = false;
    const nodeMajorVersion = parseInt(process.versions.node.split('.')[0], 10);
    if (
      mouseEventsEnabled ||
      nodeMajorVersion < 20 ||
      process.env['PASTE_WORKAROUND'] === '1' ||
      process.env['PASTE_WORKAROUND'] === 'true'
    ) {
      usePassthrough = true;
    }

    let isPaste = false;
    let pasteBuffer = Buffer.alloc(0);
    let kittySequenceBuffer = '';
    let kittySequenceTimeout: NodeJS.Timeout | null = null;
    let backslashTimeout: NodeJS.Timeout | null = null;
    let waitingForEnterAfterBackslash = false;
    let mouseSequenceBuffer = '';

    // Check if a buffer could potentially be a valid kitty sequence or its prefix
    const couldBeKittySequence = (buffer: string): boolean => {
      // Kitty sequences always start with ESC[.
      if (buffer.length === 0) return true;
      if (buffer === ESC || buffer === `${ESC}[`) return true;

      if (!buffer.startsWith(`${ESC}[`)) return false;

      // Check for known kitty sequence patterns:
      // 1. ESC[<digit> - could be CSI-u or tilde-coded
      // 2. ESC[1;<digit> - parameterized functional
      // 3. ESC[<letter> - legacy functional keys
      // 4. ESC[Z - reverse tab
      const afterCSI = buffer.slice(2);

      // Check if it starts with a digit (could be CSI-u or parameterized)
      if (/^\d/.test(afterCSI)) return true;

      // Check for known single-letter sequences
      if (/^[ABCDHFPQRSZ]/.test(afterCSI)) return true;

      // Check for 1; pattern (parameterized sequences)
      if (/^1;\d/.test(afterCSI)) return true;

      // Anything else starting with ESC[ that doesn't match our patterns
      // is likely not a kitty sequence we handle
      return false;
    };

    // Temporary workaround for IME interference with Ctrl combinations
    // TODO: Replace with a more robust IME-aware input handling system
    // This is a short-term solution to handle the most common IME conflicts
    // while we develop a proper internationalization strategy.
    const handleIMECtrlChar = (code: number): string | null => {
      // Check for Ctrl+C first (highest priority for system stability)
      // This ensures interrupt/cancel functionality works across IME configurations
      if (IME_CTRL_C_MAPPINGS.has(code)) {
        return 'c';
      }

      return IME_ESSENTIAL_MAPPINGS.get(code) || null;
    };

    // Parse a single complete kitty sequence from the start (prefix) of the
    // buffer and return both the Key and the number of characters consumed.
    // This lets us "peel off" one complete event when multiple sequences arrive
    // in a single chunk, preventing buffer overflow and fragmentation.
    // Parse a single complete kitty/parameterized/legacy sequence from the start
    // of the buffer and return both the parsed Key and the number of characters
    // consumed. This enables peel-and-continue parsing for batched input.
    const parseKittyPrefix = (
      buffer: string,
    ): { key: Key; length: number } | null => {
      // In older terminals ESC [ Z was used as Cursor Backward Tabulation (CBT)
      // In newer terminals the same functionality of key combination for moving
      // backward through focusable elements is Shift+Tab, hence we will
      // map ESC [ Z to Shift+Tab
      // 0) Reverse Tab (legacy): ESC [ Z
      //    Treat as Shift+Tab for UI purposes.
      //    Regex parts:
      //    ^     - start of buffer
      //    ESC [ - CSI introducer
      //    Z     - legacy reverse tab
      const revTabLegacy = new RegExp(`^${ESC}\\[Z`);
      let m = buffer.match(revTabLegacy);
      if (m) {
        return {
          key: {
            name: 'tab',
            ctrl: false,
            meta: false,
            shift: true,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 1) Reverse Tab (parameterized): ESC [ 1 ; <mods> Z
      //    Parameterized reverse Tab: ESC [ 1 ; <mods> Z
      const revTabParam = new RegExp(`^${ESC}\\[1;(\\d+)Z`);
      m = buffer.match(revTabParam);
      if (m) {
        let mods = parseInt(m[1], 10);
        if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const bits = mods - KITTY_MODIFIER_BASE;
        const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        return {
          key: {
            name: 'tab',
            ctrl,
            meta: alt,
            // Reverse tab implies Shift behavior; force shift regardless of mods
            shift: true,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 2) Parameterized functional: ESC [ 1 ; <mods> (A|B|C|D|H|F|P|Q|R|S)
      // 2) Parameterized functional: ESC [ 1 ; <mods> (A|B|C|D|H|F|P|Q|R|S)
      //    Arrows, Home/End, F1–F4 with modifiers encoded in <mods>.
      const arrowPrefix = new RegExp(`^${ESC}\\[1;(\\d+)([ABCDHFPQSR])`);
      m = buffer.match(arrowPrefix);
      if (m) {
        let mods = parseInt(m[1], 10);
        if (mods >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          mods -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const bits = mods - KITTY_MODIFIER_BASE;
        const shift = (bits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT;
        const alt = (bits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (bits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        const sym = m[2];
        const name = LEGACY_FUNC_TO_NAME[sym] || '';
        if (!name) return null;
        return {
          key: {
            name,
            ctrl,
            meta: alt,
            shift,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      // 3) CSI-u form: ESC [ <code> ; <mods> (u|~)
      // 3) CSI-u and tilde-coded functional keys: ESC [ <code> ; <mods> (u|~)
      //    'u' terminator: Kitty CSI-u; '~' terminator: tilde-coded function keys.
      const csiUPrefix = new RegExp(`^${ESC}\\[(\\d+)(;(\\d+))?([u~])`);
      m = buffer.match(csiUPrefix);
      if (m) {
        const keyCode = parseInt(m[1], 10);
        let modifiers = m[3] ? parseInt(m[3], 10) : KITTY_MODIFIER_BASE;
        if (modifiers >= KITTY_MODIFIER_EVENT_TYPES_OFFSET) {
          modifiers -= KITTY_MODIFIER_EVENT_TYPES_OFFSET;
        }
        const modifierBits = modifiers - KITTY_MODIFIER_BASE;
        const shift =
          (modifierBits & MODIFIER_SHIFT_BIT) === MODIFIER_SHIFT_BIT;
        const alt = (modifierBits & MODIFIER_ALT_BIT) === MODIFIER_ALT_BIT;
        const ctrl = (modifierBits & MODIFIER_CTRL_BIT) === MODIFIER_CTRL_BIT;
        const terminator = m[4];

        // Tilde-coded functional keys (Delete, Insert, PageUp/Down, Home/End)
        if (terminator === '~') {
          const name = TILDE_KEYCODE_TO_NAME[keyCode];
          if (name) {
            return {
              key: {
                name,
                ctrl,
                meta: alt,
                shift,
                paste: false,
                sequence: buffer.slice(0, m[0].length),
                kittyProtocol: true,
              },
              length: m[0].length,
            };
          }
        }

        const kittyKeyCodeToName: { [key: number]: string } = {
          [CHAR_CODE_ESC]: 'escape',
          [KITTY_KEYCODE_TAB]: 'tab',
          [KITTY_KEYCODE_BACKSPACE]: 'backspace',
          [KITTY_KEYCODE_ENTER]: 'return',
          [KITTY_KEYCODE_NUMPAD_ENTER]: 'return',
        };

        const name = kittyKeyCodeToName[keyCode];
        if (name) {
          return {
            key: {
              name,
              ctrl,
              meta: alt,
              shift,
              paste: false,
              sequence: buffer.slice(0, m[0].length),
              kittyProtocol: true,
            },
            length: m[0].length,
          };
        }

        // Ctrl+Backslash is a common "quit" control char (FS / \x1c) in many terminals.
        // When Kitty keyboard protocol is enabled it may arrive as CSI-u with keyCode=92,
        // so normalize it to a backslash key with ctrl=true for downstream bindings.
        if (ctrl && keyCode === '\\'.charCodeAt(0)) {
          return {
            key: {
              name: '\\',
              ctrl: true,
              meta: alt,
              shift,
              paste: false,
              sequence: buffer.slice(0, m[0].length),
              kittyProtocol: true,
            },
            length: m[0].length,
          };
        }

        // Ctrl+letters and Alt+letters
        if (ctrl || alt) {
          let letter: string | undefined;

          // Standard ASCII letters
          if (
            (keyCode >= 'a'.charCodeAt(0) && keyCode <= 'z'.charCodeAt(0)) ||
            (keyCode >= 'A'.charCodeAt(0) && keyCode <= 'Z'.charCodeAt(0))
          ) {
            letter = String.fromCharCode(keyCode).toLowerCase();
          }
          // Handle IME interference: if Ctrl is pressed and we get a non-ASCII character,
          // try to map it back to the intended Ctrl+letter
          else if (ctrl && keyCode > 127) {
            const mappedLetter = handleIMECtrlChar(keyCode);
            if (mappedLetter) {
              letter = mappedLetter;
            }
          }

          if (letter) {
            return {
              key: {
                name: letter,
                ctrl,
                meta: alt,
                shift,
                paste: false,
                sequence: buffer.slice(0, m[0].length),
                kittyProtocol: true,
              },
              length: m[0].length,
            };
          }
        }
      }

      // 4) Legacy function keys (no parameters): ESC [ (A|B|C|D|H|F)
      //    Arrows + Home/End without modifiers.
      const legacyFuncKey = new RegExp(`^${ESC}\\[([ABCDHF])`);
      m = buffer.match(legacyFuncKey);
      if (m) {
        const sym = m[1];
        const name = LEGACY_FUNC_TO_NAME[sym] || sym.toLowerCase();
        return {
          key: {
            name,
            ctrl: false,
            meta: false,
            shift: false,
            paste: false,
            sequence: buffer.slice(0, m[0].length),
            kittyProtocol: true,
          },
          length: m[0].length,
        };
      }

      return null;
    };

    const broadcast = (key: Key) => {
      for (const handler of subscribers) {
        handler(key);
      }
    };

    const flushKittyBufferOnInterrupt = (reason: string) => {
      if (kittySequenceBuffer) {
        if (debugKeystrokeLogging) {
          console.log(
            `[DEBUG] Kitty sequence flushed due to ${reason}:`,
            JSON.stringify(kittySequenceBuffer),
          );
        }
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: kittySequenceBuffer,
        });
        kittySequenceBuffer = '';
      }
      if (kittySequenceTimeout) {
        clearTimeout(kittySequenceTimeout);
        kittySequenceTimeout = null;
      }
    };

    const handleFocusEvent = (key: Key): boolean => {
      if (key.sequence === FOCUS_IN || key.sequence === FOCUS_OUT) {
        flushKittyBufferOnInterrupt('focus event');
        return true;
      }
      return false;
    };

    const handlePasteEvent = (key: Key): boolean => {
      if (key.name === 'paste-start') {
        flushKittyBufferOnInterrupt('paste start');
        isPaste = true;
        return true;
      }
      if (key.name === 'paste-end') {
        isPaste = false;
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
        return true;
      }
      return false;
    };

    const handleDragSequence = (key: Key): boolean => {
      if (
        key.sequence === SINGLE_QUOTE ||
        key.sequence === DOUBLE_QUOTE ||
        isDraggingRef.current
      ) {
        isDraggingRef.current = true;
        dragBufferRef.current += key.sequence;

        clearDraggingTimer();
        draggingTimerRef.current = setTimeout(() => {
          isDraggingRef.current = false;
          const seq = dragBufferRef.current;
          dragBufferRef.current = '';
          if (seq) {
            broadcast({
              ...key,
              name: '',
              paste: true,
              sequence: seq,
              ctrl: false,
              meta: false,
              shift: false,
              insertable: true,
            });
          }
        }, DRAG_COMPLETION_TIMEOUT_MS);

        return true;
      }
      return false;
    };

    const handleArrowKeys = (key: Key): boolean => {
      if (['up', 'down', 'left', 'right'].includes(key.name)) {
        broadcast({ ...key, insertable: false });
        return true;
      }
      return false;
    };

    const handleCtrlC = (key: Key): boolean => {
      if (
        (key.ctrl && key.name === 'c') ||
        key.sequence === `${ESC}${KITTY_CTRL_C}`
      ) {
        if (kittySequenceBuffer && debugKeystrokeLogging) {
          console.log(
            '[DEBUG] Kitty buffer cleared on Ctrl+C:',
            kittySequenceBuffer,
          );
        }
        kittySequenceBuffer = '';
        if (kittySequenceTimeout) {
          clearTimeout(kittySequenceTimeout);
          kittySequenceTimeout = null;
        }
        if (key.sequence === `${ESC}${KITTY_CTRL_C}`) {
          broadcast({
            name: 'c',
            ctrl: true,
            meta: false,
            shift: false,
            paste: false,
            sequence: key.sequence,
            kittyProtocol: true,
          });
        } else {
          broadcast(key);
        }
        return true;
      }
      return false;
    };

    const handleAltKeyMapping = (key: Key): boolean => {
      const mappedLetter = ALT_KEY_CHARACTER_MAP[key.sequence];
      if (mappedLetter && !key.meta) {
        broadcast({
          name: mappedLetter,
          ctrl: false,
          meta: true,
          shift: false,
          paste: isPaste,
          sequence: key.sequence,
        });
        return true;
      }
      return false;
    };

    const handleBackslashEnter = (key: Key): boolean => {
      if (key.name === 'return' && waitingForEnterAfterBackslash) {
        if (backslashTimeout) {
          clearTimeout(backslashTimeout);
          backslashTimeout = null;
        }
        waitingForEnterAfterBackslash = false;
        broadcast({
          ...key,
          shift: true,
          sequence: '\r', // Corrected escaping for newline
          insertable: false,
        });
        return true;
      }

      if (key.sequence === '\\' && !key.name) {
        // Corrected escaping for backslash
        waitingForEnterAfterBackslash = true;
        backslashTimeout = setTimeout(() => {
          waitingForEnterAfterBackslash = false;
          backslashTimeout = null;
          broadcast(key);
        }, BACKSLASH_ENTER_DETECTION_WINDOW_MS);
        return true;
      }

      if (waitingForEnterAfterBackslash && key.name !== 'return') {
        if (backslashTimeout) {
          clearTimeout(backslashTimeout);
          backslashTimeout = null;
        }
        waitingForEnterAfterBackslash = false;
        broadcast({
          name: '',
          sequence: '\\',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
        });
        return true;
      }
      return false;
    };

    const flushKittyBuffer = (buffer: string): void => {
      broadcast({
        name: '',
        ctrl: false,
        meta: false,
        shift: false,
        paste: false,
        sequence: buffer,
      });
    };

    const handleKittyOverflow = (buffer: string): void => {
      if (debugKeystrokeLogging) {
        console.log(
          '[DEBUG] Kitty buffer overflow, clearing:',
          JSON.stringify(buffer),
        );
      }
      if (config) {
        const event = new KittySequenceOverflowEvent(buffer.length, buffer);
        logKittySequenceOverflow(config, event);
      }
      flushKittyBuffer(buffer);
    };

    const processKittyBuffer = (
      buffer: string,
    ): { parsed: boolean; remaining: string } => {
      let remainingBuffer = buffer;
      let parsedAny = false;

      while (remainingBuffer) {
        const parsed = parseKittyPrefix(remainingBuffer);

        if (parsed) {
          if (debugKeystrokeLogging) {
            const parsedSequence = remainingBuffer.slice(0, parsed.length);
            console.log(
              '[DEBUG] Kitty sequence parsed successfully:',
              JSON.stringify(parsedSequence),
            );
          }
          broadcast(parsed.key);
          remainingBuffer = remainingBuffer.slice(parsed.length);
          parsedAny = true;
        } else {
          // If we can't parse a sequence at the start, check if there's
          // another ESC later in the buffer. If so, the data before it
          // is garbage/incomplete and should be dropped so we can
          // process the next sequence.
          const nextEscIndex = remainingBuffer.indexOf(ESC, 1);
          if (nextEscIndex !== -1) {
            const garbage = remainingBuffer.slice(0, nextEscIndex);
            if (debugKeystrokeLogging) {
              console.log(
                '[DEBUG] Dropping incomplete sequence before next ESC:',
                JSON.stringify(garbage),
              );
            }
            // Drop garbage and continue parsing from next ESC
            remainingBuffer = remainingBuffer.slice(nextEscIndex);
            // We made progress, so we can continue the loop to parse the next sequence
            continue;
          }

          // Check if buffer could become a valid kitty sequence
          const couldBeValid = couldBeKittySequence(remainingBuffer);

          if (!couldBeValid) {
            // Not a kitty sequence - flush as regular input immediately
            if (debugKeystrokeLogging) {
              console.log(
                '[DEBUG] Not a kitty sequence, flushing:',
                JSON.stringify(remainingBuffer),
              );
            }
            flushKittyBuffer(remainingBuffer);
            remainingBuffer = '';
            parsedAny = true;
          } else if (remainingBuffer.length > MAX_KITTY_SEQUENCE_LENGTH) {
            handleKittyOverflow(remainingBuffer);
            remainingBuffer = '';
            parsedAny = true;
          } else {
            if (config?.getDebugMode() || debugKeystrokeLogging) {
              console.warn(
                'Kitty sequence buffer has content:',
                JSON.stringify(kittySequenceBuffer),
              );
            }
            // Could be valid but incomplete - set timeout
            kittySequenceTimeout = setTimeout(() => {
              if (kittySequenceBuffer) {
                if (debugKeystrokeLogging) {
                  console.log(
                    '[DEBUG] Kitty sequence timeout, flushing:',
                    JSON.stringify(kittySequenceBuffer),
                  );
                }
                flushKittyBuffer(kittySequenceBuffer);
                kittySequenceBuffer = '';
              }
              kittySequenceTimeout = null;
            }, KITTY_SEQUENCE_TIMEOUT_MS);
            break;
          }
        }
      }

      return { parsed: parsedAny, remaining: remainingBuffer };
    };

    const handleKittyProtocol = (key: Key): boolean => {
      // Clear any pending timeout when new input arrives
      if (kittySequenceTimeout) {
        clearTimeout(kittySequenceTimeout);
        kittySequenceTimeout = null;
      }

      // Check if this could start a kitty sequence
      const shouldBuffer = couldBeKittySequence(key.sequence);
      const isExcluded = [
        PASTE_MODE_PREFIX,
        PASTE_MODE_SUFFIX,
        FOCUS_IN,
        FOCUS_OUT,
      ].some((prefix) => key.sequence.startsWith(prefix));

      if (kittySequenceBuffer || (shouldBuffer && !isExcluded)) {
        kittySequenceBuffer += key.sequence;

        if (debugKeystrokeLogging) {
          console.log(
            '[DEBUG] Kitty buffer accumulating:',
            JSON.stringify(kittySequenceBuffer),
          );
        }

        // Try immediate parsing
        const result = processKittyBuffer(kittySequenceBuffer);
        kittySequenceBuffer = result.remaining;

        if (result.parsed || kittySequenceBuffer) {
          return true;
        }
      }

      return false;
    };

    const handleKeypress = (_: unknown, key: Key) => {
      if (mouseEventsEnabled && parseMouseEvent(key.sequence)) {
        return;
      }

      if (
        key &&
        keypressLogger.enabled &&
        (key.name === 'return' || key.sequence === '\r')
      ) {
        keypressLogger.debug(
          () =>
            `handleKeypress return event seq=${JSON.stringify(
              key.sequence,
            )} ctrl=${key.ctrl} meta=${key.meta} paste=${isPaste} kitty=${
              key.kittyProtocol ? '1' : '0'
            }`,
        );
      }
      if (handleFocusEvent(key)) return;
      if (handlePasteEvent(key)) return;

      // Handle Ctrl+Z (suspend) - must check before other handlers
      if (key.name === 'z' && key.ctrl && !key.meta && rawManaged) {
        // Disable raw mode
        setRawMode(false);

        // Restore cursor and disable terminal modes
        process.stdout.write(SHOW_CURSOR);
        process.stdout.write(DISABLE_BRACKETED_PASTE);
        process.stdout.write(DISABLE_FOCUS_TRACKING);

        // Send SIGTSTP to suspend the process
        process.kill(process.pid, 'SIGTSTP');
        return;
      }

      if (isPaste) {
        pasteBuffer = Buffer.concat([pasteBuffer, Buffer.from(key.sequence)]);
        return;
      }

      if (handleDragSequence(key)) return;

      if (handleAltKeyMapping(key)) return;

      if (handleBackslashEnter(key)) return;

      if (handleArrowKeys(key)) return;

      if (handleCtrlC(key)) return;

      if (kittyProtocolEnabled && handleKittyProtocol(key)) return;

      // Handle Meta+Enter for legacy terminals
      if (key.name === 'return' && key.sequence === `${ESC}\r`) {
        key.meta = true;
      }

      const shouldInsert = !key.ctrl && !key.meta && key.sequence.length > 0;
      broadcast({
        ...key,
        paste: isPaste,
        insertable: shouldInsert,
      });
    };

    const handleRawKeypress = (data: Buffer) => {
      if (keypressLogger.enabled) {
        keypressLogger.debug(
          () =>
            `handleRawKeypress chunk length=${data.length} endsWithCR=${
              data.length > 0 && data[data.length - 1] === 13
            }`,
        );
      }

      if (mouseSequenceBuffer.length > MAX_MOUSE_BUFFER_SIZE) {
        mouseSequenceBuffer = mouseSequenceBuffer.slice(-MAX_MOUSE_BUFFER_SIZE);
      }

      const stripMouseSequences = (chunk: Buffer): Buffer => {
        const input = mouseSequenceBuffer + chunk.toString('utf8');
        mouseSequenceBuffer = '';

        let output = '';
        let i = 0;
        while (i < input.length) {
          if (input[i] !== ESC) {
            output += input[i];
            i += 1;
            continue;
          }

          const slice = input.slice(i);
          const parsed = parseMouseEvent(slice);
          if (parsed) {
            i += parsed.length;
            continue;
          }

          if (isIncompleteMouseSequence(slice)) {
            mouseSequenceBuffer = slice;
            break;
          }

          output += input[i];
          i += 1;
        }

        return Buffer.from(output, 'utf8');
      };

      const filteredData = mouseEventsEnabled
        ? stripMouseSequences(data)
        : data;
      if (filteredData.length === 0) {
        return;
      }

      const pasteModePrefixBuffer = Buffer.from(PASTE_MODE_PREFIX);
      const pasteModeSuffixBuffer = Buffer.from(PASTE_MODE_SUFFIX);

      let pos = 0;
      while (pos < filteredData.length) {
        const prefixPos = filteredData.indexOf(pasteModePrefixBuffer, pos);
        const suffixPos = filteredData.indexOf(pasteModeSuffixBuffer, pos);
        const isPrefixNext =
          prefixPos !== -1 && (suffixPos === -1 || prefixPos < suffixPos);
        const isSuffixNext =
          suffixPos !== -1 && (prefixPos === -1 || suffixPos < prefixPos);

        let nextMarkerPos = -1;
        let markerLength = 0;

        if (isPrefixNext) {
          nextMarkerPos = prefixPos;
          markerLength = pasteModePrefixBuffer.length;
        } else if (isSuffixNext) {
          nextMarkerPos = suffixPos;
          markerLength = pasteModeSuffixBuffer.length;
        }

        if (nextMarkerPos === -1) {
          keypressStream.write(filteredData.slice(pos));
          return;
        }

        const nextData = filteredData.slice(pos, nextMarkerPos);
        if (nextData.length > 0) {
          keypressStream.write(nextData);
        }
        const createPasteKeyEvent = (
          name: 'paste-start' | 'paste-end',
        ): Key => ({
          name,
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: '',
        });
        if (isPrefixNext) {
          handleKeypress(undefined, createPasteKeyEvent('paste-start'));
        } else if (isSuffixNext) {
          handleKeypress(undefined, createPasteKeyEvent('paste-end'));
        }
        pos = nextMarkerPos + markerLength;
      }
    };

    // Handle SIGCONT (process resume after tmux reattach or fg)
    const handleSigcont = () => {
      if (!rawManaged) return;

      // Resume stdin and re-enable raw mode
      stdin.resume();
      setRawMode(true);

      // Re-send terminal control sequences
      process.stdout.write(ENABLE_BRACKETED_PASTE);
      process.stdout.write(ENABLE_FOCUS_TRACKING);
      enableSupportedProtocol();

      // Trigger a refresh to ensure the UI re-renders with proper prompt state
      // This is necessary because tmux reattach can cause the terminal to lose
      // the current display state, including the prompt text and cursor position
      setRefreshGeneration((prev) => prev + 1);
    };

    process.on('SIGCONT', handleSigcont);

    let rl: readline.Interface;
    if (usePassthrough) {
      rl = readline.createInterface({
        input: keypressStream,
        escapeCodeTimeout: 0,
      });
      readline.emitKeypressEvents(keypressStream, rl);
      keypressStream.on('keypress', handleKeypress);
      stdin.on('data', handleRawKeypress);
    } else {
      rl = readline.createInterface({ input: stdin, escapeCodeTimeout: 0 });
      readline.emitKeypressEvents(stdin, rl);
      stdin.on('keypress', handleKeypress);
    }

    return () => {
      if (keypressLogger.enabled) {
        keypressLogger.debug(
          () =>
            `Cleaning up keypress listeners (generation ${refreshGeneration})`,
        );
      }
      if (usePassthrough) {
        keypressStream.removeListener('keypress', handleKeypress);
        stdin.removeListener('data', handleRawKeypress);
      } else {
        stdin.removeListener('keypress', handleKeypress);
      }

      rl.close();

      // Remove SIGCONT listener
      process.removeListener('SIGCONT', handleSigcont);

      // Restore the terminal to its original state.
      if (wasRaw === false) {
        setRawMode(false);
      }

      // Best-effort restore of terminal modes we enable while running.
      // If we exit without running these, the user's terminal can be left with
      // bracketed paste / focus tracking enabled, which makes subsequent shells
      // print escape sequences for mouse/keys.
      process.stdout.write(SHOW_CURSOR);
      process.stdout.write(DISABLE_BRACKETED_PASTE);
      process.stdout.write(DISABLE_FOCUS_TRACKING);

      if (backslashTimeout) {
        clearTimeout(backslashTimeout);
        backslashTimeout = null;
      }

      if (kittySequenceTimeout) {
        clearTimeout(kittySequenceTimeout);
        kittySequenceTimeout = null;
      }

      // Flush any pending kitty sequence data to avoid data loss on exit.
      if (kittySequenceBuffer) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: false,
          sequence: kittySequenceBuffer,
        });
        kittySequenceBuffer = '';
      }

      // Flush any pending paste data to avoid data loss on exit.
      if (isPaste) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: pasteBuffer.toString(),
        });
        pasteBuffer = Buffer.alloc(0);
      }

      if (draggingTimerRef.current) {
        clearTimeout(draggingTimerRef.current);
        draggingTimerRef.current = null;
      }
      if (isDraggingRef.current && dragBufferRef.current) {
        broadcast({
          name: '',
          ctrl: false,
          meta: false,
          shift: false,
          paste: true,
          sequence: dragBufferRef.current,
          insertable: true,
        });
        isDraggingRef.current = false;
        dragBufferRef.current = '';
      }
    };
  }, [
    stdin,
    setRawMode,
    kittyProtocolEnabled,
    mouseEventsEnabled,
    config,
    subscribers,
    debugKeystrokeLogging,
    refreshGeneration,
  ]);

  const refresh = useCallback(() => {
    if (keypressLogger.enabled) {
      keypressLogger.debug(() => 'KeypressProvider refresh requested');
    }
    setRefreshGeneration((prev) => prev + 1);
  }, []);

  const contextValue = useMemo(
    () => ({ subscribe, unsubscribe, refresh }),
    [subscribe, unsubscribe, refresh],
  );

  return (
    <KeypressContext.Provider value={contextValue}>
      {children}
    </KeypressContext.Provider>
  );
}
