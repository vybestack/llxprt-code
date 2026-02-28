/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidColor,
  resolveColor,
  interpolateColor,
  CSS_NAME_TO_HEX_MAP,
  INK_SUPPORTED_NAMES,
  getThemeTypeFromBackgroundColor,
  detectTerminalBackgroundColor,
} from './color-utils.js';

describe('Color Utils', () => {
  describe('isValidColor', () => {
    it('should validate hex colors', () => {
      expect(isValidColor('#ff0000')).toBe(true);
      expect(isValidColor('#00ff00')).toBe(true);
      expect(isValidColor('#0000ff')).toBe(true);
      expect(isValidColor('#fff')).toBe(true);
      expect(isValidColor('#000')).toBe(true);
      expect(isValidColor('#FF0000')).toBe(true); // Case insensitive
    });

    it('should validate Ink-supported color names', () => {
      expect(isValidColor('black')).toBe(true);
      expect(isValidColor('red')).toBe(true);
      expect(isValidColor('green')).toBe(true);
      expect(isValidColor('yellow')).toBe(true);
      expect(isValidColor('blue')).toBe(true);
      expect(isValidColor('cyan')).toBe(true);
      expect(isValidColor('magenta')).toBe(true);
      expect(isValidColor('white')).toBe(true);
      expect(isValidColor('gray')).toBe(true);
      expect(isValidColor('grey')).toBe(true);
      expect(isValidColor('blackbright')).toBe(true);
      expect(isValidColor('redbright')).toBe(true);
      expect(isValidColor('greenbright')).toBe(true);
      expect(isValidColor('yellowbright')).toBe(true);
      expect(isValidColor('bluebright')).toBe(true);
      expect(isValidColor('cyanbright')).toBe(true);
      expect(isValidColor('magentabright')).toBe(true);
      expect(isValidColor('whitebright')).toBe(true);
    });

    it('should validate Ink-supported color names case insensitive', () => {
      expect(isValidColor('BLACK')).toBe(true);
      expect(isValidColor('Red')).toBe(true);
      expect(isValidColor('GREEN')).toBe(true);
    });

    it('should validate CSS color names', () => {
      expect(isValidColor('darkkhaki')).toBe(true);
      expect(isValidColor('coral')).toBe(true);
      expect(isValidColor('teal')).toBe(true);
      expect(isValidColor('tomato')).toBe(true);
      expect(isValidColor('turquoise')).toBe(true);
      expect(isValidColor('violet')).toBe(true);
      expect(isValidColor('wheat')).toBe(true);
      expect(isValidColor('whitesmoke')).toBe(true);
      expect(isValidColor('yellowgreen')).toBe(true);
    });

    it('should validate CSS color names case insensitive', () => {
      expect(isValidColor('DARKKHAKI')).toBe(true);
      expect(isValidColor('Coral')).toBe(true);
      expect(isValidColor('TEAL')).toBe(true);
    });

    it('should reject invalid color names', () => {
      expect(isValidColor('invalidcolor')).toBe(false);
      expect(isValidColor('notacolor')).toBe(false);
      expect(isValidColor('')).toBe(false);
    });
  });

  describe('resolveColor', () => {
    it('should resolve hex colors', () => {
      expect(resolveColor('#ff0000')).toBe('#ff0000');
      expect(resolveColor('#00ff00')).toBe('#00ff00');
      expect(resolveColor('#0000ff')).toBe('#0000ff');
      expect(resolveColor('#fff')).toBe('#fff');
      expect(resolveColor('#000')).toBe('#000');
    });

    it('should resolve Ink-supported color names', () => {
      expect(resolveColor('black')).toBe('black');
      expect(resolveColor('red')).toBe('red');
      expect(resolveColor('green')).toBe('green');
      expect(resolveColor('yellow')).toBe('yellow');
      expect(resolveColor('blue')).toBe('blue');
      expect(resolveColor('cyan')).toBe('cyan');
      expect(resolveColor('magenta')).toBe('magenta');
      expect(resolveColor('white')).toBe('white');
      expect(resolveColor('gray')).toBe('gray');
      expect(resolveColor('grey')).toBe('grey');
    });

    it('should resolve CSS color names to hex', () => {
      expect(resolveColor('darkkhaki')).toBe('#bdb76b');
      expect(resolveColor('coral')).toBe('#ff7f50');
      expect(resolveColor('teal')).toBe('#008080');
      expect(resolveColor('tomato')).toBe('#ff6347');
      expect(resolveColor('turquoise')).toBe('#40e0d0');
      expect(resolveColor('violet')).toBe('#ee82ee');
      expect(resolveColor('wheat')).toBe('#f5deb3');
      expect(resolveColor('whitesmoke')).toBe('#f5f5f5');
      expect(resolveColor('yellowgreen')).toBe('#9acd32');
    });

    it('should handle case insensitive color names', () => {
      expect(resolveColor('DARKKHAKI')).toBe('#bdb76b');
      expect(resolveColor('Coral')).toBe('#ff7f50');
      expect(resolveColor('TEAL')).toBe('#008080');
    });

    it('should return undefined for invalid colors', () => {
      expect(resolveColor('invalidcolor')).toBeUndefined();
      expect(resolveColor('notacolor')).toBeUndefined();
      expect(resolveColor('')).toBeUndefined();
    });
  });

  describe('CSS_NAME_TO_HEX_MAP', () => {
    it('should contain expected CSS color mappings', () => {
      expect(CSS_NAME_TO_HEX_MAP.darkkhaki).toBe('#bdb76b');
      expect(CSS_NAME_TO_HEX_MAP.coral).toBe('#ff7f50');
      expect(CSS_NAME_TO_HEX_MAP.teal).toBe('#008080');
      expect(CSS_NAME_TO_HEX_MAP.tomato).toBe('#ff6347');
      expect(CSS_NAME_TO_HEX_MAP.turquoise).toBe('#40e0d0');
    });

    it('should not contain Ink-supported color names', () => {
      expect(CSS_NAME_TO_HEX_MAP.black).toBeUndefined();
      expect(CSS_NAME_TO_HEX_MAP.red).toBeUndefined();
      expect(CSS_NAME_TO_HEX_MAP.green).toBeUndefined();
      expect(CSS_NAME_TO_HEX_MAP.blue).toBeUndefined();
    });
  });

  describe('INK_SUPPORTED_NAMES', () => {
    it('should contain all Ink-supported color names', () => {
      expect(INK_SUPPORTED_NAMES.has('black')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('red')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('green')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('yellow')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('blue')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('cyan')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('magenta')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('white')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('gray')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('grey')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('blackbright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('redbright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('greenbright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('yellowbright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('bluebright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('cyanbright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('magentabright')).toBe(true);
      expect(INK_SUPPORTED_NAMES.has('whitebright')).toBe(true);
    });

    it('should not contain CSS color names', () => {
      expect(INK_SUPPORTED_NAMES.has('darkkhaki')).toBe(false);
      expect(INK_SUPPORTED_NAMES.has('coral')).toBe(false);
      expect(INK_SUPPORTED_NAMES.has('teal')).toBe(false);
    });
  });

  describe('Consistency between validation and resolution', () => {
    it('should have consistent behavior between isValidColor and resolveColor', () => {
      // Test that any color that isValidColor returns true for can be resolved
      const testColors = [
        '#ff0000',
        '#00ff00',
        '#0000ff',
        '#fff',
        '#000',
        'black',
        'red',
        'green',
        'yellow',
        'blue',
        'cyan',
        'magenta',
        'white',
        'gray',
        'grey',
        'darkkhaki',
        'coral',
        'teal',
        'tomato',
        'turquoise',
        'violet',
        'wheat',
        'whitesmoke',
        'yellowgreen',
      ];

      for (const color of testColors) {
        expect(isValidColor(color)).toBe(true);
        expect(resolveColor(color)).toBeDefined();
      }

      // Test that invalid colors are consistently rejected
      const invalidColors = [
        'invalidcolor',
        'notacolor',
        '',
        '#gg0000',
        '#ff00',
      ];

      for (const color of invalidColors) {
        expect(isValidColor(color)).toBe(false);
        expect(resolveColor(color)).toBeUndefined();
      }
    });
  });

  describe('interpolateColor', () => {
    it('should interpolate between two colors', () => {
      // Midpoint between black (#000000) and white (#ffffff) should be gray
      expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#7f7f7f');
    });

    it('should return start color when factor is 0', () => {
      expect(interpolateColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    });

    it('should return end color when factor is 1', () => {
      expect(interpolateColor('#ff0000', '#0000ff', 1)).toBe('#0000ff');
    });

    it('should return start color when factor is < 0', () => {
      expect(interpolateColor('#ff0000', '#0000ff', -0.5)).toBe('#ff0000');
    });

    it('should return end color when factor is > 1', () => {
      expect(interpolateColor('#ff0000', '#0000ff', 1.5)).toBe('#0000ff');
    });

    it('should return valid color if one is empty but factor selects the valid one', () => {
      expect(interpolateColor('', '#ffffff', 1)).toBe('#ffffff');
      expect(interpolateColor('#ffffff', '', 0)).toBe('#ffffff');
    });

    it('should return empty string if either color is empty and factor does not select the valid one', () => {
      expect(interpolateColor('', '#ffffff', 0.5)).toBe('');
      expect(interpolateColor('#ffffff', '', 0.5)).toBe('');
      expect(interpolateColor('', '', 0.5)).toBe('');
      expect(interpolateColor('', '#ffffff', 0)).toBe('');
      expect(interpolateColor('#ffffff', '', 1)).toBe('');
    });
  });

  describe('getThemeTypeFromBackgroundColor', () => {
    describe('luminance calculation', () => {
      it('should return "dark" for pure black (#000000)', () => {
        expect(getThemeTypeFromBackgroundColor('#000000')).toBe('dark');
      });

      it('should return "light" for pure white (#FFFFFF)', () => {
        expect(getThemeTypeFromBackgroundColor('#FFFFFF')).toBe('light');
      });

      it('should return "dark" for dark gray (#1E1E2E)', () => {
        expect(getThemeTypeFromBackgroundColor('#1E1E2E')).toBe('dark');
      });

      it('should return "light" for light gray (#E0E0E0)', () => {
        expect(getThemeTypeFromBackgroundColor('#E0E0E0')).toBe('light');
      });

      it('should handle lowercase hex colors', () => {
        expect(getThemeTypeFromBackgroundColor('#ffffff')).toBe('light');
        expect(getThemeTypeFromBackgroundColor('#000000')).toBe('dark');
      });

      it('should return undefined for undefined input', () => {
        expect(getThemeTypeFromBackgroundColor(undefined)).toBeUndefined();
      });

      it('should return undefined for invalid hex (wrong length)', () => {
        expect(getThemeTypeFromBackgroundColor('#FFF')).toBeUndefined();
        expect(getThemeTypeFromBackgroundColor('#FFFFFFF')).toBeUndefined();
      });

      it('should return undefined for non-hex color', () => {
        expect(
          getThemeTypeFromBackgroundColor('rgb(255,255,255)'),
        ).toBeUndefined();
      });

      it('should handle colors without # prefix', () => {
        expect(getThemeTypeFromBackgroundColor('000000')).toBe('dark');
        expect(getThemeTypeFromBackgroundColor('FFFFFF')).toBe('light');
      });
    });

    describe('sRGB to linear conversion', () => {
      it('should correctly handle mid-range gray (#808080)', () => {
        // #808080 has luminance ~0.22, should be dark
        expect(getThemeTypeFromBackgroundColor('#808080')).toBe('dark');
      });

      it('should correctly handle near-threshold colors', () => {
        // Luminance threshold is 0.5
        // #BCBCBC has luminance ~0.506, should be light
        expect(getThemeTypeFromBackgroundColor('#BCBCBC')).toBe('light');
        // #BABABA has luminance ~0.495, should be dark
        expect(getThemeTypeFromBackgroundColor('#BABABA')).toBe('dark');
      });
    });
  });

  describe('detectTerminalBackgroundColor', () => {
    let mockStdin: {
      isTTY: boolean;
      setRawMode: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      removeListener: ReturnType<typeof vi.fn>;
    };
    let mockStdout: {
      write: ReturnType<typeof vi.fn>;
      isTTY: boolean;
    };
    let originalStdin: typeof process.stdin;
    let originalStdout: typeof process.stdout;

    beforeEach(() => {
      // Save original process.stdin/stdout
      originalStdin = process.stdin;
      originalStdout = process.stdout;

      // Create mock stdin
      mockStdin = {
        isTTY: true,
        setRawMode: vi.fn(),
        on: vi.fn(),
        removeListener: vi.fn(),
      };

      // Create mock stdout
      mockStdout = {
        write: vi.fn(),
        isTTY: true,
      };

      // Replace process.stdin/stdout with mocks
      Object.defineProperty(process, 'stdin', {
        value: mockStdin,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: mockStdout,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Restore original process.stdin/stdout
      Object.defineProperty(process, 'stdin', {
        value: originalStdin,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(process, 'stdout', {
        value: originalStdout,
        writable: true,
        configurable: true,
      });
      vi.clearAllTimers();
    });

    it('should return undefined when stdin is not a TTY', async () => {
      mockStdin.isTTY = false;
      const result = await detectTerminalBackgroundColor();
      expect(result).toBeUndefined();
    });

    it('should return undefined on timeout (no response from terminal)', async () => {
      vi.useFakeTimers();
      const promise = detectTerminalBackgroundColor();

      // Fast-forward past the 100ms timeout
      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result).toBeUndefined();
      vi.useRealTimers();
    });

    it('should parse OSC 11 response with ST terminator (ESC backslash)', async () => {
      const promise = detectTerminalBackgroundColor();

      // Simulate OSC 11 response with ST terminator
      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];
      dataHandler(Buffer.from('\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\'));

      const result = await promise;
      expect(result).toBe('#1E1E2E');
    });

    it('should parse OSC 11 response with BEL terminator', async () => {
      const promise = detectTerminalBackgroundColor();

      // Simulate OSC 11 response with BEL terminator
      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];
      dataHandler(Buffer.from('\x1b]11;rgb:ffff/ffff/ffff\x07'));

      const result = await promise;
      expect(result).toBe('#FFFFFF');
    });

    it('should handle split chunks (data arrives in multiple events)', async () => {
      const promise = detectTerminalBackgroundColor();

      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];

      // Send response in 3 chunks
      dataHandler(Buffer.from('\x1b]11;rgb:'));
      dataHandler(Buffer.from('0000/0000/'));
      dataHandler(Buffer.from('0000\x1b\\'));

      const result = await promise;
      expect(result).toBe('#000000');
    });

    it('should handle malformed response (invalid format)', async () => {
      vi.useFakeTimers();
      const promise = detectTerminalBackgroundColor();

      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];
      dataHandler(Buffer.from('garbage data'));

      // Timeout since we never got valid response
      vi.advanceTimersByTime(100);

      const result = await promise;
      expect(result).toBeUndefined();
      vi.useRealTimers();
    });

    it('should send OSC 11 query to stdout', async () => {
      const promise = detectTerminalBackgroundColor();

      // Provide a valid response to complete the promise
      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];
      dataHandler(Buffer.from('\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\'));

      await promise;

      expect(mockStdout.write).toHaveBeenCalledWith('\x1b]11;?\x1b\\');
    });

    it('should cleanup stdin listeners after successful detection', async () => {
      const promise = detectTerminalBackgroundColor();

      const dataCall = mockStdin.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      );
      expect(dataCall).toBeDefined();
      const dataHandler = dataCall![1];
      dataHandler(Buffer.from('\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\'));

      await promise;

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      expect(mockStdin.removeListener).toHaveBeenCalledWith(
        'data',
        dataHandler,
      );
    });

    it('should cleanup stdin listeners after timeout', async () => {
      vi.useFakeTimers();
      const promise = detectTerminalBackgroundColor();

      vi.advanceTimersByTime(100);
      await promise;

      expect(mockStdin.setRawMode).toHaveBeenCalledWith(false);
      vi.useRealTimers();
    });
  });
});
