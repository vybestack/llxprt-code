/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { type Direction, type TextBufferAction } from './buffer-types.js';

/**
 * Returns the value typed as the wide `TextBufferAction` union so that
 * subsequent `action.type` checks perform genuine runtime narrowing rather
 * than relying on the literal type inferred at the assignment site.
 */
const asAction = (action: TextBufferAction): TextBufferAction => action;

/**
 * Assertion helper that narrows a `TextBufferAction` to a specific variant by
 * its discriminant. Throws (failing the test) if the runtime type differs,
 * and narrows `action` for the type checker on success.
 */
function assertActionType<T extends TextBufferAction['type']>(
  action: TextBufferAction,
  type: T,
): asserts action is Extract<TextBufferAction, { type: T }> {
  if (action.type !== type) {
    throw new Error(`Expected action type "${type}", got "${action.type}"`);
  }
}

/**
 * Phase 2.1: Buffer Types Tests
 *
 * These tests verify types and constants that will be moved to buffer-types.ts.
 * Part of Issue #1577 refactoring.
 */
describe('buffer-types', () => {
  describe('Direction type', () => {
    it('should accept valid direction values', () => {
      const directions: Direction[] = [
        'left',
        'right',
        'up',
        'down',
        'wordLeft',
        'wordRight',
        'home',
        'end',
      ];
      expect(directions).toHaveLength(8);
    });
  });

  describe('TextBufferAction discriminated union', () => {
    it('should narrow insert action correctly', () => {
      const action = asAction({ type: 'insert', payload: 'hello' });
      expect(action.type).toBe('insert');
      // Intentional test: TypeScript should narrow the discriminated union
      assertActionType(action, 'insert');
      expect(action.payload).toBe('hello');
    });

    it('should narrow move action correctly', () => {
      const action = asAction({
        type: 'move',
        payload: { dir: 'right' },
      });
      expect(action.type).toBe('move');
      // Intentional test: TypeScript should narrow the discriminated union
      assertActionType(action, 'move');
      expect(action.payload.dir).toBe('right');
    });

    it('should narrow set_text action correctly', () => {
      const action = asAction({
        type: 'set_text',
        payload: 'hello world',
      });
      expect(action.type).toBe('set_text');
      // Intentional test: TypeScript should narrow the discriminated union
      assertActionType(action, 'set_text');
      expect(action.payload).toBe('hello world');
    });

    it('should handle backspace action', () => {
      const action: TextBufferAction = { type: 'backspace' };
      expect(action.type).toBe('backspace');
    });

    it('should handle delete action', () => {
      const action: TextBufferAction = { type: 'delete' };
      expect(action.type).toBe('delete');
    });

    it('should handle undo action', () => {
      const action: TextBufferAction = { type: 'undo' };
      expect(action.type).toBe('undo');
    });

    it('should handle redo action', () => {
      const action: TextBufferAction = { type: 'redo' };
      expect(action.type).toBe('redo');
    });
  });
});
