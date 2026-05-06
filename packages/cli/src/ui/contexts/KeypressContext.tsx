/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type { Config } from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { useStdin } from 'ink';
import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import { ESC } from '../utils/input.js';
import { FOCUS_IN, FOCUS_OUT } from '../hooks/useFocus.js';
import { parseMouseEvent } from '../utils/mouse.js';

export const BACKSLASH_ENTER_TIMEOUT = 5;
export const ESC_TIMEOUT = 100;
export const PASTE_TIMEOUT = 30_000;
export const FAST_RETURN_TIMEOUT = 30;
export const DRAG_COMPLETION_TIMEOUT_MS = 100;
export const SINGLE_QUOTE = "'";
export const DOUBLE_QUOTE = '"';
const debugLogger = new DebugLogger('llxprt:ui:keypress');

const MAC_ALT_KEY_CHARACTER_MAP: Record<string, string> = {
  '\u222B': 'b',
  '\u0192': 'f',
  '\u00B5': 'm',
};

interface KeyInfo {
  name: string;
  shift?: boolean;
  ctrl?: boolean;
}

const KEY_INFO_MAP: Partial<Record<string, KeyInfo>> = {
  '[200~': { name: 'paste-start' },
  '[201~': { name: 'paste-end' },
  '[[A': { name: 'f1' },
  '[[B': { name: 'f2' },
  '[[C': { name: 'f3' },
  '[[D': { name: 'f4' },
  '[[E': { name: 'f5' },
  '[1~': { name: 'home' },
  '[2~': { name: 'insert' },
  '[3~': { name: 'delete' },
  '[4~': { name: 'end' },
  '[5~': { name: 'pageup' },
  '[6~': { name: 'pagedown' },
  '[7~': { name: 'home' },
  '[8~': { name: 'end' },
  '[11~': { name: 'f1' },
  '[12~': { name: 'f2' },
  '[13~': { name: 'f3' },
  '[14~': { name: 'f4' },
  '[15~': { name: 'f5' },
  '[17~': { name: 'f6' },
  '[18~': { name: 'f7' },
  '[19~': { name: 'f8' },
  '[20~': { name: 'f9' },
  '[21~': { name: 'f10' },
  '[23~': { name: 'f11' },
  '[24~': { name: 'f12' },
  '[A': { name: 'up' },
  '[B': { name: 'down' },
  '[C': { name: 'right' },
  '[D': { name: 'left' },
  '[E': { name: 'clear' },
  '[F': { name: 'end' },
  '[H': { name: 'home' },
  '[P': { name: 'f1' },
  '[Q': { name: 'f2' },
  '[R': { name: 'f3' },
  '[S': { name: 'f4' },
  OA: { name: 'up' },
  OB: { name: 'down' },
  OC: { name: 'right' },
  OD: { name: 'left' },
  OE: { name: 'clear' },
  OF: { name: 'end' },
  OH: { name: 'home' },
  OP: { name: 'f1' },
  OQ: { name: 'f2' },
  OR: { name: 'f3' },
  OS: { name: 'f4' },
  '[[5~': { name: 'pageup' },
  '[[6~': { name: 'pagedown' },
  '[9u': { name: 'tab' },
  '[13u': { name: 'return' },
  '[27u': { name: 'escape' },
  '[32u': { name: 'space' },
  '[127u': { name: 'backspace' },
  '[57414u': { name: 'return' },
  '[a': { name: 'up', shift: true },
  '[b': { name: 'down', shift: true },
  '[c': { name: 'right', shift: true },
  '[d': { name: 'left', shift: true },
  '[e': { name: 'clear', shift: true },
  '[2$': { name: 'insert', shift: true },
  '[3$': { name: 'delete', shift: true },
  '[5$': { name: 'pageup', shift: true },
  '[6$': { name: 'pagedown', shift: true },
  '[7$': { name: 'home', shift: true },
  '[8$': { name: 'end', shift: true },
  '[Z': { name: 'tab', shift: true },
  Oa: { name: 'up', ctrl: true },
  Ob: { name: 'down', ctrl: true },
  Oc: { name: 'right', ctrl: true },
  Od: { name: 'left', ctrl: true },
  Oe: { name: 'clear', ctrl: true },
  '[2^': { name: 'insert', ctrl: true },
  '[3^': { name: 'delete', ctrl: true },
  '[5^': { name: 'pageup', ctrl: true },
  '[6^': { name: 'pagedown', ctrl: true },
  '[7^': { name: 'home', ctrl: true },
  '[8^': { name: 'end', ctrl: true },
};

