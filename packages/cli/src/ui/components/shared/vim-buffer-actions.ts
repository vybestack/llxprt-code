/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextBufferState, TextBufferAction } from './buffer-types.js';
import {
  handleDeleteWordForward,
  handleDeleteWordBackward,
  handleDeleteWordEnd,
  handleDeleteLine,
  handleChangeLine,
  handleDeleteToEndOfLine,
  handleChangeMovement,
  handleMoveLeft,
  handleMoveRight,
  handleMoveUp,
  handleMoveDown,
  handleMoveWordForward,
  handleMoveWordBackward,
  handleMoveWordEnd,
  handleDeleteChar,
  handleInsertAtCursor,
  handleAppendAtCursor,
  handleOpenLineBelow,
  handleOpenLineAbove,
  handleAppendAtLineEnd,
  handleInsertAtLineStart,
  handleMoveToLineStart,
  handleMoveToLineEnd,
  handleMoveToFirstNonWhitespace,
  handleMoveToFirstLine,
  handleMoveToLastLine,
  handleMoveToLine,
  handleEscapeInsertMode,
} from './vim-action-handlers.js';

export type VimAction = Extract<
  TextBufferAction,
  | { type: 'vim_delete_word_forward' }
  | { type: 'vim_delete_word_backward' }
  | { type: 'vim_delete_word_end' }
  | { type: 'vim_change_word_forward' }
  | { type: 'vim_change_word_backward' }
  | { type: 'vim_change_word_end' }
  | { type: 'vim_delete_line' }
  | { type: 'vim_change_line' }
  | { type: 'vim_delete_to_end_of_line' }
  | { type: 'vim_change_to_end_of_line' }
  | { type: 'vim_change_movement' }
  | { type: 'vim_move_left' }
  | { type: 'vim_move_right' }
  | { type: 'vim_move_up' }
  | { type: 'vim_move_down' }
  | { type: 'vim_move_word_forward' }
  | { type: 'vim_move_word_backward' }
  | { type: 'vim_move_word_end' }
  | { type: 'vim_delete_char' }
  | { type: 'vim_insert_at_cursor' }
  | { type: 'vim_append_at_cursor' }
  | { type: 'vim_open_line_below' }
  | { type: 'vim_open_line_above' }
  | { type: 'vim_append_at_line_end' }
  | { type: 'vim_insert_at_line_start' }
  | { type: 'vim_move_to_line_start' }
  | { type: 'vim_move_to_line_end' }
  | { type: 'vim_move_to_first_nonwhitespace' }
  | { type: 'vim_move_to_first_line' }
  | { type: 'vim_move_to_last_line' }
  | { type: 'vim_move_to_line' }
  | { type: 'vim_escape_insert_mode' }
>;

type CountPayload = { payload: { count: number } };
type MovementPayload = { payload: { movement: string; count: number } };
type LineNumberPayload = { payload: { lineNumber: number } };

type Handler = (s: TextBufferState, a: VimAction) => TextBufferState;

function byCount(
  fn: (s: TextBufferState, n: number) => TextBufferState,
): Handler {
  return (s, a) => fn(s, (a as VimAction & CountPayload).payload.count);
}

function byMovement(
  fn: (s: TextBufferState, m: string, n: number) => TextBufferState,
): Handler {
  return (s, a) => {
    const p = (a as VimAction & MovementPayload).payload;
    return fn(s, p.movement, p.count);
  };
}

function byLineNumber(
  fn: (s: TextBufferState, n: number) => TextBufferState,
): Handler {
  return (s, a) =>
    fn(s, (a as VimAction & LineNumberPayload).payload.lineNumber);
}

function noPayload(fn: (s: TextBufferState) => TextBufferState): Handler {
  return (s) => fn(s);
}

const ACTION_HANDLER_MAP: Partial<Record<VimAction['type'], Handler>> = {
  vim_delete_word_forward: byCount(handleDeleteWordForward),
  vim_change_word_forward: byCount(handleDeleteWordForward),
  vim_delete_word_backward: byCount(handleDeleteWordBackward),
  vim_change_word_backward: byCount(handleDeleteWordBackward),
  vim_delete_word_end: byCount(handleDeleteWordEnd),
  vim_change_word_end: byCount(handleDeleteWordEnd),
  vim_delete_line: byCount(handleDeleteLine),
  vim_change_line: byCount(handleChangeLine),
  vim_delete_to_end_of_line: noPayload(handleDeleteToEndOfLine),
  vim_change_to_end_of_line: noPayload(handleDeleteToEndOfLine),
  vim_change_movement: byMovement(handleChangeMovement),
  vim_move_left: byCount(handleMoveLeft),
  vim_move_right: byCount(handleMoveRight),
  vim_move_up: byCount(handleMoveUp),
  vim_move_down: byCount(handleMoveDown),
  vim_move_word_forward: byCount(handleMoveWordForward),
  vim_move_word_backward: byCount(handleMoveWordBackward),
  vim_move_word_end: byCount(handleMoveWordEnd),
  vim_delete_char: byCount(handleDeleteChar),
  vim_insert_at_cursor: noPayload(handleInsertAtCursor),
  vim_append_at_cursor: noPayload(handleAppendAtCursor),
  vim_open_line_below: noPayload(handleOpenLineBelow),
  vim_open_line_above: noPayload(handleOpenLineAbove),
  vim_append_at_line_end: noPayload(handleAppendAtLineEnd),
  vim_insert_at_line_start: noPayload(handleInsertAtLineStart),
  vim_move_to_line_start: noPayload(handleMoveToLineStart),
  vim_move_to_line_end: noPayload(handleMoveToLineEnd),
  vim_move_to_first_nonwhitespace: noPayload(handleMoveToFirstNonWhitespace),
  vim_move_to_first_line: noPayload(handleMoveToFirstLine),
  vim_move_to_last_line: noPayload(handleMoveToLastLine),
  vim_move_to_line: byLineNumber(handleMoveToLine),
  vim_escape_insert_mode: noPayload(handleEscapeInsertMode),
};

export function handleVimAction(
  state: TextBufferState,
  action: VimAction,
): TextBufferState {
  const handler = ACTION_HANDLER_MAP[action.type];
  return handler !== undefined ? handler(state, action) : state;
}
