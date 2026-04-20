/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { type Direction, type TextBufferAction } from './buffer-types.js';

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
      const action: TextBufferAction = { type: 'insert', payload: 'hello' };
      expect(action.type).toBe('insert');
      if (action.type !== 'insert')
        throw new Error('unreachable: narrowing failed');
      expect(action.payload).toBe('hello');
    });

    it('should narrow move action correctly', () => {
      const action: TextBufferAction = {
        type: 'move',
        payload: { dir: 'right' },
      };
      expect(action.type).toBe('move');
      if (action.type !== 'move')
        throw new Error('unreachable: narrowing failed');
      expect(action.payload.dir).toBe('right');
    });

    it('should narrow set_text action correctly', () => {
      const action: TextBufferAction = {
        type: 'set_text',
        payload: 'hello world',
      };
      expect(action.type).toBe('set_text');
      if (action.type !== 'set_text')
        throw new Error('unreachable: narrowing failed');
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
