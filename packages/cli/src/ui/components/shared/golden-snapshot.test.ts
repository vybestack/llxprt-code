/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: behavioral coverage boundary retained while larger decomposition continues. */

import { describe, it, expect } from 'vitest';
import { textBufferReducer } from './buffer-reducer.js';
import type {
  TextBufferState,
  TextBufferAction,
  Direction,
} from './buffer-types.js';

// Import action corpus
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const actionCorpus = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../../../../project-plans/issue1577/action-corpus.json',
    ),
    'utf8',
  ),
);

/**
 * Phase 1.4: Golden Snapshot Tests
 *
 * These tests verify that the text buffer produces consistent state snapshots
 * after applying sequences of actions from the action corpus.
 *
 * Part of Issue #1577 refactoring.
 */

const initialState: TextBufferState = {
  lines: [''],
  cursorRow: 0,
  cursorCol: 0,
  preferredCol: null,
  undoStack: [],
  redoStack: [],
  clipboard: null,
  selectionAnchor: null,
  viewportWidth: 80,
  viewportHeight: 24,
  visualLayout: {
    visualLines: [''],
    logicalToVisualMap: [[[0, 0]]],
    visualToLogicalMap: [[0, 0]],
    transformedToLogicalMaps: [[]],
    visualToTransformedMap: [0],
  },
  transformationsByLine: [[]],
};

// Parse action string into action object
function parseAction(actionStr: string): TextBufferAction {
  const [type, payload] = actionStr.split(':');

  switch (type) {
    case 'insert':
      return { type: 'insert', payload: payload || '' };
    case 'set_text':
      return { type: 'set_text', payload: payload || '' };
    case 'backspace':
      return { type: 'backspace' };
    case 'delete':
      return { type: 'delete' };
    case 'move':
      return { type: 'move', payload: { dir: payload as Direction } };
    case 'delete_word_left':
      return { type: 'delete_word_left' };
    case 'delete_word_right':
      return { type: 'delete_word_right' };
    case 'kill_line_right':
      return { type: 'kill_line_right' };
    case 'kill_line_left':
      return { type: 'kill_line_left' };
    case 'undo':
      return { type: 'undo' };
    case 'redo':
      return { type: 'redo' };
    case 'set_cursor': {
      const [row, col] = payload.split(',').map(Number);
      return {
        type: 'set_cursor',
        payload: { cursorRow: row, cursorCol: col, preferredCol: null },
      };
    }
    case 'set_viewport': {
      const [width, height] = payload.split(',').map(Number);
      return { type: 'set_viewport', payload: { width, height } };
    }
    case 'create_undo_snapshot':
      return { type: 'create_undo_snapshot' };
    case 'move_to_offset':
      return { type: 'move_to_offset', payload: { offset: Number(payload) } };
    case 'replace_range': {
      const parts = payload.split(',');
      return {
        type: 'replace_range',
        payload: {
          startRow: Number(parts[0]),
          startCol: Number(parts[1]),
          endRow: Number(parts[2]),
          endCol: Number(parts[3]),
          text: parts[4] || '',
        },
      };
    }
    case 'vim_delete_word_forward':
      return {
        type: 'vim_delete_word_forward',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_delete_word_backward':
      return {
        type: 'vim_delete_word_backward',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_move_word_forward':
      return {
        type: 'vim_move_word_forward',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_move_word_backward':
      return {
        type: 'vim_move_word_backward',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_delete_line':
      return {
        type: 'vim_delete_line',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_change_word_forward':
      return {
        type: 'vim_change_word_forward',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_insert_at_cursor':
      return { type: 'vim_insert_at_cursor' };
    case 'vim_append_at_cursor':
      return { type: 'vim_append_at_cursor' };
    case 'vim_escape_insert_mode':
      return { type: 'vim_escape_insert_mode' };
    case 'vim_move_to_first_line':
      return { type: 'vim_move_to_first_line' };
    case 'vim_move_to_last_line':
      return { type: 'vim_move_to_last_line' };
    case 'vim_move_to_line_start':
      return { type: 'vim_move_to_line_start' };
    case 'vim_move_to_line_end':
      return { type: 'vim_move_to_line_end' };
    case 'vim_move_to_first_nonwhitespace':
      return { type: 'vim_move_to_first_nonwhitespace' };
    case 'vim_open_line_below':
      return { type: 'vim_open_line_below' };
    case 'vim_open_line_above':
      return { type: 'vim_open_line_above' };
    case 'vim_append_at_line_end':
      return { type: 'vim_append_at_line_end' };
    case 'vim_insert_at_line_start':
      return { type: 'vim_insert_at_line_start' };
    case 'vim_move_to_line':
      return {
        type: 'vim_move_to_line',
        payload: { lineNumber: Number(payload) },
      };
    case 'vim_delete_char':
      return {
        type: 'vim_delete_char',
        payload: {
          count: (() => {
            const n = Number(payload);
            return n > 0 ? n : 1;
          })(),
        },
      };
    case 'vim_delete_to_end_of_line':
      return { type: 'vim_delete_to_end_of_line' };
    case 'vim_change_to_end_of_line':
      return { type: 'vim_change_to_end_of_line' };
    case 'vim_change_movement': {
      const parts = payload.split(':');
      return {
        type: 'vim_change_movement',
        payload: {
          movement: parts[0] as 'h' | 'j' | 'k' | 'l',
          count: (() => {
            const n = Number(parts[1]);
            return n > 0 ? n : 1;
          })(),
        },
      };
    }
    default:
      throw new Error(`Unknown action type: ${type}`);
  }
}

// Apply a sequence of actions and return final state
function applySequence(actions: string[]): TextBufferState {
  let state = initialState;
  for (const actionStr of actions) {
    const action = parseAction(actionStr);
    state = textBufferReducer(state, action);
  }
  return state;
}

describe('golden snapshot', () => {
  it('should load action corpus', () => {
    expect(actionCorpus.sequences).toBeDefined();
    expect(actionCorpus.sequences.length).toBeGreaterThan(0);
  });

  it('should apply all action sequences without error', () => {
    for (const sequence of actionCorpus.sequences) {
      expect(() => applySequence(sequence)).not.toThrow();
    }
  });

  it('should produce deterministic results', () => {
    // Run same sequence twice, should get same result
    const sequence = actionCorpus.sequences[0];
    const result1 = applySequence(sequence);
    const result2 = applySequence(sequence);
    expect(result1).toStrictEqual(result2);
  });

  it('should handle insert and newlines correctly', () => {
    const state = applySequence(['insert:hello', 'insert:\n', 'insert:world']);
    expect(state.lines).toStrictEqual(['hello', 'world']);
    expect(state.cursorRow).toBe(1);
    expect(state.cursorCol).toBe(5);
  });

  it('should handle undo/redo correctly', () => {
    const state = applySequence(['insert:hello', 'undo', 'redo']);
    expect(state.lines).toStrictEqual(['hello']);
  });
});
