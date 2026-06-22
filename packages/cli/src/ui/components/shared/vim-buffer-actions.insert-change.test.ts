/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import '../../../test-utils/customMatchers.js';
import { handleVimAction } from './vim-buffer-actions.js';
import { createTestState } from './vim-buffer-actions-test-helpers.js';

describe('vim-buffer-actions', () => {
  describe('Insert mode commands', () => {
    describe('vim_insert_at_cursor', () => {
      it('should not change cursor position', () => {
        const state = createTestState(['hello'], 0, 2);
        const action = { type: 'vim_insert_at_cursor' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(2);
      });
    });

    describe('vim_append_at_cursor', () => {
      it('should move cursor right by one', () => {
        const state = createTestState(['hello'], 0, 2);
        const action = { type: 'vim_append_at_cursor' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(3);
      });

      it('should not move past end of line', () => {
        const state = createTestState(['hello'], 0, 5);
        const action = { type: 'vim_append_at_cursor' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(5);
      });
    });

    describe('vim_append_at_line_end', () => {
      it('should move cursor to end of line', () => {
        const state = createTestState(['hello world'], 0, 3);
        const action = { type: 'vim_append_at_line_end' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(11);
      });
    });

    describe('vim_insert_at_line_start', () => {
      it('should move to first non-whitespace character', () => {
        const state = createTestState(['  hello world'], 0, 5);
        const action = { type: 'vim_insert_at_line_start' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(2);
      });

      it('should move to column 0 for line with only whitespace', () => {
        const state = createTestState(['   '], 0, 1);
        const action = { type: 'vim_insert_at_line_start' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(3);
      });
    });

    describe('vim_open_line_below', () => {
      it('should insert a new line below the current one', () => {
        const state = createTestState(['hello world'], 0, 5);
        const action = { type: 'vim_open_line_below' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines).toStrictEqual(['hello world', '']);
        expect(result.cursorRow).toBe(1);
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('vim_open_line_above', () => {
      it('should insert a new line above the current one', () => {
        const state = createTestState(['hello', 'world'], 1, 2);
        const action = { type: 'vim_open_line_above' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines).toStrictEqual(['hello', '', 'world']);
        expect(result.cursorRow).toBe(1);
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('vim_escape_insert_mode', () => {
      it('should move cursor left', () => {
        const state = createTestState(['hello'], 0, 3);
        const action = { type: 'vim_escape_insert_mode' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(2);
      });

      it('should not move past beginning of line', () => {
        const state = createTestState(['hello'], 0, 0);
        const action = { type: 'vim_escape_insert_mode' as const };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(0);
      });
    });
  });

  describe('Change commands', () => {
    describe('vim_change_word_forward', () => {
      it('should delete from cursor to next word start', () => {
        const state = createTestState(['hello world test'], 0, 0);
        const action = {
          type: 'vim_change_word_forward' as const,
          payload: { count: 1 },
        };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines[0]).toBe('world test');
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('vim_change_line', () => {
      it('should delete entire line content', () => {
        const state = createTestState(['hello world'], 0, 5);
        const action = {
          type: 'vim_change_line' as const,
          payload: { count: 1 },
        };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines[0]).toBe('');
        expect(result.cursorCol).toBe(0);
      });
    });

    describe('vim_change_movement', () => {
      it('should change characters to the left', () => {
        const state = createTestState(['hello world'], 0, 5);
        const action = {
          type: 'vim_change_movement' as const,
          payload: { movement: 'h' as const, count: 2 },
        };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines[0]).toBe('hel world');
        expect(result.cursorCol).toBe(3);
      });

      it('should change characters to the right', () => {
        const state = createTestState(['hello world'], 0, 5);
        const action = {
          type: 'vim_change_movement' as const,
          payload: { movement: 'l' as const, count: 3 },
        };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines[0]).toBe('hellorld'); // Deletes ' wo' (3 chars to the right)
        expect(result.cursorCol).toBe(5);
      });

      it('should change multiple lines down', () => {
        const state = createTestState(['line1', 'line2', 'line3'], 0, 2);
        const action = {
          type: 'vim_change_movement' as const,
          payload: { movement: 'j' as const, count: 2 },
        };

        const result = handleVimAction(state, action);
        expect(result).toHaveOnlyValidCharacters();
        expect(result.lines).toStrictEqual(['line1', 'line2', 'line3']);
        expect(result.cursorRow).toBe(0);
        expect(result.cursorCol).toBe(2);
      });
    });
  });

  describe('Edge cases', () => {
    it('should handle empty text', () => {
      const state = createTestState([''], 0, 0);
      const action = {
        type: 'vim_move_word_forward' as const,
        payload: { count: 1 },
      };

      const result = handleVimAction(state, action);
      expect(result).toHaveOnlyValidCharacters();
      expect(result.cursorRow).toBe(0);
      expect(result.cursorCol).toBe(0);
    });

    it('should handle single character line', () => {
      const state = createTestState(['a'], 0, 0);
      const action = { type: 'vim_move_to_line_end' as const };

      const result = handleVimAction(state, action);
      expect(result).toHaveOnlyValidCharacters();
      expect(result.cursorCol).toBe(0);
    });

    it('should handle empty lines in multi-line text', () => {
      const state = createTestState(['line1', '', 'line3'], 1, 0);
      const action = {
        type: 'vim_move_word_forward' as const,
        payload: { count: 1 },
      };

      const result = handleVimAction(state, action);
      expect(result).toHaveOnlyValidCharacters();
      expect(result.cursorRow).toBe(2);
      expect(result.cursorCol).toBe(0);
    });

    it('should preserve undo stack in operations', () => {
      const state = createTestState(['hello'], 0, 0);
      state.undoStack = [{ lines: ['previous'], cursorRow: 0, cursorCol: 0 }];

      const action = {
        type: 'vim_delete_char' as const,
        payload: { count: 1 },
      };

      const result = handleVimAction(state, action);
      expect(result).toHaveOnlyValidCharacters();
      expect(result.undoStack).toHaveLength(2);
    });
  });

  describe('UTF-32 character handling in word/line operations', () => {
    describe('Right-to-left text handling', () => {
      it('should handle Arabic text in word movements', () => {
        const state = createTestState(['hello مرحبا world'], 0, 0);

        let result = handleVimAction(state, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(4);

        result = handleVimAction(result, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(10);
      });
    });

    describe('Chinese character handling', () => {
      it('should handle Chinese characters in word movements', () => {
        const state = createTestState(['hello 你好 world'], 0, 0);

        let result = handleVimAction(state, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(4);

        result = handleVimAction(result, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(6);
      });
    });

    describe('Mixed script handling', () => {
      it('should handle mixed Latin and non-Latin scripts with word end commands', () => {
        const state = createTestState(['test中文test'], 0, 0);

        let result = handleVimAction(state, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(3);

        result = handleVimAction(result, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(5);
      });

      it('should handle mixed Latin and non-Latin scripts with word forward commands', () => {
        const state = createTestState(['test中文test'], 0, 0);

        let result = handleVimAction(state, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(4);

        result = handleVimAction(result, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(6);
      });

      it('should handle mixed Latin and non-Latin scripts with word backward commands', () => {
        const state = createTestState(['test中文test'], 0, 9);

        let result = handleVimAction(state, {
          type: 'vim_move_word_backward' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(6);

        result = handleVimAction(result, {
          type: 'vim_move_word_backward' as const,
          payload: { count: 1 },
        });
        expect(result).toHaveOnlyValidCharacters();
        expect(result.cursorCol).toBe(4);
      });

      it('should handle Unicode block characters consistently with w and e commands', () => {
        const state = createTestState(['██ █████ ██'], 0, 0);

        let wResult = handleVimAction(state, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult).toHaveOnlyValidCharacters();
        expect(wResult.cursorCol).toBe(3);

        wResult = handleVimAction(wResult, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult).toHaveOnlyValidCharacters();
        expect(wResult.cursorCol).toBe(9);

        let eResult = handleVimAction(state, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(eResult).toHaveOnlyValidCharacters();
        expect(eResult.cursorCol).toBe(1);

        eResult = handleVimAction(eResult, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(eResult).toHaveOnlyValidCharacters();
        expect(eResult.cursorCol).toBe(7);

        eResult = handleVimAction(eResult, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(eResult).toHaveOnlyValidCharacters();
        expect(eResult.cursorCol).toBe(10);
      });

      it('should handle strings starting with Chinese characters', () => {
        const state = createTestState(['中文test英文word'], 0, 0);

        let wResult = handleVimAction(state, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult).toHaveOnlyValidCharacters();
        expect(wResult.cursorCol).toBe(2);

        wResult = handleVimAction(wResult, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult.cursorCol).toBe(6);

        let eResult = handleVimAction(state, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(eResult).toHaveOnlyValidCharacters();
        expect(eResult.cursorCol).toBe(1);

        eResult = handleVimAction(eResult, {
          type: 'vim_move_word_end' as const,
          payload: { count: 1 },
        });
        expect(eResult.cursorCol).toBe(5);
      });

      it('should handle strings starting with Arabic characters', () => {
        const state = createTestState(['مرحباhelloسلام'], 0, 0);

        let wResult = handleVimAction(state, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult).toHaveOnlyValidCharacters();
        expect(wResult.cursorCol).toBe(5);

        wResult = handleVimAction(wResult, {
          type: 'vim_move_word_forward' as const,
          payload: { count: 1 },
        });
        expect(wResult.cursorCol).toBe(10);

        const bState = createTestState(['مرحباhelloسلام'], 0, 13);
        let bResult = handleVimAction(bState, {
          type: 'vim_move_word_backward' as const,
          payload: { count: 1 },
        });
        expect(bResult).toHaveOnlyValidCharacters();
        expect(bResult.cursorCol).toBe(10);

        bResult = handleVimAction(bResult, {
          type: 'vim_move_word_backward' as const,
          payload: { count: 1 },
        });
        expect(bResult.cursorCol).toBe(5);
      });
    });
  });
});
