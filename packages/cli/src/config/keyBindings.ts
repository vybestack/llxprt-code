/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Command enum for all available keyboard shortcuts
 */
export enum Command {
  // Basic Controls
  RETURN = 'return',
  ESCAPE = 'escape',
  QUIT = 'quit',
  EXIT = 'exit',

  // Cursor Movement
  HOME = 'home',
  END = 'end',
  MOVE_UP = 'moveUp',
  MOVE_DOWN = 'moveDown',
  MOVE_LEFT = 'moveLeft',
  MOVE_RIGHT = 'moveRight',
  MOVE_WORD_LEFT = 'moveWordLeft',
  MOVE_WORD_RIGHT = 'moveWordRight',

  // Editing
  KILL_LINE_RIGHT = 'killLineRight',
  KILL_LINE_LEFT = 'killLineLeft',
  CLEAR_INPUT = 'clearInput',
  DELETE_WORD_BACKWARD = 'deleteWordBackward',
  DELETE_WORD_FORWARD = 'deleteWordForward',
  DELETE_CHAR_LEFT = 'deleteCharLeft',
  DELETE_CHAR_RIGHT = 'deleteCharRight',
  UNDO = 'undo',
  REDO = 'redo',

  // Scrolling
  SCROLL_UP = 'scrollUp',
  SCROLL_DOWN = 'scrollDown',
  SCROLL_HOME = 'scrollHome',
  SCROLL_END = 'scrollEnd',
  PAGE_UP = 'pageUp',
  PAGE_DOWN = 'pageDown',

  // History & Search
  HISTORY_UP = 'historyUp',
  HISTORY_DOWN = 'historyDown',
  REVERSE_SEARCH = 'reverseSearch',
  SUBMIT_REVERSE_SEARCH = 'submitReverseSearch',
  ACCEPT_SUGGESTION_REVERSE_SEARCH = 'acceptSuggestionReverseSearch',

  // Navigation
  NAVIGATION_UP = 'navigationUp',
  NAVIGATION_DOWN = 'navigationDown',
  DIALOG_NAVIGATION_UP = 'dialogNavigationUp',
  DIALOG_NAVIGATION_DOWN = 'dialogNavigationDown',

  // Suggestions & Completions
  ACCEPT_SUGGESTION = 'acceptSuggestion',
  COMPLETION_UP = 'completionUp',
  COMPLETION_DOWN = 'completionDown',
  EXPAND_SUGGESTION = 'expandSuggestion',
  COLLAPSE_SUGGESTION = 'collapseSuggestion',

  // Text Input
  SUBMIT = 'submit',
  NEWLINE = 'newline',
  OPEN_EXTERNAL_EDITOR = 'openExternalEditor',
  PASTE_CLIPBOARD = 'pasteClipboard',

  // App Controls
  SHOW_ERROR_DETAILS = 'showErrorDetails',
  TOGGLE_TOOL_DESCRIPTIONS = 'toggleToolDescriptions', // LLXPRT-SPECIFIC
  TOGGLE_TODO_DIALOG = 'toggleTodoDialog', // LLXPRT-SPECIFIC
  SHOW_IDE_CONTEXT_DETAIL = 'showIDEContextDetail',
  TOGGLE_MARKDOWN = 'toggleMarkdown',
  TOGGLE_COPY_MODE = 'toggleCopyMode',
  TOGGLE_YOLO = 'toggleYolo',
  TOGGLE_AUTO_EDIT = 'toggleAutoEdit',
  SHOW_MORE_LINES = 'showMoreLines',
  TOGGLE_SHELL_INPUT_FOCUS = 'toggleShellInputFocus',
  FOCUS_SHELL_INPUT = 'focusShellInput',
  UNFOCUS_SHELL_INPUT = 'unfocusShellInput',
  CLEAR_SCREEN = 'clearScreen',
  REFRESH_KEYPRESS = 'refreshKeypress', // LLXPRT-SPECIFIC
  TOGGLE_MOUSE_EVENTS = 'toggleMouseEvents', // LLXPRT-SPECIFIC
}

/**
 * Data-driven key binding structure for user configuration
 */
