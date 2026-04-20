/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { keyMatchers, Command, createKeyMatchers } from './keyMatchers.js';
import type { KeyBindingConfig } from '../config/keyBindings.js';
import { defaultKeyBindings } from '../config/keyBindings.js';
import type { Key } from './hooks/useKeypress.js';

describe('keyMatchers', () => {
  const createKey = (name: string, mods: Partial<Key> = {}): Key => ({
    name,
    ctrl: false,
    meta: false,
    shift: false,
    sequence: name,
    ...mods,
  });

  // Test data for each command with positive and negative test cases
  const testCases = [
    // Basic bindings
    {
      command: Command.RETURN,
      positive: [createKey('return')],
      negative: [createKey('r')],
    },
    {
      command: Command.ESCAPE,
      positive: [createKey('escape'), createKey('escape', { ctrl: true })],
      negative: [createKey('e'), createKey('esc')],
    },

    // Cursor movement
    {
      command: Command.HOME,
      positive: [createKey('a', { ctrl: true }), createKey('home')],
      negative: [
        createKey('a'),
        createKey('a', { shift: true }),
        createKey('b', { ctrl: true }),
        createKey('home', { ctrl: true }),
      ],
    },
    {
      command: Command.END,
      positive: [createKey('e', { ctrl: true }), createKey('end')],
      negative: [
        createKey('e'),
        createKey('e', { shift: true }),
        createKey('a', { ctrl: true }),
        createKey('end', { ctrl: true }),
      ],
    },
    {
      command: Command.MOVE_LEFT,
      positive: [createKey('left'), createKey('b', { ctrl: true })],
      negative: [createKey('left', { ctrl: true }), createKey('b')],
    },
    {
      command: Command.MOVE_RIGHT,
      positive: [createKey('right'), createKey('f', { ctrl: true })],
      negative: [createKey('right', { ctrl: true }), createKey('f')],
    },
    {
      command: Command.MOVE_WORD_LEFT,
      positive: [
        createKey('left', { ctrl: true }),
        createKey('left', { meta: true }),
        createKey('b', { meta: true }),
      ],
      negative: [createKey('left'), createKey('b', { ctrl: true })],
    },
    {
      command: Command.MOVE_WORD_RIGHT,
      positive: [
        createKey('right', { ctrl: true }),
        createKey('right', { meta: true }),
        createKey('f', { meta: true }),
      ],
      negative: [createKey('right'), createKey('f', { ctrl: true })],
    },

    // Scrolling
    {
      command: Command.SCROLL_UP,
      positive: [createKey('up', { shift: true })],
      negative: [
        createKey('up'),
        createKey('down', { shift: true }),
        createKey('up', { ctrl: true }),
      ],
    },
    {
      command: Command.SCROLL_DOWN,
      positive: [createKey('down', { shift: true })],
      negative: [
        createKey('down'),
        createKey('up', { shift: true }),
        createKey('down', { ctrl: true }),
      ],
    },
    {
      command: Command.SCROLL_HOME,
      positive: [
        createKey('home', { ctrl: true }),
        createKey('home', { shift: true }),
      ],
      negative: [
        createKey('end'),
        createKey('home'),
        createKey('a', { ctrl: true }),
      ],
    },
    {
      command: Command.SCROLL_END,
      positive: [
        createKey('end', { ctrl: true }),
        createKey('end', { shift: true }),
      ],
      negative: [
        createKey('home'),
        createKey('end'),
        createKey('e', { ctrl: true }),
      ],
    },
    {
      command: Command.PAGE_UP,
      positive: [createKey('pageup'), createKey('pageup', { shift: true })],
      negative: [createKey('pagedown'), createKey('up')],
    },
    {
      command: Command.PAGE_DOWN,
      positive: [createKey('pagedown'), createKey('pagedown', { ctrl: true })],
      negative: [createKey('pageup'), createKey('down')],
    },

    // Text deletion
    {
      command: Command.KILL_LINE_RIGHT,
      positive: [createKey('k', { ctrl: true })],
      negative: [createKey('k'), createKey('l', { ctrl: true })],
    },
    {
      command: Command.KILL_LINE_LEFT,
      positive: [createKey('u', { ctrl: true })],
      negative: [createKey('u'), createKey('k', { ctrl: true })],
    },
    {
      command: Command.CLEAR_INPUT,
      positive: [createKey('c', { ctrl: true })],
      negative: [createKey('c'), createKey('k', { ctrl: true })],
    },
    {
      command: Command.DELETE_CHAR_LEFT,
      positive: [createKey('backspace'), createKey('h', { ctrl: true })],
      negative: [createKey('h'), createKey('x', { ctrl: true })],
    },
    {
      command: Command.DELETE_CHAR_RIGHT,
      positive: [createKey('delete'), createKey('d', { ctrl: true })],
      negative: [createKey('d'), createKey('x', { ctrl: true })],
    },
    {
      command: Command.DELETE_WORD_BACKWARD,
      positive: [
        createKey('backspace', { ctrl: true }),
        createKey('backspace', { meta: true }),
        createKey('w', { ctrl: true }),
      ],
      negative: [createKey('backspace'), createKey('delete', { ctrl: true })],
    },
    {
      command: Command.DELETE_WORD_FORWARD,
      positive: [
        createKey('delete', { ctrl: true }),
        createKey('delete', { meta: true }),
      ],
      negative: [createKey('delete'), createKey('backspace', { ctrl: true })],
    },
    {
      command: Command.UNDO,
      positive: [createKey('z', { ctrl: true, shift: false })],
      negative: [createKey('z'), createKey('z', { ctrl: true, shift: true })],
    },
    {
      command: Command.REDO,
      positive: [createKey('z', { ctrl: true, shift: true })],
      negative: [createKey('z'), createKey('z', { ctrl: true, shift: false })],
    },

    // Screen control
    {
      command: Command.CLEAR_SCREEN,
      positive: [createKey('l', { ctrl: true })],
      negative: [createKey('l'), createKey('k', { ctrl: true })],
    },

    // History navigation
    {
      command: Command.HISTORY_UP,
      positive: [createKey('p', { ctrl: true })],
      negative: [
        createKey('p'),
        createKey('up'),
        createKey('p', { ctrl: true, shift: true }),
      ],
    },
    {
      command: Command.HISTORY_DOWN,
      positive: [createKey('n', { ctrl: true })],
      negative: [
        createKey('n'),
        createKey('down'),
        createKey('n', { ctrl: true, shift: true }),
      ],
    },
    {
      command: Command.NAVIGATION_UP,
      positive: [createKey('up'), createKey('up', { ctrl: true })],
      negative: [
        createKey('p'),
        createKey('u'),
        createKey('up', { shift: true }),
      ],
    },
    {
      command: Command.NAVIGATION_DOWN,
      positive: [createKey('down'), createKey('down', { ctrl: true })],
      negative: [
        createKey('n'),
        createKey('d'),
        createKey('down', { shift: true }),
      ],
    },

    // Dialog navigation
    {
      command: Command.DIALOG_NAVIGATION_UP,
      positive: [createKey('up'), createKey('k')],
      negative: [
        createKey('up', { shift: true }),
        createKey('k', { shift: true }),
        createKey('p'),
      ],
    },
    {
      command: Command.DIALOG_NAVIGATION_DOWN,
      positive: [createKey('down'), createKey('j')],
      negative: [
        createKey('down', { shift: true }),
        createKey('j', { shift: true }),
        createKey('n'),
      ],
    },

    // Auto-completion
    {
      command: Command.ACCEPT_SUGGESTION,
      positive: [createKey('tab'), createKey('return')],
      negative: [createKey('return', { ctrl: true }), createKey('space')],
    },
    {
      command: Command.COMPLETION_UP,
      positive: [createKey('up'), createKey('p', { ctrl: true })],
      negative: [
        createKey('p'),
        createKey('down'),
        createKey('up', { shift: true }),
        createKey('p', { ctrl: true, shift: true }),
      ],
    },
    {
      command: Command.COMPLETION_DOWN,
      positive: [createKey('down'), createKey('n', { ctrl: true })],
      negative: [
        createKey('n'),
        createKey('up'),
        createKey('down', { shift: true }),
        createKey('n', { ctrl: true, shift: true }),
      ],
    },

    // Text input
    {
      command: Command.SUBMIT,
      positive: [createKey('return')],
      negative: [
        createKey('return', { ctrl: true }),
        createKey('return', { meta: true }),
      ],
    },
    {
      command: Command.NEWLINE,
      positive: [
        createKey('return', { ctrl: true }),
        createKey('return', { meta: true }),
      ],
      negative: [createKey('return'), createKey('n')],
    },

    // External tools
    {
      command: Command.OPEN_EXTERNAL_EDITOR,
      positive: [createKey('x', { ctrl: true })],
      negative: [createKey('x'), createKey('c', { ctrl: true })],
    },
    {
      command: Command.PASTE_CLIPBOARD,
      positive: [createKey('v', { ctrl: true })],
      negative: [createKey('v'), createKey('c', { ctrl: true })],
    },

    // App level bindings
    {
      command: Command.SHOW_ERROR_DETAILS,
      positive: [createKey('o', { ctrl: true })],
      negative: [createKey('o'), createKey('e', { ctrl: true })],
    },
    {
      command: Command.TOGGLE_TOOL_DESCRIPTIONS,
      positive: [createKey('t', { ctrl: true })],
      negative: [createKey('t'), createKey('s', { ctrl: true })],
    },
    {
      command: Command.TOGGLE_TODO_DIALOG,
      positive: [createKey('q', { ctrl: true })],
      negative: [createKey('q'), createKey('t', { ctrl: true })],
    },
    {
      command: Command.SHOW_IDE_CONTEXT_DETAIL,
      positive: [createKey('g', { ctrl: true })],
      negative: [createKey('g'), createKey('t', { ctrl: true })],
    },
    {
      command: Command.TOGGLE_MARKDOWN,
      positive: [createKey('m', { meta: true })],
      negative: [createKey('m'), createKey('m', { shift: true })],
    },
    {
      command: Command.TOGGLE_COPY_MODE,
      positive: [createKey('s', { ctrl: true })],
      negative: [createKey('s'), createKey('c', { ctrl: true })],
    },
    {
      command: Command.QUIT,
      positive: [createKey('c', { ctrl: true })],
      negative: [createKey('c'), createKey('d', { ctrl: true })],
    },
    {
      command: Command.EXIT,
      positive: [createKey('d', { ctrl: true })],
      negative: [createKey('d'), createKey('c', { ctrl: true })],
    },
    {
      command: Command.SHOW_MORE_LINES,
      positive: [createKey('s', { ctrl: true })],
      negative: [createKey('s'), createKey('l', { ctrl: true })],
    },

    // Shell commands
    {
      command: Command.REVERSE_SEARCH,
      positive: [createKey('r', { ctrl: true })],
      negative: [createKey('r'), createKey('s', { ctrl: true })],
    },
    {
      command: Command.SUBMIT_REVERSE_SEARCH,
      positive: [createKey('return')],
      negative: [createKey('return', { ctrl: true }), createKey('tab')],
    },
    {
      command: Command.ACCEPT_SUGGESTION_REVERSE_SEARCH,
      positive: [createKey('tab'), createKey('tab', { ctrl: true })],
      negative: [createKey('return'), createKey('space')],
    },

    // Debugging/Terminal fixes
    {
      command: Command.TOGGLE_MOUSE_EVENTS,
      positive: [createKey('\\', { ctrl: true })],
      negative: [createKey('\\'), createKey('r', { ctrl: true })],
    },
    {
      command: Command.TOGGLE_SHELL_INPUT_FOCUS,
      positive: [createKey('f', { ctrl: true })],
      negative: [createKey('f'), createKey('tab')],
    },
    {
      command: Command.FOCUS_SHELL_INPUT,
      positive: [createKey('tab')],
      negative: [createKey('f', { ctrl: true }), createKey('f')],
    },
    {
      command: Command.UNFOCUS_SHELL_INPUT,
      positive: [createKey('tab'), createKey('tab', { shift: true })],
      negative: [createKey('f', { ctrl: true })],
    },
    {
      command: Command.TOGGLE_YOLO,
      positive: [createKey('y', { ctrl: true })],
      negative: [createKey('y'), createKey('y', { meta: true })],
    },
    {
      command: Command.TOGGLE_AUTO_EDIT,
      positive: [createKey('tab', { shift: true })],
      negative: [createKey('tab')],
    },
  ];

  describe('Data-driven key binding matches original logic', () => {
    testCases.forEach(({ command, positive, negative }) => {
      it(`should match ${command} correctly`, () => {
        positive.forEach((key) => {
          expect(
            keyMatchers[command](key),
            `Expected ${command} to match ${JSON.stringify(key)}`,
          ).toBe(true);
        });

        negative.forEach((key) => {
          expect(
            keyMatchers[command](key),
            `Expected ${command} to NOT match ${JSON.stringify(key)}`,
          ).toBe(false);
        });
      });
    });

    it('should properly handle ACCEPT_SUGGESTION_REVERSE_SEARCH cases', () => {
      expect(
        keyMatchers[Command.ACCEPT_SUGGESTION_REVERSE_SEARCH](
          createKey('return', { ctrl: true }),
        ),
      ).toBe(false); // ctrl must be false
      expect(
        keyMatchers[Command.ACCEPT_SUGGESTION_REVERSE_SEARCH](createKey('tab')),
      ).toBe(true);
      expect(
        keyMatchers[Command.ACCEPT_SUGGESTION_REVERSE_SEARCH](
          createKey('tab', { ctrl: true }),
        ),
      ).toBe(true); // modifiers ignored
    });
  });

  describe('Custom key bindings', () => {
    it('should work with custom configuration', () => {
      const customConfig: KeyBindingConfig = {
        ...defaultKeyBindings,
        [Command.HOME]: [{ key: 'h', ctrl: true }, { key: '0' }],
      };

      const customMatchers = createKeyMatchers(customConfig);

      expect(customMatchers[Command.HOME](createKey('h', { ctrl: true }))).toBe(
        true,
      );
      expect(customMatchers[Command.HOME](createKey('0'))).toBe(true);
      expect(customMatchers[Command.HOME](createKey('a', { ctrl: true }))).toBe(
        false,
      );
    });

    it('should support multiple key bindings for same command', () => {
      const config: KeyBindingConfig = {
        ...defaultKeyBindings,
        [Command.QUIT]: [
          { key: 'q', ctrl: true },
          { key: 'q', command: true },
        ],
      };

      const matchers = createKeyMatchers(config);
      expect(matchers[Command.QUIT](createKey('q', { ctrl: true }))).toBe(true);
      expect(matchers[Command.QUIT](createKey('q', { meta: true }))).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty binding arrays', () => {
      const config: KeyBindingConfig = {
        ...defaultKeyBindings,
        [Command.HOME]: [],
      };

      const matchers = createKeyMatchers(config);
      expect(matchers[Command.HOME](createKey('a', { ctrl: true }))).toBe(
        false,
      );
    });
  });
});
