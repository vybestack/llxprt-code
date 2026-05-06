/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import { useCallback, useReducer, useEffect } from 'react';
import type { Key } from './useKeypress.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

export type VimMode = 'NORMAL' | 'INSERT';

// Constants
const DIGIT_MULTIPLIER = 10;
const DEFAULT_COUNT = 1;
const DIGIT_1_TO_9 = /^[1-9]$/;

// Command types
const CMD_TYPES = {
  DELETE_WORD_FORWARD: 'dw',
  DELETE_WORD_BACKWARD: 'db',
  DELETE_WORD_END: 'de',
  CHANGE_WORD_FORWARD: 'cw',
  CHANGE_WORD_BACKWARD: 'cb',
  CHANGE_WORD_END: 'ce',
  DELETE_CHAR: 'x',
  DELETE_LINE: 'dd',
  CHANGE_LINE: 'cc',
  DELETE_TO_EOL: 'D',
  CHANGE_TO_EOL: 'C',
  CHANGE_MOVEMENT: {
    LEFT: 'ch',
    DOWN: 'cj',
    UP: 'ck',
    RIGHT: 'cl',
  },
} as const;

type ChangeMovementType =
  | typeof CMD_TYPES.CHANGE_MOVEMENT.LEFT
  | typeof CMD_TYPES.CHANGE_MOVEMENT.DOWN
  | typeof CMD_TYPES.CHANGE_MOVEMENT.UP
  | typeof CMD_TYPES.CHANGE_MOVEMENT.RIGHT;

type MovementDirection = 'h' | 'j' | 'k' | 'l';
type WordMotionKey = 'w' | 'b' | 'e';
type InsertModeEntryKey = 'i' | 'a' | 'o' | 'O' | 'I' | 'A';
type LinePositionKey = '0' | '$' | '^';
type OperatorKey = 'd' | 'c' | 'D' | 'C';
type GKey = 'g' | 'G';
type ArrowDirection = 'left' | 'down' | 'up' | 'right';
type PendingOperator = 'g' | 'd' | 'c' | null;

// Helper function to clear pending state
const createClearPendingState = (): {
  count: number;
  pendingOperator: PendingOperator;
} => ({
  count: 0,
  pendingOperator: null,
});

// State and action types for useReducer
type VimState = {
  mode: VimMode;
  count: number;
  pendingOperator: PendingOperator;
  lastCommand: { type: string; count: number } | null;
};

type VimAction =
  | { type: 'SET_MODE'; mode: VimMode }
  | { type: 'SET_COUNT'; count: number }
  | { type: 'INCREMENT_COUNT'; digit: number }
  | { type: 'CLEAR_COUNT' }
  | { type: 'SET_PENDING_OPERATOR'; operator: PendingOperator }
  | {
      type: 'SET_LAST_COMMAND';
      command: { type: string; count: number } | null;
    }
  | { type: 'CLEAR_PENDING_STATES' }
  | { type: 'ESCAPE_TO_NORMAL' };

const initialVimState: VimState = {
  mode: 'NORMAL',
  count: 0,
  pendingOperator: null,
  lastCommand: null,
};

// Reducer function
const vimReducer = (state: VimState, action: VimAction): VimState => {
  switch (action.type) {
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_COUNT':
      return { ...state, count: action.count };
    case 'INCREMENT_COUNT':
      return { ...state, count: state.count * DIGIT_MULTIPLIER + action.digit };
    case 'CLEAR_COUNT':
      return { ...state, count: 0 };
    case 'SET_PENDING_OPERATOR':
      return { ...state, pendingOperator: action.operator };
    case 'SET_LAST_COMMAND':
      return { ...state, lastCommand: action.command };
    case 'CLEAR_PENDING_STATES':
    case 'ESCAPE_TO_NORMAL':
      return { ...state, ...createClearPendingState() };
    default:
      return state;
  }
};

/** Normalizes key input to ensure all required properties are present */
const normalizeKey = (key: Key): Key => ({
  name: key.name || '',
  sequence: key.sequence || '',
  ctrl: key.ctrl || false,
  meta: key.meta || false,
  shift: key.shift || false,
  insertable: key.insertable === true,
});