export interface KeyBinding {
  /** The key name (e.g., 'a', 'return', 'tab', 'escape') */
  key?: string;
  /** The key sequence (e.g., '\x18' for Ctrl+X) - alternative to key name */
  sequence?: string;
  /** Control key requirement: true=must be pressed, false=must not be pressed, undefined=ignore */
  ctrl?: boolean;
  /** Shift key requirement: true=must be pressed, false=must not be pressed, undefined=ignore */
  shift?: boolean;
  /** Command/meta key requirement: true=must be pressed, false=must not be pressed, undefined=ignore */
  command?: boolean;
  /** Paste operation requirement: true=must be paste, false=must not be paste, undefined=ignore */
  paste?: boolean;
}

/**
 * Configuration type mapping commands to their key bindings
 */
export type KeyBindingConfig = {
  readonly [C in Command]: readonly KeyBinding[];
};

/**
 * Default key binding configuration
 * Matches the original hard-coded logic exactly
 */
export const defaultKeyBindings: KeyBindingConfig = {
  // Basic Controls
  [Command.RETURN]: [{ key: 'return' }],
  [Command.ESCAPE]: [{ key: 'escape' }],
  [Command.QUIT]: [{ key: 'c', ctrl: true }],
  [Command.EXIT]: [{ key: 'd', ctrl: true }],

  // Cursor Movement
  [Command.HOME]: [
    { key: 'a', ctrl: true },
    { key: 'home', ctrl: false, shift: false },
  ],
  [Command.END]: [
    { key: 'e', ctrl: true },
    { key: 'end', ctrl: false, shift: false },
  ],
  [Command.MOVE_UP]: [{ key: 'up', ctrl: false, command: false }],
  [Command.MOVE_DOWN]: [{ key: 'down', ctrl: false, command: false }],
  [Command.MOVE_LEFT]: [
    { key: 'left', ctrl: false, command: false },
    { key: 'b', ctrl: true },
  ],
  [Command.MOVE_RIGHT]: [
    { key: 'right', ctrl: false, command: false },
    { key: 'f', ctrl: true },
  ],
  [Command.MOVE_WORD_LEFT]: [
    { key: 'left', ctrl: true },
    { key: 'left', command: true },
    { key: 'b', command: true },
  ],
  [Command.MOVE_WORD_RIGHT]: [
    { key: 'right', ctrl: true },
    { key: 'right', command: true },
    { key: 'f', command: true },
  ],

  // Editing
  [Command.KILL_LINE_RIGHT]: [{ key: 'k', ctrl: true }],
  [Command.KILL_LINE_LEFT]: [{ key: 'u', ctrl: true }],
  [Command.CLEAR_INPUT]: [{ key: 'c', ctrl: true }],
  // Added command (meta/alt/option) for mac compatibility
  [Command.DELETE_WORD_BACKWARD]: [
    { key: 'backspace', ctrl: true },
    { key: 'backspace', command: true },
    { key: 'w', ctrl: true },
  ],
  [Command.DELETE_WORD_FORWARD]: [
    { key: 'delete', ctrl: true },
    { key: 'delete', command: true },
  ],
  [Command.DELETE_CHAR_LEFT]: [{ key: 'backspace' }, { key: 'h', ctrl: true }],
  [Command.DELETE_CHAR_RIGHT]: [{ key: 'delete' }, { key: 'd', ctrl: true }],
  [Command.UNDO]: [{ key: 'z', ctrl: true, shift: false }],
  [Command.REDO]: [{ key: 'z', ctrl: true, shift: true }],

  // Scrolling
  [Command.SCROLL_UP]: [{ key: 'up', shift: true }],
  [Command.SCROLL_DOWN]: [{ key: 'down', shift: true }],
  [Command.SCROLL_HOME]: [
    { key: 'home', ctrl: true },
    { key: 'home', shift: true },
  ],
  [Command.SCROLL_END]: [
    { key: 'end', ctrl: true },
    { key: 'end', shift: true },
  ],
  [Command.PAGE_UP]: [{ key: 'pageup' }],
  [Command.PAGE_DOWN]: [{ key: 'pagedown' }],

  // History & Search
  [Command.HISTORY_UP]: [{ key: 'p', ctrl: true, shift: false }],
  [Command.HISTORY_DOWN]: [{ key: 'n', ctrl: true, shift: false }],
  [Command.REVERSE_SEARCH]: [{ key: 'r', ctrl: true }],
  // Note: original logic ONLY checked ctrl=false, ignored meta/shift/paste
  [Command.SUBMIT_REVERSE_SEARCH]: [{ key: 'return', ctrl: false }],
  [Command.ACCEPT_SUGGESTION_REVERSE_SEARCH]: [{ key: 'tab' }],

  // Navigation
  [Command.NAVIGATION_UP]: [{ key: 'up', shift: false }],
  [Command.NAVIGATION_DOWN]: [{ key: 'down', shift: false }],
  // Navigation shortcuts appropriate for dialogs where we do not need to accept
  // text input.
  [Command.DIALOG_NAVIGATION_UP]: [
    { key: 'up', shift: false },
    { key: 'k', shift: false },
  ],
  [Command.DIALOG_NAVIGATION_DOWN]: [
    { key: 'down', shift: false },
    { key: 'j', shift: false },
  ],

  // Suggestions & Completions
  [Command.ACCEPT_SUGGESTION]: [{ key: 'tab' }, { key: 'return', ctrl: false }],
  // Completion navigation (arrow or Ctrl+P/N)
  [Command.COMPLETION_UP]: [
    { key: 'up', shift: false },
    { key: 'p', ctrl: true, shift: false },
  ],
  [Command.COMPLETION_DOWN]: [
    { key: 'down', shift: false },
    { key: 'n', ctrl: true, shift: false },
  ],
  [Command.EXPAND_SUGGESTION]: [{ key: 'right' }],
  [Command.COLLAPSE_SUGGESTION]: [{ key: 'left' }],

  // Text Input
  // Must also exclude shift to allow shift+enter for newline
  [Command.SUBMIT]: [
    {
      key: 'return',
      ctrl: false,
      command: false,
      shift: false,
    },
  ],
  // Split into multiple data-driven bindings
  // Now also includes shift+enter for multi-line input
  [Command.NEWLINE]: [
    { key: 'return', ctrl: true },
    { key: 'return', command: true },
    { key: 'return', shift: true },
    { key: 'j', ctrl: true },
  ],
  [Command.OPEN_EXTERNAL_EDITOR]: [{ key: 'x', ctrl: true }],
  [Command.PASTE_CLIPBOARD]: [
    { key: 'v', ctrl: true },
    { key: 'v', command: true },
  ],

  // App Controls
  [Command.SHOW_ERROR_DETAILS]: [{ key: 'o', ctrl: true }],
  [Command.TOGGLE_TOOL_DESCRIPTIONS]: [{ key: 't', ctrl: true }],
  [Command.TOGGLE_TODO_DIALOG]: [{ key: 'q', ctrl: true }],
  [Command.SHOW_IDE_CONTEXT_DETAIL]: [{ key: 'g', ctrl: true }],
  [Command.TOGGLE_MARKDOWN]: [{ key: 'm', command: true }],
  [Command.TOGGLE_COPY_MODE]: [{ key: 's', ctrl: true }],
  [Command.TOGGLE_YOLO]: [{ key: 'y', ctrl: true }],
  [Command.TOGGLE_AUTO_EDIT]: [{ key: 'tab', shift: true }],
  [Command.SHOW_MORE_LINES]: [{ key: 's', ctrl: true }],
  // Context note: Ctrl+F intentionally toggles embedded shell input focus when
  // an interactive shell is attached, even though Ctrl+F is otherwise commonly
  // used for cursor-forward behavior in readline-style input editing.
  [Command.TOGGLE_SHELL_INPUT_FOCUS]: [{ key: 'f', ctrl: true }],
  [Command.FOCUS_SHELL_INPUT]: [{ key: 'tab', shift: false }],
  [Command.UNFOCUS_SHELL_INPUT]: [
    { key: 'tab', shift: false },
    { key: 'tab', shift: true },
  ],
  [Command.CLEAR_SCREEN]: [{ key: 'l', ctrl: true }],
  [Command.REFRESH_KEYPRESS]: [{ key: 'r', ctrl: true, shift: true }],
  [Command.TOGGLE_MOUSE_EVENTS]: [
    // Ctrl+\ (typically FS / \x1c)
    { key: '\\', ctrl: true },
  ],
};

