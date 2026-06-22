/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
function positiveCountOrOne(payload: string): number {
  const n = Number(payload);
  return n > 0 ? n : 1;
}

type VimCountActionType = Extract<
  TextBufferAction,
  { payload: { count: number } }
>['type'];

function vimCountAction(
  type: VimCountActionType,
  payload: string,
): TextBufferAction {
  return {
    type,
    payload: { count: positiveCountOrOne(payload) },
  } as TextBufferAction;
}

const VIM_COUNT_ACTIONS = new Set<VimCountActionType>([
  'vim_delete_word_forward',
  'vim_delete_word_backward',
  'vim_move_word_forward',
  'vim_move_word_backward',
  'vim_delete_line',
  'vim_change_word_forward',
  'vim_delete_char',
]);

const NO_ARG_ACTIONS = new Set<TextBufferAction['type']>([
  'backspace',
  'delete',
  'delete_word_left',
  'delete_word_right',
  'kill_line_right',
  'kill_line_left',
  'undo',
  'redo',
  'create_undo_snapshot',
  'vim_insert_at_cursor',
  'vim_append_at_cursor',
  'vim_escape_insert_mode',
  'vim_move_to_first_line',
  'vim_move_to_last_line',
  'vim_move_to_line_start',
  'vim_move_to_line_end',
  'vim_move_to_first_nonwhitespace',
  'vim_open_line_below',
  'vim_open_line_above',
  'vim_append_at_line_end',
  'vim_insert_at_line_start',
  'vim_delete_to_end_of_line',
  'vim_change_to_end_of_line',
]);

const TEXT_PAYLOAD_ACTIONS: Partial<
  Record<string, (payload: string) => TextBufferAction>
> = {
  insert: (p) => ({ type: 'insert', payload: p }),
  set_text: (p) => ({ type: 'set_text', payload: p }),
};

function parseParameterizedAction(
  type: string,
  payload: string,
): TextBufferAction | undefined {
  switch (type) {
    case 'move':
      return { type: 'move', payload: { dir: payload as Direction } };
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
    case 'vim_move_to_line':
      return {
        type: 'vim_move_to_line',
        payload: { lineNumber: Number(payload) },
      };
    case 'vim_change_movement': {
      const parts = payload.split(':');
      return {
        type: 'vim_change_movement',
        payload: {
          movement: parts[0] as 'h' | 'j' | 'k' | 'l',
          count: positiveCountOrOne(parts[1]),
        },
      };
    }
    default:
      return undefined;
  }
}

function parseAction(actionStr: string): TextBufferAction {
  const [type, payload] = actionStr.split(':');

  const actionType = type as VimCountActionType;
  if (VIM_COUNT_ACTIONS.has(actionType)) {
    return vimCountAction(actionType, payload);
  }

  if (NO_ARG_ACTIONS.has(type as TextBufferAction['type'])) {
    return { type } as TextBufferAction;
  }

  const textFactory = TEXT_PAYLOAD_ACTIONS[type];
  if (textFactory) {
    return textFactory(payload || '');
  }

  const parameterized = parseParameterizedAction(type, payload);
  if (parameterized) {
    return parameterized;
  }

  throw new Error(`Unknown action type: ${type}`);
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
