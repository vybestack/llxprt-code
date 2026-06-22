/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../../test-utils/render.js';
import type { TextBuffer, Viewport } from './text-buffer.js';
import {
  useTextBuffer,
  offsetToLogicalPos,
  logicalPosToOffset,
} from './text-buffer.js';
import {
  getTransformedImagePath,
  calculateTransformationsForLine,
  getTransformUnderCursor,
  calculateTransformedLine,
} from './transformations.js';

const getVisualLayout = (buffer: TextBuffer): unknown =>
  (buffer as TextBuffer & { visualLayout: unknown }).visualLayout;

describe('useTextBuffer CJK Navigation', () => {
  const viewport = { width: 80, height: 24 };

  it('should navigate by word in Chinese', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: '你好世界',
        initialCursorOffset: 4, // End of string
        viewport,
        isValidPath: () => false,
      }),
    );

    // Initial state: cursor at end (index 2 in code points if 4 is length? wait. length is 2 code points? No. '你好世界' length is 4.)
    // '你好世界' length is 4. Code points length is 4.

    // Move word left
    act(() => {
      result.current.move('wordLeft');
    });

    // Should be at start of "世界" (index 2)
    // "你好世界" -> "你好" | "世界"
    expect(result.current.cursor[1]).toBe(2);

    // Move word left again
    act(() => {
      result.current.move('wordLeft');
    });

    // Should be at start of "你好" (index 0)
    expect(result.current.cursor[1]).toBe(0);

    // Move word left again (should stay at 0)
    act(() => {
      result.current.move('wordLeft');
    });
    expect(result.current.cursor[1]).toBe(0);

    // Move word right
    act(() => {
      result.current.move('wordRight');
    });

    // Should be at end of "你好" (index 2)
    expect(result.current.cursor[1]).toBe(2);

    // Move word right again
    act(() => {
      result.current.move('wordRight');
    });

    // Should be at end of "世界" (index 4)
    expect(result.current.cursor[1]).toBe(4);

    // Move word right again (should stay at end)
    act(() => {
      result.current.move('wordRight');
    });
    expect(result.current.cursor[1]).toBe(4);
  });

  it('should navigate mixed English and Chinese', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: 'Hello你好World',
        initialCursorOffset: 10, // End
        viewport,
        isValidPath: () => false,
      }),
    );

    // Hello (5) + 你好 (2) + World (5) = 12 chars.
    // initialCursorOffset 10? 'Hello你好World'.length is 12.
    // Let's set it to end.

    act(() => {
      result.current.move('end');
    });
    expect(result.current.cursor[1]).toBe(12);

    // wordLeft -> start of "World" (index 7)
    act(() => result.current.move('wordLeft'));
    expect(result.current.cursor[1]).toBe(7);

    // wordLeft -> start of "你好" (index 5)
    act(() => result.current.move('wordLeft'));
    expect(result.current.cursor[1]).toBe(5);

    // wordLeft -> start of "Hello" (index 0)
    act(() => result.current.move('wordLeft'));
    expect(result.current.cursor[1]).toBe(0);

    // wordLeft -> start of line (should stay at 0)
    act(() => result.current.move('wordLeft'));
    expect(result.current.cursor[1]).toBe(0);
  });
});

