/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const ESC = '\u001B';
export const SGR_EVENT_PREFIX = `${ESC}[<`;
export const X11_EVENT_PREFIX = `${ESC}[M`;

// eslint-disable-next-line no-control-regex
export const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/; // SGR mouse events
// X11 is ESC [ M followed by 3 bytes.
// eslint-disable-next-line no-control-regex
export const X11_MOUSE_REGEX = /^\x1b\[M([\s\S]{3})/;

export function couldBeMouseSequence(buffer: string): boolean {
  if (buffer.length === 0) return true;

  if (
    SGR_EVENT_PREFIX.startsWith(buffer) ||
    buffer.startsWith(SGR_EVENT_PREFIX)
  ) {
    return true;
  }

  if (
    X11_EVENT_PREFIX.startsWith(buffer) ||
    buffer.startsWith(X11_EVENT_PREFIX)
  ) {
    return true;
  }

  return false;
}