const kUTF16SurrogateThreshold = 0x10000;
function charLengthAt(str: string, i: number): number {
  if (str.length <= i) return 1;
  const code = str.codePointAt(i);
  return code !== undefined && code >= kUTF16SurrogateThreshold ? 2 : 1;
}

function nonKeyboardEventFilter(
  keypressHandler: KeypressHandler,
): KeypressHandler {
  return (key: Key) => {
    if (
      !parseMouseEvent(key.sequence) &&
      key.sequence !== FOCUS_IN &&
      key.sequence !== FOCUS_OUT
    ) {
      keypressHandler(key);
    }
  };
}

function bufferFastReturn(keypressHandler: KeypressHandler): KeypressHandler {
  let lastKeyTime = 0;
  return (key: Key) => {
    const now = Date.now();
    if (key.name === 'return' && now - lastKeyTime <= FAST_RETURN_TIMEOUT) {
      keypressHandler({
        ...key,
        name: 'return',
        shift: true,
        ctrl: false,
        meta: false,
        sequence: '\r',
        insertable: true,
      });
    } else {
      keypressHandler(key);
    }
    lastKeyTime = now;
  };
}

function bufferBackslashEnter(
  keypressHandler: KeypressHandler,
): KeypressHandler {
  const bufferer = (function* (): Generator<void, void, Key | null> {
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
    for (;;) {
      const key = yield;
      if (key == null) continue;
      if (key.sequence !== '\\') {
        keypressHandler(key);
        continue;
      }
      const timeoutId = setTimeout(
        () => bufferer.next(null),
        BACKSLASH_ENTER_TIMEOUT,
      );
      const nextKey = yield;
      clearTimeout(timeoutId);
      if (nextKey === null) {
        keypressHandler(key);
      } else if (nextKey.name === 'return') {
        keypressHandler({ ...nextKey, shift: true, sequence: '\r' });
      } else {
        keypressHandler(key);
        keypressHandler(nextKey);
      }
    }
  })();
  bufferer.next();
  return (key: Key) => void bufferer.next(key);
}

function bufferPaste(keypressHandler: KeypressHandler): KeypressHandler {
  const bufferer = (function* (): Generator<void, void, Key | null> {
    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
    for (;;) {
      let key = yield;
      if (key === null) continue;
      if (key.name !== 'paste-start') {
        keypressHandler(key);
        continue;
      }
      let buffer = '';
      for (;;) {
        const timeoutId = setTimeout(() => bufferer.next(null), PASTE_TIMEOUT);
        key = yield;
        clearTimeout(timeoutId);
        if (key === null || key.name === 'paste-end') break;
        buffer += key.sequence;
      }
      if (buffer.length > 0) {
        keypressHandler({
          name: 'paste',
          shift: false,
          meta: false,
          ctrl: false,
          sequence: buffer,
          insertable: true,
        });
      }
    }
  })();
  bufferer.next();
  return (key: Key) => void bufferer.next(key);
}

function createDataListener(keypressHandler: KeypressHandler) {
  const parser = emitKeys(keypressHandler);
  parser.next();
  let timeoutId: NodeJS.Timeout;
  return (data: string) => {
    clearTimeout(timeoutId);
    for (const char of data) parser.next(char);
    if (data.length !== 0)
      timeoutId = setTimeout(() => parser.next(''), ESC_TIMEOUT);
  };
}

