/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { Terminal } from '@xterm/headless';
import {
  serializeTerminalToObject,
  convertColorToHex,
  ColorMode,
  type AnsiOutput,
} from './terminalSerializer.js';

const RED_FG = '\x1b[31m';
const RESET = '\x1b[0m';

function writeToTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
}

/** True when the line has no cells or its first cell is only whitespace. */
function isEmptyOrBlank(line: Array<{ text: string }>): boolean {
  return line.length === 0 || line[0].text.trim() === '';
}

describe('terminalSerializer', () => {
  describe('serializeTerminalToObject', () => {
    it('should handle an empty terminal', () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      const result = serializeTerminalToObject(terminal);
      expect(result).toHaveLength(24);
      result.forEach((line) => {
        expect(isEmptyOrBlank(line)).toBe(true);
      });
    });

    it('should serialize a single line of text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, 'Hello, world!');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].text).toContain('Hello, world!');
    });

    it('should serialize multiple lines of text', async () => {
      const terminal = new Terminal({
        cols: 7,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, 'Line 1\r\nLine 2');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].text).toBe('Line 1 ');
      expect(result[1][0].text).toBe('Line 2');
    });

    it('should handle bold text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[1mBold text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].bold).toBe(true);
      expect(result[0][0].text).toBe('Bold text');
    });

    it('should handle italic text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[3mItalic text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].italic).toBe(true);
      expect(result[0][0].text).toBe('Italic text');
    });

    it('should handle underlined text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[4mUnderlined text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].underline).toBe(true);
      expect(result[0][0].text).toBe('Underlined text');
    });

    it('should handle dim text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[2mDim text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].dim).toBe(true);
      expect(result[0][0].text).toBe('Dim text');
    });

    it('should handle inverse text', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[7mInverse text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].inverse).toBe(true);
      expect(result[0][0].text).toBe('Inverse text');
    });

    it('should handle foreground colors', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, `${RED_FG}Red text${RESET}`);
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].fg).toBe('#800000');
      expect(result[0][0].text).toBe('Red text');
    });

    it('should handle background colors', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[42mGreen background\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].bg).toBe('#008000');
      expect(result[0][0].text).toBe('Green background');
    });

    it('should handle RGB colors', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[38;2;100;200;50mRGB text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].fg).toBe('#64c832');
      expect(result[0][0].text).toBe('RGB text');
    });

    it('should handle a combination of styles', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[1;31;42mStyled text\x1b[0m');
      const result = serializeTerminalToObject(terminal);
      expect(result[0][0].bold).toBe(true);
      expect(result[0][0].fg).toBe('#800000');
      expect(result[0][0].bg).toBe('#008000');
      expect(result[0][0].text).toBe('Styled text');
    });

    it('should set inverse for the cursor position', async () => {
      const terminal = new Terminal({
        cols: 80,
        rows: 24,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, 'Cursor test');
      // Move cursor to the start of the line (0,0) using ANSI escape code
      await writeToTerminal(terminal, '\x1b[H');

      const result = serializeTerminalToObject(terminal);
      // The character at (0,0) should have inverse: true due to cursor
      expect(result[0][0].text).toBe('C');
      expect(result[0][0].inverse).toBe(true);

      // The rest of the text should not have inverse: true (unless explicitly set)
      expect(result[0][1].text.trim()).toBe('ursor test');
      expect(result[0][1].inverse).toBe(false);
    });
  });
  describe('serializeTerminalToObject colorless mode (issue #3432)', () => {
    /** Legacy two-step strip computed inline: this is the specification. */
    function legacyColorlessStrip(terminal: Terminal): AnsiOutput {
      return serializeTerminalToObject(terminal).map((line) =>
        line.map((tok) => ({ ...tok, fg: '', bg: '' })),
      );
    }

    /** Terminal exercising palette, RGB, default colors, flags, blanks, cursor. */
    async function buildRichTerminal(): Promise<Terminal> {
      const terminal = new Terminal({
        cols: 30,
        rows: 8,
        allowProposedApi: true,
      });
      await writeToTerminal(
        terminal,
        '\x1b[1mbold\x1b[0m \x1b[2mdim\x1b[0m plain\x0d\x0a' +
          '\x1b[31mpalette\x1b[0m \x1b[38;2;10;20;30mrgb\x1b[0m \x1b[42mpalettebg\x1b[0m\x0d\x0a' +
          '\x0d\x0a' +
          '\x1b[7minverse\x1b[0m after-blank\x0d\x0a' +
          '\x1b[38;5;208m256color\x1b[0m \x1b[3mital\x1b[0m \x1b[4munder\x1b[0m\x0d\x0a' +
          'cursor parks here',
      );
      await writeToTerminal(terminal, '\x1b[5;12H');
      return terminal;
    }

    it('colorless output deep-equals the legacy two-step strip', async () => {
      const terminal = await buildRichTerminal();
      const direct = serializeTerminalToObject(terminal, { colorless: true });
      expect(direct).toStrictEqual(legacyColorlessStrip(terminal));
    });

    it('colorless output is JSON.stringify-identical to the legacy strip', async () => {
      const terminal = await buildRichTerminal();
      const directJson = JSON.stringify(
        serializeTerminalToObject(terminal, { colorless: true }),
      );
      expect(directJson).toBe(JSON.stringify(legacyColorlessStrip(terminal)));
    });

    it('colorless tokens have empty fg/bg with flags and text preserved', async () => {
      const terminal = new Terminal({
        cols: 30,
        rows: 4,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[1;31;42mstyled\x1b[0m tail');
      const result = serializeTerminalToObject(terminal, { colorless: true });
      expect(result[0][0]).toStrictEqual({
        text: 'styled',
        bold: true,
        italic: false,
        underline: false,
        dim: false,
        inverse: false,
        fg: '',
        bg: '',
      });
      expect(result[0][1].text).toBe(' tail');
      expect(result[0][1].bold).toBe(false);
      expect(result[0][1].fg).toBe('');
      expect(result[0][1].bg).toBe('');
    });

    it('repeated and interleaved serialization returns identical output', async () => {
      const terminal = await buildRichTerminal();
      const colored1 = serializeTerminalToObject(terminal);
      const colorless1 = serializeTerminalToObject(terminal, {
        colorless: true,
      });
      const colored2 = serializeTerminalToObject(terminal);
      const colorless2 = serializeTerminalToObject(terminal, {
        colorless: true,
      });
      expect(colored2).toStrictEqual(colored1);
      expect(colorless2).toStrictEqual(colorless1);
      expect(JSON.stringify(colorless2)).toBe(JSON.stringify(colorless1));
      expect(colorless2).toStrictEqual(legacyColorlessStrip(terminal));
    });

    it('colored output still contains colors after colorless calls', async () => {
      const terminal = new Terminal({
        cols: 20,
        rows: 4,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[31mred\x1b[0m');
      serializeTerminalToObject(terminal, { colorless: true });
      const colored = serializeTerminalToObject(terminal);
      expect(colored[0][0].fg).toBe('#800000');
    });

    it('first cell differing from the null seed keeps its attributes', async () => {
      const terminal = new Terminal({
        cols: 20,
        rows: 4,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, '\x1b[7mA\x1b[0mB');
      const result = serializeTerminalToObject(terminal, { colorless: true });
      expect(result[0][0].text).toBe('A');
      expect(result[0][0].inverse).toBe(true);
      expect(result[0][1].text).toBe('B');
      expect(result[0][1].inverse).toBe(false);
    });

    it('cursor at 0-0 marks the first cell inverse in colorless mode', async () => {
      const terminal = new Terminal({
        cols: 20,
        rows: 4,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, 'hi');
      await writeToTerminal(terminal, '\x1b[H');
      const result = serializeTerminalToObject(terminal, { colorless: true });
      expect(result[0][0].text).toBe('h');
      expect(result[0][0].inverse).toBe(true);
    });

    it('wide characters survive with width padding preserved', async () => {
      const terminal = new Terminal({
        cols: 20,
        rows: 4,
        allowProposedApi: true,
      });
      await writeToTerminal(terminal, 'a\u{1F600}b');
      const result = serializeTerminalToObject(terminal, { colorless: true });
      expect(result[0][0].text).toBe('a\u{1F600}b');
    });
  });
  describe('convertColorToHex', () => {
    it('should convert RGB color to hex', () => {
      const color = (100 << 16) | (200 << 8) | 50;
      const hex = convertColorToHex(color, ColorMode.RGB, '#000000');
      expect(hex).toBe('#64c832');
    });

    it('should convert palette color to hex', () => {
      const hex = convertColorToHex(1, ColorMode.PALETTE, '#000000');
      expect(hex).toBe('#800000');
    });

    it('should return default color for ColorMode.DEFAULT', () => {
      const hex = convertColorToHex(0, ColorMode.DEFAULT, '#ffffff');
      expect(hex).toBe('#ffffff');
    });

    it('should return default color for invalid palette index', () => {
      const hex = convertColorToHex(999, ColorMode.PALETTE, '#000000');
      expect(hex).toBe('#000000');
    });
  });
});