interface CommandCategory {
  readonly title: string;
  readonly commands: readonly Command[];
}

/**
 * Presentation metadata for grouping commands in documentation or UI.
 */
export const commandCategories: readonly CommandCategory[] = [
  {
    title: 'Basic Controls',
    commands: [Command.RETURN, Command.ESCAPE, Command.QUIT, Command.EXIT],
  },
  {
    title: 'Cursor Movement',
    commands: [
      Command.HOME,
      Command.END,
      Command.MOVE_UP,
      Command.MOVE_DOWN,
      Command.MOVE_LEFT,
      Command.MOVE_RIGHT,
      Command.MOVE_WORD_LEFT,
      Command.MOVE_WORD_RIGHT,
    ],
  },
  {
    title: 'Editing',
    commands: [
      Command.KILL_LINE_RIGHT,
      Command.KILL_LINE_LEFT,
      Command.CLEAR_INPUT,
      Command.DELETE_WORD_BACKWARD,
      Command.DELETE_WORD_FORWARD,
      Command.DELETE_CHAR_LEFT,
      Command.DELETE_CHAR_RIGHT,
      Command.UNDO,
      Command.REDO,
    ],
  },
  {
    title: 'Scrolling',
    commands: [
      Command.SCROLL_UP,
      Command.SCROLL_DOWN,
      Command.SCROLL_HOME,
      Command.SCROLL_END,
      Command.PAGE_UP,
      Command.PAGE_DOWN,
    ],
  },
  {
    title: 'History & Search',
    commands: [
      Command.HISTORY_UP,
      Command.HISTORY_DOWN,
      Command.REVERSE_SEARCH,
      Command.SUBMIT_REVERSE_SEARCH,
      Command.ACCEPT_SUGGESTION_REVERSE_SEARCH,
    ],
  },
  {
    title: 'Navigation',
    commands: [
      Command.NAVIGATION_UP,
      Command.NAVIGATION_DOWN,
      Command.DIALOG_NAVIGATION_UP,
      Command.DIALOG_NAVIGATION_DOWN,
    ],
  },
  {
    title: 'Suggestions & Completions',
    commands: [
      Command.ACCEPT_SUGGESTION,
      Command.COMPLETION_UP,
      Command.COMPLETION_DOWN,
      Command.EXPAND_SUGGESTION,
      Command.COLLAPSE_SUGGESTION,
    ],
  },
  {
    title: 'Text Input',
    commands: [
      Command.SUBMIT,
      Command.NEWLINE,
      Command.OPEN_EXTERNAL_EDITOR,
      Command.PASTE_CLIPBOARD,
    ],
  },
  {
    title: 'App Controls',
    commands: [
      Command.SHOW_ERROR_DETAILS,
      Command.SHOW_IDE_CONTEXT_DETAIL,
      Command.TOGGLE_MARKDOWN,
      Command.TOGGLE_COPY_MODE,
      Command.TOGGLE_YOLO,
      Command.TOGGLE_AUTO_EDIT,
      Command.SHOW_MORE_LINES,
      Command.TOGGLE_SHELL_INPUT_FOCUS,
      Command.FOCUS_SHELL_INPUT,
      Command.UNFOCUS_SHELL_INPUT,
      Command.CLEAR_SCREEN,
      Command.REFRESH_KEYPRESS,
    ],
  },
  {
    title: 'Todo Dialog',
    commands: [Command.TOGGLE_TODO_DIALOG, Command.TOGGLE_TOOL_DESCRIPTIONS],
  },
  {
    title: 'Mouse',
    commands: [Command.TOGGLE_MOUSE_EVENTS],
  },
];

