/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SGR_EVENT_PREFIX,
  SGR_MOUSE_REGEX,
  X11_EVENT_PREFIX,
  X11_MOUSE_REGEX,
  couldBeMouseSequence,
} from './input.js';

export type MouseEventName =
  | 'left-press'
  | 'left-release'
  | 'right-press'
  | 'right-release'
  | 'middle-press'
  | 'middle-release'
  | 'scroll-up'
  | 'scroll-down'
  | 'scroll-left'
  | 'scroll-right'
  | 'move';

export interface MouseEvent {
  name: MouseEventName;
  col: number;
  row: number;
  shift: boolean;
  meta: boolean;
  ctrl: boolean;
  button: 'left' | 'middle' | 'right' | 'none';
}

export type MouseHandler = (event: MouseEvent) => void | boolean;

const ENABLE_MOUSE_EVENTS = [
  '\x1b[?1000h', // X11 mouse tracking
  '\x1b[?1002h', // Button-event tracking (drag)
  '\x1b[?1006h', // SGR extended coordinates
].join('');

const DISABLE_MOUSE_EVENTS = ['\x1b[?1000l', '\x1b[?1002l', '\x1b[?1006l'].join(
  '',
);

const MAX_SGR_SEQUENCE_LENGTH = 50;

export function enableMouseEvents(stdout: NodeJS.WriteStream = process.stdout) {
  stdout.write(ENABLE_MOUSE_EVENTS);
}

export function disableMouseEvents(
  stdout: NodeJS.WriteStream = process.stdout,
) {
  stdout.write(DISABLE_MOUSE_EVENTS);
}

export function getMouseEventName(
  buttonCode: number,
  isRelease: boolean,
): MouseEventName | null {
  const isMove = (buttonCode & 32) !== 0;

  if (buttonCode === 66) {
    return 'scroll-left';
  }
  if (buttonCode === 67) {
    return 'scroll-right';
  }

  if ((buttonCode & 64) === 64) {
    return (buttonCode & 1) === 0 ? 'scroll-up' : 'scroll-down';
  }

  if (isMove) {
    return 'move';
  }

  const button = buttonCode & 3;
  const type = isRelease ? 'release' : 'press';
  switch (button) {
    case 0:
      return `left-${type}`;
    case 1:
      return `middle-${type}`;
    case 2:
      return `right-${type}`;
    default:
      return null;
  }
}

function getButtonFromCode(code: number): MouseEvent['button'] {
  const button = code & 3;
  switch (button) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return 'none';
  }
}

export function parseSGRMouseEvent(
  buffer: string,
): { event: MouseEvent; length: number } | null {
  const match = buffer.match(SGR_MOUSE_REGEX);

  if (!match) {
    return null;
  }

  const buttonCode = Number.parseInt(match[1], 10);
  const col = Number.parseInt(match[2], 10);
  const row = Number.parseInt(match[3], 10);
  const action = match[4];
  const isRelease = action === 'm';

  const shift = (buttonCode & 4) !== 0;
  const meta = (buttonCode & 8) !== 0;
  const ctrl = (buttonCode & 16) !== 0;

  const name = getMouseEventName(buttonCode, isRelease);

  if (!name) {
    return null;
  }

  return {
    event: {
      name,
      ctrl,
      meta,
      shift,
      col,
      row,
      button: getButtonFromCode(buttonCode),
    },
    length: match[0].length,
  };
}

export function parseX11MouseEvent(
  buffer: string,
): { event: MouseEvent; length: number } | null {
  const match = buffer.match(X11_MOUSE_REGEX);
  if (!match) return null;

  const buttonCode = match[1].charCodeAt(0) - 32;
  const col = match[1].charCodeAt(1) - 32;
  const row = match[1].charCodeAt(2) - 32;

  const shift = (buttonCode & 4) !== 0;
  const meta = (buttonCode & 8) !== 0;
  const ctrl = (buttonCode & 16) !== 0;
  const isMove = (buttonCode & 32) !== 0;
  const isWheel = (buttonCode & 64) !== 0;

  let name: MouseEventName | null = null;

  if (isWheel) {
    const button = buttonCode & 3;
    if (button === 0) {
      name = 'scroll-up';
    } else if (button === 1) {
      name = 'scroll-down';
    }
  } else if (isMove) {
    name = 'move';
  } else {
    const button = buttonCode & 3;
    if (button === 3) {
      name = 'left-release';
    } else if (button === 0) {
      name = 'left-press';
    } else if (button === 1) {
      name = 'middle-press';
    } else if (button === 2) {
      name = 'right-press';
    }
  }

  if (!name) {
    return null;
  }

  let button = getButtonFromCode(buttonCode);
  if (name === 'left-release' && button === 'none') {
    button = 'left';
  }

  return {
    event: {
      name,
      ctrl,
      meta,
      shift,
      col,
      row,
      button,
    },
    length: match[0].length,
  };
}

export function parseMouseEvent(
  buffer: string,
): { event: MouseEvent; length: number } | null {
  return parseSGRMouseEvent(buffer) || parseX11MouseEvent(buffer);
}

export function isIncompleteMouseSequence(buffer: string): boolean {
  if (!couldBeMouseSequence(buffer)) return false;

  if (parseMouseEvent(buffer)) return false;

  if (buffer.startsWith(X11_EVENT_PREFIX)) {
    return buffer.length < X11_EVENT_PREFIX.length + 3;
  }

  if (buffer.startsWith(SGR_EVENT_PREFIX)) {
    return !/[mM]/.test(buffer) && buffer.length < MAX_SGR_SEQUENCE_LENGTH;
  }

  return true;
}