describe('getTransformedImagePath', () => {
  it('should transform a simple image path', () => {
    expect(getTransformedImagePath('@test.png')).toBe('[Image test.png]');
  });

  it('should handle paths with directories', () => {
    expect(getTransformedImagePath('@path/to/image.jpg')).toBe(
      '[Image image.jpg]',
    );
  });

  it('should truncate long filenames', () => {
    expect(getTransformedImagePath('@verylongfilename1234567890.png')).toBe(
      '[Image ...1234567890.png]',
    );
  });

  it('should handle different image extensions', () => {
    expect(getTransformedImagePath('@test.jpg')).toBe('[Image test.jpg]');
    expect(getTransformedImagePath('@test.jpeg')).toBe('[Image test.jpeg]');
    expect(getTransformedImagePath('@test.gif')).toBe('[Image test.gif]');
    expect(getTransformedImagePath('@test.webp')).toBe('[Image test.webp]');
    expect(getTransformedImagePath('@test.svg')).toBe('[Image test.svg]');
    expect(getTransformedImagePath('@test.bmp')).toBe('[Image test.bmp]');
  });

  it('should handle POSIX-style forward-slash paths on any platform', () => {
    const input = '@C:/Users/foo/screenshots/image2x.png';
    expect(getTransformedImagePath(input)).toBe('[Image image2x.png]');
  });

  it('should handle Windows-style backslash paths on any platform', () => {
    const input = '@C:\\Users\\foo\\screenshots\\image2x.png';
    expect(getTransformedImagePath(input)).toBe('[Image image2x.png]');
  });

  it('should handle escaped spaces in paths', () => {
    const input = '@path/to/my\\ file.png';
    expect(getTransformedImagePath(input)).toBe('[Image my file.png]');
  });
});

describe('getTransformationsForLine', () => {
  it('should find transformations in a line', () => {
    const line = 'Check out @test.png and @another.jpg';
    const result = calculateTransformationsForLine(line);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      logicalText: '@test.png',
      collapsedText: '[Image test.png]',
    });
    expect(result[1]).toMatchObject({
      logicalText: '@another.jpg',
      collapsedText: '[Image another.jpg]',
    });
  });

  it('should handle no transformations', () => {
    const line = 'Just some regular text';
    const result = calculateTransformationsForLine(line);
    expect(result).toStrictEqual([]);
  });

  it('should handle empty line', () => {
    const result = calculateTransformationsForLine('');
    expect(result).toStrictEqual([]);
  });

  it('should keep adjacent image paths as separate transformations', () => {
    const line = '@a.png@b.png@c.png';
    const result = calculateTransformationsForLine(line);
    expect(result).toHaveLength(3);
    expect(result[0].logicalText).toBe('@a.png');
    expect(result[1].logicalText).toBe('@b.png');
    expect(result[2].logicalText).toBe('@c.png');
  });

  it('should handle multiple transformations in a row', () => {
    const line = '@a.png @b.png @c.png';
    const result = calculateTransformationsForLine(line);
    expect(result).toHaveLength(3);
  });
});

describe('getTransformUnderCursor', () => {
  const transformations = [
    {
      logStart: 5,
      logEnd: 14,
      logicalText: '@test.png',
      collapsedText: '[Image @test.png]',
    },
    {
      logStart: 20,
      logEnd: 31,
      logicalText: '@another.jpg',
      collapsedText: '[Image @another.jpg]',
    },
  ];

  it('should find transformation when cursor is inside it', () => {
    const result = getTransformUnderCursor(0, 7, [transformations]);
    expect(result).toStrictEqual(transformations[0]);
  });

  it('should find transformation when cursor is at start', () => {
    const result = getTransformUnderCursor(0, 5, [transformations]);
    expect(result).toStrictEqual(transformations[0]);
  });

  it('should find transformation when cursor is at end', () => {
    const result = getTransformUnderCursor(0, 14, [transformations]);
    expect(result).toStrictEqual(transformations[0]);
  });

  it('should return null when cursor is not on a transformation', () => {
    const result = getTransformUnderCursor(0, 2, [transformations]);
    expect(result).toBeNull();
  });

  it('should handle empty transformations array', () => {
    const result = getTransformUnderCursor(0, 5, []);
    expect(result).toBeNull();
  });
});