/**
 * Human-readable descriptions for each command, used in docs/tooling.
 */
export const commandDescriptions: Readonly<Record<Command, string>> = {
  // Basic Controls
  [Command.RETURN]: 'Confirm the current selection or choice.',
  [Command.ESCAPE]: 'Dismiss dialogs or cancel the current focus.',
  [Command.QUIT]:
    'Cancel the current request or quit the CLI when input is empty.',
  [Command.EXIT]: 'Exit the CLI when the input buffer is empty.',

  // Cursor Movement
  [Command.HOME]: 'Move the cursor to the start of the line.',
  [Command.END]: 'Move the cursor to the end of the line.',
  [Command.MOVE_UP]: 'Move the cursor up one line.',
  [Command.MOVE_DOWN]: 'Move the cursor down one line.',
  [Command.MOVE_LEFT]: 'Move the cursor one character to the left.',
  [Command.MOVE_RIGHT]: 'Move the cursor one character to the right.',
  [Command.MOVE_WORD_LEFT]: 'Move the cursor one word to the left.',
  [Command.MOVE_WORD_RIGHT]: 'Move the cursor one word to the right.',

  // Editing
  [Command.KILL_LINE_RIGHT]: 'Delete from the cursor to the end of the line.',
  [Command.KILL_LINE_LEFT]: 'Delete from the cursor to the start of the line.',
  [Command.CLEAR_INPUT]: 'Clear all text in the input field.',
  [Command.DELETE_WORD_BACKWARD]: 'Delete the previous word.',
  [Command.DELETE_WORD_FORWARD]: 'Delete the next word.',
  [Command.DELETE_CHAR_LEFT]: 'Delete the character to the left.',
  [Command.DELETE_CHAR_RIGHT]: 'Delete the character to the right.',
  [Command.UNDO]: 'Undo the most recent text edit.',
  [Command.REDO]: 'Redo the most recent undone text edit.',

  // Scrolling
  [Command.SCROLL_UP]: 'Scroll content up.',
  [Command.SCROLL_DOWN]: 'Scroll content down.',
  [Command.SCROLL_HOME]: 'Scroll to the top.',
  [Command.SCROLL_END]: 'Scroll to the bottom.',
  [Command.PAGE_UP]: 'Scroll up by one page.',
  [Command.PAGE_DOWN]: 'Scroll down by one page.',

  // History & Search
  [Command.HISTORY_UP]: 'Show the previous entry in history.',
  [Command.HISTORY_DOWN]: 'Show the next entry in history.',
  [Command.REVERSE_SEARCH]: 'Start reverse search through history.',
  [Command.SUBMIT_REVERSE_SEARCH]: 'Submit the selected reverse-search match.',
  [Command.ACCEPT_SUGGESTION_REVERSE_SEARCH]:
    'Accept a suggestion while reverse searching.',

  // Navigation
  [Command.NAVIGATION_UP]: 'Move selection up in lists.',
  [Command.NAVIGATION_DOWN]: 'Move selection down in lists.',
  [Command.DIALOG_NAVIGATION_UP]: 'Move up within dialog options.',
  [Command.DIALOG_NAVIGATION_DOWN]: 'Move down within dialog options.',

  // Suggestions & Completions
  [Command.ACCEPT_SUGGESTION]: 'Accept the inline suggestion.',
  [Command.COMPLETION_UP]: 'Move to the previous completion option.',
  [Command.COMPLETION_DOWN]: 'Move to the next completion option.',
  [Command.EXPAND_SUGGESTION]: 'Expand an inline suggestion.',
  [Command.COLLAPSE_SUGGESTION]: 'Collapse an inline suggestion.',

  // Text Input
  [Command.SUBMIT]: 'Submit the current prompt.',
  [Command.NEWLINE]: 'Insert a newline without submitting.',
  [Command.OPEN_EXTERNAL_EDITOR]:
    'Open the current prompt in an external editor.',
  [Command.PASTE_CLIPBOARD]:
    'Paste from the clipboard (image preferred, falls back to text).',

  // App Controls
  [Command.SHOW_ERROR_DETAILS]: 'Toggle detailed error information.',
  [Command.TOGGLE_TOOL_DESCRIPTIONS]: 'Toggle tool descriptions display.',
  [Command.TOGGLE_TODO_DIALOG]: 'Toggle the TODO dialog visibility.',
  [Command.SHOW_IDE_CONTEXT_DETAIL]: 'Show IDE context details.',
  [Command.TOGGLE_MARKDOWN]: 'Toggle Markdown rendering.',
  [Command.TOGGLE_COPY_MODE]: 'Toggle copy mode when in alternate buffer mode.',
  [Command.TOGGLE_YOLO]: 'Toggle YOLO (auto-approval) mode for tool calls.',
  [Command.TOGGLE_AUTO_EDIT]: 'Toggle Auto Edit (auto-accept edits) mode.',
  [Command.SHOW_MORE_LINES]:
    'Expand a height-constrained response to show additional lines when not in alternate buffer mode.',
  [Command.TOGGLE_SHELL_INPUT_FOCUS]:
    'Toggle focus between the shell and LLxprt input when an interactive shell is attached.',
  [Command.FOCUS_SHELL_INPUT]:
    'Toggle focus into the interactive shell from LLxprt input.',
  [Command.UNFOCUS_SHELL_INPUT]:
    'Toggle focus out of the interactive shell and into LLxprt input.',
  [Command.CLEAR_SCREEN]: 'Clear the terminal screen and redraw the UI.',
  [Command.REFRESH_KEYPRESS]: 'Refresh keypress handling.',
  [Command.TOGGLE_MOUSE_EVENTS]: 'Toggle mouse event tracking.',
};