function applyKeyCodeModifier(
  code: string,
  modifier: number,
): { name: string; shift: boolean; meta: boolean; ctrl: boolean } {
  let shift = (modifier & 1) !== 0;
  const meta = (modifier & 2) !== 0;
  let ctrl = (modifier & 4) !== 0;
  const keyInfo = KEY_INFO_MAP[code];
  if (keyInfo) {
    const name = keyInfo.name;
    if (keyInfo.shift === true) shift = true;
    if (keyInfo.ctrl === true) ctrl = true;
    return { name, shift, meta, ctrl };
  }
  if ((ctrl || meta) && (code.endsWith('u') || code.endsWith('~'))) {
    const codeNumber = parseInt(code.slice(1, -1), 10);
    if (codeNumber >= 'a'.charCodeAt(0) && codeNumber <= 'z'.charCodeAt(0)) {
      return { name: String.fromCharCode(codeNumber), shift, meta, ctrl };
    }
    if (codeNumber === '\\'.charCodeAt(0))
      return { name: '\\', shift, meta, ctrl };
  }
  return { name: 'undefined', shift, meta, ctrl };
}

function parseNonEscapeKey(
  ch: string,
  escaped: boolean,
  sequence: string,
  keypressHandler: KeypressHandler,
): boolean {
  let name: string | undefined;
  let shift = false;
  let meta = escaped;
  let ctrl = false;
  let insertable = false;

  if (ch === '\r' || (escaped && ch === '\n')) {
    name = 'return';
    meta = escaped;
  } else if (ch === '\t') {
    name = 'tab';
    meta = escaped;
  } else if (ch === '\b' || ch === '\x7f') {
    name = 'backspace';
    meta = escaped;
  } else if (ch === ESC) {
    name = 'escape';
    meta = escaped;
  } else if (ch === ' ') {
    name = 'space';
    meta = escaped;
    insertable = true;
  } else if (!escaped && ch.charCodeAt(0) <= 0x1a) {
    name = String.fromCharCode(ch.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    ctrl = true;
  } else if (/^[0-9A-Za-z]$/.test(ch)) {
    name = ch.toLowerCase();
    shift = /^[A-Z]$/.test(ch);
    meta = escaped;
    insertable = true;
  } else if (MAC_ALT_KEY_CHARACTER_MAP[ch]) {
    name = MAC_ALT_KEY_CHARACTER_MAP[ch];
    meta = true;
  } else if (sequence === `${ESC}${ESC}`) {
    keypressHandler({
      name: 'escape',
      shift,
      meta: true,
      ctrl,
      sequence: ESC,
      insertable: false,
    });
    return true;
  } else if (escaped) {
    name = ch.length > 0 ? undefined : 'escape';
    meta = true;
  } else {
    insertable = true;
  }

  if (
    (sequence.length !== 0 && (name !== undefined || escaped)) ||
    charLengthAt(sequence, 0) === sequence.length
  ) {
    keypressHandler({
      name: name ?? '',
      shift,
      meta,
      ctrl,
      sequence,
      insertable,
    });
  }
  return false;
}

function parseNumberedCode(
  cmd: string,
): { code: string; modifier: number } | null {
  const match =
    // eslint-disable-next-line sonarjs/regular-expr, sonarjs/unused-named-groups -- Regex parses terminal escape sequences
    /^(?<first>\d+)(?:;(?<second>\d+))?(?:;(?<third>\d+))?(?<suffix>[~^$u])$/.exec(
      cmd,
    );
  if (!match?.groups) return null;
  const { first, second, third, suffix } = match.groups as {
    first: string;
    second?: string;
    third?: string;
    suffix: string;
  };
  if (first === '27' && third !== undefined && suffix === '~') {
    return { code: third + 'u', modifier: parseInt(second ?? '1', 10) - 1 };
  }
  return { code: first + suffix, modifier: parseInt(second ?? '1', 10) - 1 };
}

function parseLetterCode(
  cmd: string,
): { code: string; modifier: number } | null {
  // eslint-disable-next-line sonarjs/regular-expr, sonarjs/unused-named-groups -- Regex parses terminal escape sequences
  const match = /^(?<first>\d+)?(?:;(?<second>\d+))?(?<letter>[A-Za-z])$/.exec(
    cmd,
  );
  if (!match?.groups) return null;
  const { first, second, letter } = match.groups as {
    first?: string;
    second?: string;
    letter: string;
  };
  return { code: letter, modifier: parseInt(second ?? first ?? '1', 10) - 1 };
}

function* readOscBuffer(): Generator<void, string, string> {
  let buffer = '';
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
  for (;;) {
    const next = yield;
    if (next === '' || next === '\u0007') break;
    if (next === ESC) {
      const afterEsc = yield;
      if (afterEsc === '' || afterEsc === '\\') break;
      buffer += next + afterEsc;
      continue;
    }
    buffer += next;
  }
  return buffer;
}

function processOscBuffer(
  buffer: string,
  keypressHandler: KeypressHandler,
): void {
  const match = /^52;[cp];(.*)$/.exec(buffer);
  if (!match) return;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    keypressHandler({
      name: 'paste',
      shift: false,
      meta: false,
      ctrl: false,
      sequence: decoded,
      insertable: false,
    });
  } catch {
    debugLogger.log('Failed to decode OSC 52 clipboard data');
  }
}