describe('calculateTransformedLine', () => {
  it('should transform a line with one transformation', () => {
    const line = 'Check out @test.png';
    const transformations = calculateTransformationsForLine(line);
    const result = calculateTransformedLine(line, 0, [0, 0], transformations);

    expect(result.transformedLine).toBe('Check out [Image test.png]');
    expect(result.transformedToLogMap).toHaveLength(27); // Length includes all characters in the transformed line

    // Test that we have proper mappings
    expect(result.transformedToLogMap[0]).toBe(0); // 'C'
    expect(result.transformedToLogMap[9]).toBe(9); // ' ' before transformation
  });

  it('should handle cursor inside transformation', () => {
    const line = 'Check out @test.png';
    const transformations = calculateTransformationsForLine(line);
    // Cursor at '@' (position 10 in the line)
    const result = calculateTransformedLine(line, 0, [0, 10], transformations);

    // Should show full path when cursor is on it
    expect(result.transformedLine).toBe('Check out @test.png');
    // When expanded, each character maps to itself
    expect(result.transformedToLogMap[10]).toBe(10); // '@'
  });

  it('should handle line with no transformations', () => {
    const line = 'Just some text';
    const result = calculateTransformedLine(line, 0, [0, 0], []);

    expect(result.transformedLine).toBe(line);
    // Each visual position should map directly to logical position + trailing
    expect(result.transformedToLogMap).toHaveLength(15); // 14 chars + 1 trailing
    expect(result.transformedToLogMap[0]).toBe(0);
    expect(result.transformedToLogMap[13]).toBe(13);
    expect(result.transformedToLogMap[14]).toBe(14); // Trailing position
  });

  it('should handle empty line', () => {
    const result = calculateTransformedLine('', 0, [0, 0], []);
    expect(result.transformedLine).toBe('');
    expect(result.transformedToLogMap).toStrictEqual([0]); // Just the trailing position
  });
});

describe('Layout Caching and Invalidation', () => {
  it.each([
    {
      desc: 'via setText',
      actFn: (result: { current: TextBuffer }) =>
        result.current.setText('changed line'),
      expected: 'changed line',
    },
    {
      desc: 'via replaceRange',
      actFn: (result: { current: TextBuffer }) =>
        result.current.replaceRange(0, 0, 0, 13, 'changed line'),
      expected: 'changed line',
    },
  ])(
    'should invalidate cache when line content changes $desc',
    ({ actFn, expected }) => {
      const viewport = { width: 80, height: 24 };
      const { result } = renderHook(() =>
        useTextBuffer({
          initialText: 'original line',
          viewport,
          isValidPath: () => true,
        }),
      );

      const originalLayout = getVisualLayout(result.current);

      act(() => {
        actFn(result);
      });

      expect(getVisualLayout(result.current)).not.toBe(originalLayout);
      expect(result.current.allVisualLines[0]).toBe(expected);
    },
  );

  it('should invalidate cache when viewport width changes', () => {
    const viewport = { width: 80, height: 24 };
    const { result, rerender } = renderHook(
      ({ vp }: { vp: Viewport }) =>
        useTextBuffer({
          initialText:
            'a very long line that will wrap when the viewport is small',
          viewport: vp,
          isValidPath: () => true,
        }),
      { initialProps: { vp: viewport } },
    );

    const originalLayout = result.current.allVisualLines;

    // Shrink viewport to force wrapping change
    rerender({ vp: { width: 10, height: 24 } });

    expect(result.current.allVisualLines).not.toBe(originalLayout);
    expect(result.current.allVisualLines.length).toBeGreaterThan(1);
  });

  it('should correctly handle cursor expansion/collapse in cached layout', () => {
    const viewport = { width: 80, height: 24 };
    const text = 'Check @image.png here';
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText: text,
        viewport,
        isValidPath: () => true,
      }),
    );

    // Cursor at start (collapsed)
    act(() => {
      result.current.moveToOffset(0);
    });
    expect(result.current.allVisualLines[0]).toContain('[Image image.png]');

    // Move cursor onto the @path (expanded)
    act(() => {
      result.current.moveToOffset(7); // onto @
    });
    expect(result.current.allVisualLines[0]).toContain('@image.png');
    expect(result.current.allVisualLines[0]).not.toContain('[Image image.png]');

    // Move cursor away (collapsed again)
    act(() => {
      result.current.moveToOffset(0);
    });
    expect(result.current.allVisualLines[0]).toContain('[Image image.png]');
  });

  it('should reuse cache for unchanged lines during editing', () => {
    const viewport = { width: 80, height: 24 };
    const initialText = 'line 1\nline 2\nline 3';
    const { result } = renderHook(() =>
      useTextBuffer({
        initialText,
        viewport,
        isValidPath: () => true,
      }),
    );

    const layout1 = getVisualLayout(result.current);

    // Edit line 1
    act(() => {
      result.current.moveToOffset(0);
      result.current.insert('X');
    });

    const layout2 = getVisualLayout(result.current);
    expect(layout2).not.toBe(layout1);

    // Verify that visual lines for line 2 and 3 (indices 1 and 2 in visualLines)
    // are identical in content if not in object reference (the arrays are rebuilt, but contents are cached)
    expect(result.current.allVisualLines[1]).toBe('line 2');
    expect(result.current.allVisualLines[2]).toBe('line 3');
  });
});