/** Executes vim commands by type */
const executeCommandType = (
  cmdType: string,
  count: number,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): boolean => {
  switch (cmdType) {
    case CMD_TYPES.DELETE_WORD_FORWARD:
      buffer.vimDeleteWordForward(count);
      return true;
    case CMD_TYPES.DELETE_WORD_BACKWARD:
      buffer.vimDeleteWordBackward(count);
      return true;
    case CMD_TYPES.DELETE_WORD_END:
      buffer.vimDeleteWordEnd(count);
      return true;
    case CMD_TYPES.CHANGE_WORD_FORWARD:
      buffer.vimChangeWordForward(count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_WORD_BACKWARD:
      buffer.vimChangeWordBackward(count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_WORD_END:
      buffer.vimChangeWordEnd(count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.DELETE_CHAR:
      buffer.vimDeleteChar(count);
      return true;
    case CMD_TYPES.DELETE_LINE:
      buffer.vimDeleteLine(count);
      return true;
    case CMD_TYPES.CHANGE_LINE:
      buffer.vimChangeLine(count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.DELETE_TO_EOL:
      buffer.vimDeleteToEndOfLine();
      return true;
    case CMD_TYPES.CHANGE_TO_EOL:
      buffer.vimChangeToEndOfLine();
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_MOVEMENT.LEFT:
      buffer.vimChangeMovement('h', count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_MOVEMENT.DOWN:
      buffer.vimChangeMovement('j', count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_MOVEMENT.UP:
      buffer.vimChangeMovement('k', count);
      updateMode('INSERT');
      return true;
    case CMD_TYPES.CHANGE_MOVEMENT.RIGHT:
      buffer.vimChangeMovement('l', count);
      updateMode('INSERT');
      return true;
    default:
      return false;
  }
};

/** Handles change movement commands (ch, cj, ck, cl) */
const processChangeMovement = (
  movement: MovementDirection,
  count: number,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): ChangeMovementType => {
  buffer.vimChangeMovement(movement, count);
  updateMode('INSERT');
  const cmdTypeMap: Record<MovementDirection, ChangeMovementType> = {
    h: CMD_TYPES.CHANGE_MOVEMENT.LEFT,
    j: CMD_TYPES.CHANGE_MOVEMENT.DOWN,
    k: CMD_TYPES.CHANGE_MOVEMENT.UP,
    l: CMD_TYPES.CHANGE_MOVEMENT.RIGHT,
  };
  return cmdTypeMap[movement];
};

/** Handles operator-motion commands (dw/cw, db/cb, de/ce) */
const processOperatorMotion = (
  operator: 'd' | 'c',
  motion: WordMotionKey,
  count: number,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): string => {
  const commandMap: Record<'d' | 'c', Record<WordMotionKey, string>> = {
    d: {
      w: CMD_TYPES.DELETE_WORD_FORWARD,
      b: CMD_TYPES.DELETE_WORD_BACKWARD,
      e: CMD_TYPES.DELETE_WORD_END,
    },
    c: {
      w: CMD_TYPES.CHANGE_WORD_FORWARD,
      b: CMD_TYPES.CHANGE_WORD_BACKWARD,
      e: CMD_TYPES.CHANGE_WORD_END,
    },
  };
  const cmdType = commandMap[operator][motion];
  executeCommandType(cmdType, count, buffer, updateMode);
  return cmdType;
};

/** Handles movement keys (h, j, k, l) in NORMAL mode */
const processMovementKey = (
  key: MovementDirection,
  repeatCount: number,
  pendingOperator: PendingOperator,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): { handled: boolean; changeCmdType?: ChangeMovementType } => {
  if (pendingOperator === 'c') {
    const cmdType = processChangeMovement(key, repeatCount, buffer, updateMode);
    return { handled: true, changeCmdType: cmdType };
  }
  switch (key) {
    case 'h':
      buffer.vimMoveLeft(repeatCount);
      break;
    case 'j':
      buffer.vimMoveDown(repeatCount);
      break;
    case 'k':
      buffer.vimMoveUp(repeatCount);
      break;
    case 'l':
      buffer.vimMoveRight(repeatCount);
      break;
    default:
      break;
  }
  return { handled: true };
};

/** Handles word motion keys (w, b, e) in NORMAL mode */
const processWordMotionKey = (
  key: WordMotionKey,
  repeatCount: number,
  pendingOperator: PendingOperator,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): { handled: boolean; cmdType?: string } => {
  if (pendingOperator === 'd') {
    const cmdType = processOperatorMotion(
      'd',
      key,
      repeatCount,
      buffer,
      updateMode,
    );
    return { handled: true, cmdType };
  }
  if (pendingOperator === 'c') {
    const cmdType = processOperatorMotion(
      'c',
      key,
      repeatCount,
      buffer,
      updateMode,
    );
    return { handled: true, cmdType };
  }
  switch (key) {
    case 'w':
      buffer.vimMoveWordForward(repeatCount);
      break;
    case 'b':
      buffer.vimMoveWordBackward(repeatCount);
      break;
    case 'e':
      buffer.vimMoveWordEnd(repeatCount);
      break;
    default:
      break;
  }
  return { handled: true };
};

/** Handles insert mode entry keys (i, a, o, O, I, A) */
const processInsertModeEntryKey = (
  key: InsertModeEntryKey,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): void => {
  switch (key) {
    case 'i':
      buffer.vimInsertAtCursor();
      break;
    case 'a':
      buffer.vimAppendAtCursor();
      break;
    case 'o':
      buffer.vimOpenLineBelow();
      break;
    case 'O':
      buffer.vimOpenLineAbove();
      break;
    case 'I':
      buffer.vimInsertAtLineStart();
      break;
    case 'A':
      buffer.vimAppendAtLineEnd();
      break;
    default:
      break;
  }
  updateMode('INSERT');
};

/** Handles line position keys (0, $, ^) */
const processLinePositionKey = (
  key: LinePositionKey,
  buffer: TextBuffer,
): void => {
  switch (key) {
    case '0':
      buffer.vimMoveToLineStart();
      break;
    case '$':
      buffer.vimMoveToLineEnd();
      break;
    case '^':
      buffer.vimMoveToFirstNonWhitespace();
      break;
    default:
      break;
  }
};

/** Handles g/G keys (go to line/first line/last line) */
const processGKey = (
  key: GKey,
  pendingOperator: PendingOperator,
  count: number,
  buffer: TextBuffer,
): { clearOperator: boolean } => {
  if (key === 'g') {
    if (pendingOperator === 'g') {
      buffer.vimMoveToFirstLine();
      return { clearOperator: true };
    }
    return { clearOperator: false };
  }
  // G - go to specific line or last line
  if (count > 0) {
    buffer.vimMoveToLine(count);
  } else {
    buffer.vimMoveToLastLine();
  }
  return { clearOperator: false };
};

/** Handles operator keys (d, c, D, C) */
const processOperatorKey = (
  key: OperatorKey,
  pendingOperator: PendingOperator,
  getCurrentCount: () => number,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
):
  | {
      handled: true;
      cmdType?: string;
      cmdCount?: number;
      setOperator?: 'd' | 'c' | null;
    }
  | { handled: false } => {
  if (key === 'd') {
    if (pendingOperator === 'd') {
      const count = getCurrentCount();
      buffer.vimDeleteLine(count);
      return {
        handled: true,
        cmdType: CMD_TYPES.DELETE_LINE,
        cmdCount: count,
        setOperator: null,
      };
    }
    return { handled: true, setOperator: 'd' };
  }
  if (key === 'c') {
    if (pendingOperator === 'c') {
      const count = getCurrentCount();
      buffer.vimChangeLine(count);
      updateMode('INSERT');
      return {
        handled: true,
        cmdType: CMD_TYPES.CHANGE_LINE,
        cmdCount: count,
        setOperator: null,
      };
    }
    return { handled: true, setOperator: 'c' };
  }
  if (key === 'D') {
    buffer.vimDeleteToEndOfLine();
    return { handled: true, cmdType: CMD_TYPES.DELETE_TO_EOL, cmdCount: 1 };
  }
  // key === 'C'
  buffer.vimChangeToEndOfLine();
  updateMode('INSERT');
  return { handled: true, cmdType: CMD_TYPES.CHANGE_TO_EOL, cmdCount: 1 };
};

/** Handles arrow keys in NORMAL mode */
const processArrowKey = (
  direction: ArrowDirection,
  repeatCount: number,
  pendingOperator: PendingOperator,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): { handled: boolean; changeCmdType?: ChangeMovementType } => {
  if (pendingOperator === 'c') {
    const movementMap: Record<ArrowDirection, MovementDirection> = {
      left: 'h',
      down: 'j',
      up: 'k',
      right: 'l',
    };
    const cmdType = processChangeMovement(
      movementMap[direction],
      repeatCount,
      buffer,
      updateMode,
    );
    return { handled: true, changeCmdType: cmdType };
  }
  switch (direction) {
    case 'left':
      buffer.vimMoveLeft(repeatCount);
      break;
    case 'down':
      buffer.vimMoveDown(repeatCount);
      break;
    case 'up':
      buffer.vimMoveUp(repeatCount);
      break;
    case 'right':
      buffer.vimMoveRight(repeatCount);
      break;
    default:
      break;
  }
  return { handled: true };
};

/** Handles INSERT mode key input */
const processInsertModeInput = (
  normalizedKey: Key,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): boolean => {
  // Handle escape key
  if (normalizedKey.name === 'escape') {
    buffer.vimEscapeInsertMode();
    updateMode('NORMAL');
    return true;
  }
  // Let InputPrompt handle completion keys
  const isTabKey = normalizedKey.name === 'tab';
  const isReturnWithoutCtrl =
    normalizedKey.name === 'return' && !normalizedKey.ctrl;
  const isArrowKey =
    normalizedKey.name === 'up' || normalizedKey.name === 'down';
  const isCtrlR = normalizedKey.ctrl && normalizedKey.name === 'r';
  if (isTabKey || isReturnWithoutCtrl || isArrowKey || isCtrlR) {
    return false;
  }
  // Let InputPrompt handle Ctrl+V for clipboard
  if (normalizedKey.ctrl && normalizedKey.name === 'v') {
    return false;
  }
  // Let InputPrompt handle shell commands
  if (normalizedKey.sequence === '!' && buffer.text.length === 0) {
    return false;
  }
  buffer.handleInput(normalizedKey);
  return true;
};

/** Dispatches result for movement/arrow keys with change command type */
const dispatchChangeMovementResult = (
  changeCmdType: ChangeMovementType | undefined,
  repeatCount: number,
  dispatch: (action: VimAction) => void,
): void => {
  dispatch({ type: 'CLEAR_COUNT' });
  if (changeCmdType !== undefined) {
    dispatch({
      type: 'SET_LAST_COMMAND',
      command: { type: changeCmdType, count: repeatCount },
    });
    dispatch({ type: 'SET_PENDING_OPERATOR', operator: null });
  }
};

/** Dispatches result for word motion keys */
const dispatchWordMotionResult = (
  cmdType: string | undefined,
  repeatCount: number,
  dispatch: (action: VimAction) => void,
): void => {
  dispatch({ type: 'CLEAR_COUNT' });
  if (cmdType !== undefined) {
    dispatch({
      type: 'SET_LAST_COMMAND',
      command: { type: cmdType, count: repeatCount },
    });
    dispatch({ type: 'SET_PENDING_OPERATOR', operator: null });
  }
};

/** Dispatches result for operator keys */
const dispatchOperatorResult = (
  result:
    | {
        handled: true;
        cmdType?: string;
        cmdCount?: number;
        setOperator?: 'd' | 'c' | null;
      }
    | { handled: false },
  dispatch: (action: VimAction) => void,
): void => {
  if (result.handled && result.setOperator !== undefined) {
    dispatch({ type: 'SET_PENDING_OPERATOR', operator: result.setOperator });
    if (result.setOperator === null) {
      dispatch({ type: 'CLEAR_COUNT' });
    }
  } else {
    dispatch({ type: 'CLEAR_COUNT' });
  }
  if (
    result.handled &&
    result.cmdType !== undefined &&
    result.cmdCount !== undefined
  ) {
    dispatch({
      type: 'SET_LAST_COMMAND',
      command: { type: result.cmdType, count: result.cmdCount },
    });
  }
};

/** Dispatches result for g keys */
const dispatchGKeyResult = (
  key: GKey,
  result: { clearOperator: boolean },
  pendingOperator: PendingOperator,
  dispatch: (action: VimAction) => void,
): void => {
  dispatch({ type: 'CLEAR_COUNT' });
  if (result.clearOperator) {
    dispatch({ type: 'SET_PENDING_OPERATOR', operator: null });
  } else if (key === 'g' && pendingOperator !== 'g') {
    dispatch({ type: 'SET_PENDING_OPERATOR', operator: 'g' });
  }
};

/** Processes NORMAL mode key input - movement/word/insert keys */
const processNormalModeCoreKeys = (
  normalizedKey: Key,
  repeatCount: number,
  state: VimState,
  dispatch: (action: VimAction) => void,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): boolean | null => {
  // Movement keys (h, j, k, l)
  if (['h', 'j', 'k', 'l'].includes(normalizedKey.sequence)) {
    const result = processMovementKey(
      normalizedKey.sequence as MovementDirection,
      repeatCount,
      state.pendingOperator,
      buffer,
      updateMode,
    );
    dispatchChangeMovementResult(result.changeCmdType, repeatCount, dispatch);
    return true;
  }
  // Word motion keys (w, b, e)
  if (['w', 'b', 'e'].includes(normalizedKey.sequence)) {
    const result = processWordMotionKey(
      normalizedKey.sequence as WordMotionKey,
      repeatCount,
      state.pendingOperator,
      buffer,
      updateMode,
    );
    dispatchWordMotionResult(result.cmdType, repeatCount, dispatch);
    return true;
  }
  // Insert mode entry keys (i, a, o, O, I, A)
  if (['i', 'a', 'o', 'O', 'I', 'A'].includes(normalizedKey.sequence)) {
    processInsertModeEntryKey(
      normalizedKey.sequence as InsertModeEntryKey,
      buffer,
      updateMode,
    );
    dispatch({ type: 'CLEAR_COUNT' });
    return true;
  }
  // Line position keys (0, $, ^)
  if (['0', '$', '^'].includes(normalizedKey.sequence)) {
    processLinePositionKey(normalizedKey.sequence as LinePositionKey, buffer);
    dispatch({ type: 'CLEAR_COUNT' });
    return true;
  }
  return null;
};

/** Processes NORMAL mode key input - g/operator/x/./arrow keys */
const processNormalModeSpecialKeys = (
  normalizedKey: Key,
  repeatCount: number,
  state: VimState,
  getCurrentCount: () => number,
  dispatch: (action: VimAction) => void,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): boolean | null => {
  // G keys (g, G)
  if (normalizedKey.sequence === 'g' || normalizedKey.sequence === 'G') {
    const result = processGKey(
      normalizedKey.sequence as GKey,
      state.pendingOperator,
      state.count,
      buffer,
    );
    dispatchGKeyResult(
      normalizedKey.sequence as GKey,
      result,
      state.pendingOperator,
      dispatch,
    );
    return true;
  }
  // Operator keys (d, c, D, C)
  if (['d', 'c', 'D', 'C'].includes(normalizedKey.sequence)) {
    const result = processOperatorKey(
      normalizedKey.sequence as OperatorKey,
      state.pendingOperator,
      getCurrentCount,
      buffer,
      updateMode,
    );
    dispatchOperatorResult(result, dispatch);
    return true;
  }
  // Delete char (x)
  if (normalizedKey.sequence === 'x') {
    buffer.vimDeleteChar(repeatCount);
    dispatch({
      type: 'SET_LAST_COMMAND',
      command: { type: CMD_TYPES.DELETE_CHAR, count: repeatCount },
    });
    dispatch({ type: 'CLEAR_COUNT' });
    return true;
  }
  // Repeat last command (.)
  if (normalizedKey.sequence === '.') {
    if (state.lastCommand) {
      executeCommandType(
        state.lastCommand.type,
        state.lastCommand.count,
        buffer,
        updateMode,
      );
    }
    dispatch({ type: 'CLEAR_COUNT' });
    return true;
  }
  // Arrow keys
  if (['left', 'down', 'up', 'right'].includes(normalizedKey.name)) {
    const result = processArrowKey(
      normalizedKey.name as ArrowDirection,
      repeatCount,
      state.pendingOperator,
      buffer,
      updateMode,
    );
    dispatchChangeMovementResult(result.changeCmdType, repeatCount, dispatch);
    return true;
  }
  return null;
};

/** Handles NORMAL mode key input */
const processNormalModeInput = (
  normalizedKey: Key,
  state: VimState,
  getCurrentCount: () => number,
  dispatch: (action: VimAction) => void,
  buffer: TextBuffer,
  updateMode: (mode: VimMode) => void,
): boolean => {
  const repeatCount = getCurrentCount();

  // Handle escape key
  if (normalizedKey.name === 'escape') {
    if (state.pendingOperator) {
      dispatch({ type: 'CLEAR_PENDING_STATES' });
      return true;
    }
    return false;
  }
  // Handle count input
  if (
    DIGIT_1_TO_9.test(normalizedKey.sequence) ||
    (normalizedKey.sequence === '0' && state.count > 0)
  ) {
    dispatch({
      type: 'INCREMENT_COUNT',
      digit: parseInt(normalizedKey.sequence, 10),
    });
    return true;
  }
  // Core keys
  const coreResult = processNormalModeCoreKeys(
    normalizedKey,
    repeatCount,
    state,
    dispatch,
    buffer,
    updateMode,
  );
  if (coreResult !== null) {
    return coreResult;
  }
  // Special keys
  const specialResult = processNormalModeSpecialKeys(
    normalizedKey,
    repeatCount,
    state,
    getCurrentCount,
    dispatch,
    buffer,
    updateMode,
  );
  if (specialResult !== null) {
    return specialResult;
  }
  // Unknown command - clear pending states
  dispatch({ type: 'CLEAR_PENDING_STATES' });
  return true;
};

/**
 * React hook that provides vim-style editing functionality for text input.
 *
 * Features:
 * - Modal editing (INSERT/NORMAL modes)
 * - Navigation: h,j,k,l,w,b,e,0,$,^,gg,G with count prefixes
 * - Editing: x,a,i,o,O,A,I,d,c,D,C with count prefixes
 * - Complex operations: dd,cc,dw,cw,db,cb,de,ce
 * - Command repetition (.)
 * - Settings persistence
 *
 * @param buffer - TextBuffer instance for text manipulation
 * @param onSubmit - Optional callback for command submission
 * @returns Object with vim state and input handler
 */
export function useVim(
  buffer: TextBuffer,
  _onSubmit?: (value: string) => void,
) {
  const { vimEnabled, vimMode, setVimMode } = useVimMode();
  const [state, dispatch] = useReducer(vimReducer, initialVimState);

  // Sync vim mode from context to local state
  useEffect(() => {
    dispatch({ type: 'SET_MODE', mode: vimMode });
  }, [vimMode]);

  // Helper to update mode in both reducer and context
  const updateMode = useCallback(
    (mode: VimMode) => {
      setVimMode(mode);
      dispatch({ type: 'SET_MODE', mode });
    },
    [setVimMode],
  );

  // Helper to get current count
  const getCurrentCount = useCallback(
    () => (state.count > 0 ? state.count : DEFAULT_COUNT),
    [state.count],
  );

  // Main input handler
  const handleInput = useCallback(
    (key: Key): boolean => {
      if (!vimEnabled) {
        return false;
      }
      let normalizedKey: Key;
      try {
        normalizedKey = normalizeKey(key);
      } catch (error) {
        debugLogger.warn('Malformed key input in vim mode:', key, error);
        return false;
      }
      if (state.mode === 'INSERT') {
        return processInsertModeInput(normalizedKey, buffer, updateMode);
      }
      return processNormalModeInput(
        normalizedKey,
        state,
        getCurrentCount,
        dispatch,
        buffer,
        updateMode,
      );
    },
    [vimEnabled, state, buffer, updateMode, getCurrentCount],
  );

  return {
    mode: state.mode,
    vimModeEnabled: vimEnabled,
    handleInput,
  };
}
