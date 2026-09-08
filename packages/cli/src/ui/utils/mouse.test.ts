/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  disableMouseEvents,
  enableMouseEvents,
  getMouseEventName,
  isMouseEventsActive,
  setMouseEventsActive,
  isIncompleteMouseSequence,
  parseMouseEvent,
  parseSGRMouseEvent,
  parseX11MouseEvent,
} from './mouse.js';
import { ESC } from './input.js';

function x11Sequence(buttonCode: number, col = 1, row = 1): string {
  return `${ESC}[M${String.fromCharCode(buttonCode + 32, col + 32, row + 32)}`;
}

describe('mouse utils', () => {
  describe('enableMouseEvents/disableMouseEvents', () => {
    // The emitted escape sequences are not asserted here: mouse.ts writes them
    // with core's writeToStdout, which deliberately bypasses process.stdout so
    // they survive patchStdio, and is not interceptable without mocking the
    // core module for the whole file. The tracking-state transition is the
    // observable contract that can be checked directly.
    it('toggles mouse tracking state', () => {
      enableMouseEvents();
      expect(isMouseEventsActive()).toBe(true);

      disableMouseEvents();
      expect(isMouseEventsActive()).toBe(false);
    });
  });

  describe('mouse event tracking state', () => {
    it('tracks whether mouse events are active', () => {
      disableMouseEvents();
      expect(isMouseEventsActive()).toBe(false);

      enableMouseEvents();
      expect(isMouseEventsActive()).toBe(true);
    });

    it('can toggle mouse events using setMouseEventsActive', () => {
      setMouseEventsActive(false);
      expect(isMouseEventsActive()).toBe(false);

      setMouseEventsActive(true);
      expect(isMouseEventsActive()).toBe(true);
    });
  });

  describe('parseSGRMouseEvent', () => {
    it('parses a valid SGR mouse press', () => {
      const input = `${ESC}[<0;37;25M`;
      const result = parseSGRMouseEvent(input);
      expect(result).not.toBeNull();
      expect(result?.event).toStrictEqual({
        name: 'left-press',
        col: 37,
        row: 25,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      });
      expect(result?.length).toBe(input.length);
    });

    it('parses a valid SGR mouse release', () => {
      const input = `${ESC}[<0;37;25m`;
      const result = parseSGRMouseEvent(input);
      expect(result).not.toBeNull();
      expect(result?.event).toStrictEqual({
        name: 'left-release',
        col: 37,
        row: 25,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      });
    });

    it('parses SGR with modifiers', () => {
      const input = `${ESC}[<28;10;20M`;
      const result = parseSGRMouseEvent(input);
      expect(result).not.toBeNull();
      expect(result?.event).toStrictEqual({
        name: 'left-press',
        col: 10,
        row: 20,
        shift: true,
        meta: true,
        ctrl: true,
        button: 'left',
      });
    });

    it('parses SGR move event', () => {
      const input = `${ESC}[<32;10;20M`;
      const result = parseSGRMouseEvent(input);
      expect(result).not.toBeNull();
      expect(result?.event.name).toBe('move');
      expect(result?.event.button).toBe('left');
    });

    it('parses SGR scroll events', () => {
      expect(parseSGRMouseEvent(`${ESC}[<64;1;1M`)?.event.name).toBe(
        'scroll-up',
      );
      expect(parseSGRMouseEvent(`${ESC}[<65;1;1M`)?.event.name).toBe(
        'scroll-down',
      );
    });

    it('returns null for invalid SGR', () => {
      expect(parseSGRMouseEvent(`${ESC}[<;1;1M`)).toBeNull();
      expect(parseSGRMouseEvent(`${ESC}[<0;1;M`)).toBeNull();
      expect(parseSGRMouseEvent(`not sgr`)).toBeNull();
    });
  });

  describe('getMouseEventName', () => {
    it('maps horizontal wheel button codes to scroll-left and scroll-right (AC6.5)', () => {
      const names = [66, 67].map((buttonCode) =>
        getMouseEventName(buttonCode, false),
      );

      expect(names).toStrictEqual(['scroll-left', 'scroll-right']);
    });
  });

  describe('parseX11MouseEvent', () => {
    it('parses a valid X11 mouse press', () => {
      const input = `${ESC}[M !!`;
      const result = parseX11MouseEvent(input);
      expect(result).not.toBeNull();
      expect(result?.event).toStrictEqual({
        name: 'left-press',
        col: 1,
        row: 1,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      });
      expect(result?.length).toBe(6);
    });

    it('parses the X11 release code as left-release without a button (AC6.6)', () => {
      const result = parseX11MouseEvent(x11Sequence(3, 12, 7));

      expect(result?.event).toStrictEqual({
        name: 'left-release',
        col: 12,
        row: 7,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'none',
      });
    });

    it('parses X11 motion as move (AC6.7)', () => {
      const result = parseX11MouseEvent(x11Sequence(32, 4, 9));

      expect(result?.event).toStrictEqual({
        name: 'move',
        col: 4,
        row: 9,
        shift: false,
        meta: false,
        ctrl: false,
        button: 'left',
      });
    });

    it('parses X11 vertical wheel codes as scroll-up and scroll-down (AC6.7)', () => {
      const names = [64, 65].map(
        (buttonCode) => parseX11MouseEvent(x11Sequence(buttonCode))?.event.name,
      );

      expect(names).toStrictEqual(['scroll-up', 'scroll-down']);
    });

    it('decodes X11 shift, meta, and ctrl modifier bits (AC6.8)', () => {
      const result = parseX11MouseEvent(x11Sequence(4 | 8 | 16, 3, 5));

      expect(result?.event).toStrictEqual({
        name: 'left-press',
        col: 3,
        row: 5,
        shift: true,
        meta: true,
        ctrl: true,
        button: 'left',
      });
    });

    it('returns null for incomplete X11', () => {
      expect(parseX11MouseEvent(`${ESC}[M !`)).toBeNull();
    });
  });

  describe('isIncompleteMouseSequence', () => {
    it('returns true for prefixes', () => {
      expect(isIncompleteMouseSequence(ESC)).toBe(true);
      expect(isIncompleteMouseSequence(`${ESC}[`)).toBe(true);
      expect(isIncompleteMouseSequence(`${ESC}[<`)).toBe(true);
      expect(isIncompleteMouseSequence(`${ESC}[M`)).toBe(true);
    });

    it('returns true for partial SGR', () => {
      expect(isIncompleteMouseSequence(`${ESC}[<0;10;20`)).toBe(true);
    });

    it('returns true for partial X11', () => {
      expect(isIncompleteMouseSequence(`${ESC}[M `)).toBe(true);
      expect(isIncompleteMouseSequence(`${ESC}[M !`)).toBe(true);
    });

    it('returns false for complete SGR', () => {
      expect(isIncompleteMouseSequence(`${ESC}[<0;10;20M`)).toBe(false);
    });

    it('returns false for complete X11', () => {
      expect(isIncompleteMouseSequence(`${ESC}[M !!!`)).toBe(false);
    });

    it('returns false for non-mouse sequences', () => {
      expect(isIncompleteMouseSequence('a')).toBe(false);
      expect(isIncompleteMouseSequence(`${ESC}[A`)).toBe(false);
    });

    it('returns false for garbage that started like a mouse sequence but got too long (SGR)', () => {
      const longGarbage = `${ESC}[<${'0'.repeat(100)}`;
      expect(isIncompleteMouseSequence(longGarbage)).toBe(false);
    });
  });

  describe('parseMouseEvent', () => {
    it('parses SGR', () => {
      expect(parseMouseEvent(`${ESC}[<0;1;1M`)).not.toBeNull();
    });

    it('parses X11', () => {
      expect(parseMouseEvent(`${ESC}[M !!!`)).not.toBeNull();
    });
  });
});