describe('logicalPosToOffset', () => {
  it('should convert row/col position to offset correctly', () => {
    const lines = ['hello', 'world', '123'];

    // Line 0: "hello" (5 chars)
    expect(logicalPosToOffset(lines, 0, 0)).toBe(0); // Start of 'hello'
    expect(logicalPosToOffset(lines, 0, 3)).toBe(3); // 'l' in 'hello'
    expect(logicalPosToOffset(lines, 0, 5)).toBe(5); // End of 'hello'

    // Line 1: "world" (5 chars), offset starts at 6 (5 + 1 for newline)
    expect(logicalPosToOffset(lines, 1, 0)).toBe(6); // Start of 'world'
    expect(logicalPosToOffset(lines, 1, 2)).toBe(8); // 'r' in 'world'
    expect(logicalPosToOffset(lines, 1, 5)).toBe(11); // End of 'world'

    // Line 2: "123" (3 chars), offset starts at 12 (5 + 1 + 5 + 1)
    expect(logicalPosToOffset(lines, 2, 0)).toBe(12); // Start of '123'
    expect(logicalPosToOffset(lines, 2, 1)).toBe(13); // '2' in '123'
    expect(logicalPosToOffset(lines, 2, 3)).toBe(15); // End of '123'
  });

  it('should handle empty lines', () => {
    const lines = ['a', '', 'c'];

    expect(logicalPosToOffset(lines, 0, 0)).toBe(0); // 'a'
    expect(logicalPosToOffset(lines, 0, 1)).toBe(1); // End of 'a'
    expect(logicalPosToOffset(lines, 1, 0)).toBe(2); // Empty line
    expect(logicalPosToOffset(lines, 2, 0)).toBe(3); // 'c'
    expect(logicalPosToOffset(lines, 2, 1)).toBe(4); // End of 'c'
  });

  it('should handle single empty line', () => {
    const lines = [''];

    expect(logicalPosToOffset(lines, 0, 0)).toBe(0);
  });

  it('should be inverse of offsetToLogicalPos', () => {
    const lines = ['hello', 'world', '123'];
    const text = lines.join('\n');

    // Test round-trip conversion
    for (let offset = 0; offset <= text.length; offset++) {
      const [row, col] = offsetToLogicalPos(text, offset);
      const convertedOffset = logicalPosToOffset(lines, row, col);
      expect(convertedOffset).toBe(offset);
    }
  });

  it('should handle out-of-bounds positions', () => {
    const lines = ['hello'];

    // Beyond end of line
    expect(logicalPosToOffset(lines, 0, 10)).toBe(5); // Clamps to end of line

    // Beyond array bounds - should clamp to the last line
    expect(logicalPosToOffset(lines, 5, 0)).toBe(0); // Clamps to start of last line (row 0)
    expect(logicalPosToOffset(lines, 5, 10)).toBe(5); // Clamps to end of last line
  });
});