function* readOCodeSequence(): Generator<
  void,
  { code: string; modifier: number; sequence: string },
  string
> {
  let ch = yield;
  let modifier = 0;
  let sequence = '';
  if (ch >= '0' && ch <= '9') {
    modifier = parseInt(ch, 10) - 1;
    ch = yield;
    sequence = String(ch);
  } else {
    sequence = String(ch);
  }
  return { code: 'O' + ch, modifier, sequence };
}

function* readBracketSequence(): Generator<
  void,
  { code: string; modifier: number; sequence: string },
  string
> {
  let ch = yield;
  let code = '[';
  let sequence = '[';
  if (ch === '[') {
    code += ch;
    sequence += ch;
    ch = yield;
  }
  const cmdStart = sequence.length;
  while (ch >= '0' && ch <= '9') {
    sequence += ch;
    ch = yield;
  }
  if (ch === ';') {
    while (ch === ';') {
      sequence += ch;
      ch = yield;
      while (ch >= '0' && ch <= '9') {
        sequence += ch;
        ch = yield;
      }
    }
  } else if (ch === '<') {
    sequence += ch;
    ch = yield;
    while (ch === '' || ch === ';' || (ch >= '0' && ch <= '9')) {
      sequence += ch;
      ch = yield;
    }
  } else if (ch === 'M') {
    sequence += ch;
    for (let i = 0; i < 3; i++) {
      ch = yield;
      sequence += ch;
    }
  }
  const cmd = sequence.slice(cmdStart);
  const numbered = parseNumberedCode(cmd);
  const letter = numbered ? null : parseLetterCode(cmd);
  if (numbered) {
    code += numbered.code;
    return { code, modifier: numbered.modifier, sequence };
  }
  if (letter) {
    code += letter.code;
    return { code, modifier: letter.modifier, sequence };
  }
  return { code: code + cmd, modifier: 0, sequence };
}

function* emitKeys(
  keypressHandler: KeypressHandler,
): Generator<void, void, string> {
  // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure preserved
  for (;;) {
    let ch = yield;
    let sequence = ch;
    let escaped = false;

    if (ch === ESC) {
      escaped = true;
      ch = yield;
      sequence += ch;
      if (ch === ESC) {
        ch = yield;
        sequence += ch;
      }
    }

    if (escaped && (ch === 'O' || ch === '[' || ch === ']')) {
      if (ch === ']') {
        const result = yield* readOscBuffer();
        processOscBuffer(result, keypressHandler);
        continue;
      }

      const parsed =
        ch === 'O' ? yield* readOCodeSequence() : yield* readBracketSequence();
      const { name, shift, meta, ctrl } = applyKeyCodeModifier(
        parsed.code,
        parsed.modifier,
      );
      let seq = parsed.sequence;
      let insertable = false;
      if (name === 'space' && !ctrl && !meta) {
        seq = ' ';
        insertable = true;
      }
      keypressHandler({
        name,
        shift,
        meta,
        ctrl,
        sequence: seq,
        insertable,
      });
      continue;
    }

    parseNonEscapeKey(ch, escaped, sequence, keypressHandler);
  }
}

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
  insertable?: boolean;
}

