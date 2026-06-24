/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const ESC = '\u001B';
export const SGR_EVENT_PREFIX = `${ESC}[<`;
export const X11_EVENT_PREFIX = `${ESC}[M`;

interface SGRMouseSequence {
  buttonCode: number;
  col: number;
  row: number;
  action: 'm' | 'M';
  length: number;
}

interface X11MouseSequence {
  bytes: string;
  length: number;
}

function readDigits(
  buffer: string,
  start: number,
): { value: number; next: number } | null {
  let next = start;
  while (next < buffer.length) {
    const code = buffer.charCodeAt(next);
    if (code < 48 || code > 57) break;
    next += 1;
  }
  if (next === start) return null;
  return { value: Number(buffer.slice(start, next)), next };
}

export function readSGRMouseSequence(buffer: string): SGRMouseSequence | null {
  if (!buffer.startsWith(SGR_EVENT_PREFIX)) return null;

  let index = SGR_EVENT_PREFIX.length;
  const button = readDigits(buffer, index);
  if (!button || buffer[button.next] !== ';') return null;
  index = button.next + 1;

  const col = readDigits(buffer, index);
  if (!col || buffer[col.next] !== ';') return null;
  index = col.next + 1;

  const row = readDigits(buffer, index);
  if (!row) return null;
  const action = buffer[row.next];
  if (action !== 'm' && action !== 'M') return null;

  return {
    buttonCode: button.value,
    col: col.value,
    row: row.value,
    action,
    length: row.next + 1,
  };
}

export function readX11MouseSequence(buffer: string): X11MouseSequence | null {
  if (!buffer.startsWith(X11_EVENT_PREFIX)) return null;
  const dataStart = X11_EVENT_PREFIX.length;
  const dataEnd = dataStart + 3;
  if (buffer.length < dataEnd) return null;
  return { bytes: buffer.slice(dataStart, dataEnd), length: dataEnd };
}

export function couldBeSGRMouseSequence(buffer: string): boolean {
  if (buffer.length === 0) return true;
  // Check if buffer is a prefix of a mouse sequence starter
  if (SGR_EVENT_PREFIX.startsWith(buffer)) return true;
  // Check if buffer is a mouse sequence prefix
  if (buffer.startsWith(SGR_EVENT_PREFIX)) return true;

  return false;
}

export function couldBeMouseSequence(buffer: string): boolean {
  if (buffer.length === 0) return true;

  // Check SGR prefix
  if (
    SGR_EVENT_PREFIX.startsWith(buffer) ||
    buffer.startsWith(SGR_EVENT_PREFIX)
  )
    return true;
  // Check X11 prefix
  if (
    X11_EVENT_PREFIX.startsWith(buffer) ||
    buffer.startsWith(X11_EVENT_PREFIX)
  )
    return true;

  return false;
}

/**
 * Checks if the buffer *starts* with a complete mouse sequence.
 * Returns the length of the sequence if matched, or 0 if not.
 */
export function getMouseSequenceLength(buffer: string): number {
  const sgr = readSGRMouseSequence(buffer);
  if (sgr) return sgr.length;

  const x11 = readX11MouseSequence(buffer);
  if (x11) return x11.length;

  return 0;
}