export type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | undefined>(
  undefined,
);

export function useKeypressContext() {
  const context = useContext(KeypressContext);
  if (!context)
    throw new Error(
      'useKeypressContext must be used within a KeypressProvider',
    );
  return context;
}

function createDragDropHandler(broadcast: (key: Key) => void) {
  let dragBuffer = '';
  let draggingTimer: NodeJS.Timeout | null = null;

  const clearDraggingTimer = () => {
    if (draggingTimer) {
      clearTimeout(draggingTimer);
      draggingTimer = null;
    }
  };

  const handleKey = (key: Key): boolean => {
    if (
      key.sequence === SINGLE_QUOTE ||
      key.sequence === DOUBLE_QUOTE ||
      draggingTimer !== null
    ) {
      dragBuffer += key.sequence;
      clearDraggingTimer();
      draggingTimer = setTimeout(() => {
        draggingTimer = null;
        const seq = dragBuffer;
        dragBuffer = '';
        if (seq)
          broadcast({
            ...key,
            name: 'paste',
            sequence: seq,
            insertable: false,
          });
      }, DRAG_COMPLETION_TIMEOUT_MS);
      return true;
    }
    return false;
  };

  const cleanup = () => clearDraggingTimer();
  const flush = () => {
    if (dragBuffer) {
      broadcast({
        name: 'paste',
        ctrl: false,
        meta: false,
        shift: false,
        sequence: dragBuffer,
        insertable: false,
      });
      dragBuffer = '';
    }
  };

  return { handleKey, cleanup, flush };
}

function useKeypressSetup(
  stdin: NodeJS.ReadStream & { isRaw?: boolean },
  setRawMode: (mode: boolean) => void,
  broadcast: (key: Key) => void,
) {
  useEffect(() => {
    const wasRaw = stdin.isRaw;
    if (wasRaw === false) setRawMode(true);

    const dragHandler = createDragDropHandler(broadcast);
    const handleDragDropAndBroadcast = (key: Key) => {
      if (!dragHandler.handleKey(key)) broadcast(key);
    };

    process.stdin.setEncoding('utf8');
    let processor = nonKeyboardEventFilter(handleDragDropAndBroadcast);
    processor = bufferFastReturn(processor);
    processor = bufferBackslashEnter(processor);
    processor = bufferPaste(processor);
    const dataListener = createDataListener(processor);

    stdin.on('data', dataListener);
    return () => {
      stdin.removeListener('data', dataListener);
      if (wasRaw === false) setRawMode(false);
      dragHandler.cleanup();
      dragHandler.flush();
    };
  }, [stdin, setRawMode, broadcast]);
}

export function KeypressProvider({
  children,
  config: _config,
}: {
  children: React.ReactNode;
  config?: Config;
}) {
  const { stdin, setRawMode } = useStdin();
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;
  const subscribe = useCallback(
    (handler: KeypressHandler) => subscribers.add(handler),
    [subscribers],
  );
  const unsubscribe = useCallback(
    (handler: KeypressHandler) => subscribers.delete(handler),
    [subscribers],
  );
  const broadcast = useCallback(
    (key: Key) => subscribers.forEach((h) => h(key)),
    [subscribers],
  );

  useKeypressSetup(stdin, setRawMode, broadcast);

  const contextValue = useMemo(
    () => ({ subscribe, unsubscribe }),
    [subscribe, unsubscribe],
  );

  return (
    <KeypressContext.Provider value={contextValue}>
      {children}
    </KeypressContext.Provider>
  );
}
