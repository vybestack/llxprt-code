/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../__tests__/render.js';
import type { Key } from '../hooks/useKeypress.js';
import {
  expandLargePastePlaceholders,
  handleLargePaste,
} from './inputPromptText.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { useTextBuffer } from './shared/text-buffer.js';

let unmountBuffer: (() => void) | undefined;

function pasteKey(sequence: string): Key {
  return { name: 'paste', ctrl: false, meta: false, shift: false, sequence };
}

function renderPasteBuffer(
  initialText = '',
  initialCursorOffset = 0,
): {
  result: { current: TextBuffer };
  pendingPastes: { current: Map<string, string> };
  paste: (sequence: string) => void;
  expand: () => string;
} {
  const { result, unmount } = renderHook(() =>
    useTextBuffer({
      initialText,
      initialCursorOffset,
      viewport: { width: 80, height: 24 },
      isValidPath: () => false,
    }),
  );
  unmountBuffer = unmount;
  const nextPlaceholderId = { current: 1 };
  const pendingPastes = { current: new Map<string, string>() };
  return {
    result,
    pendingPastes,
    paste: (sequence): void => {
      act(() => {
        handleLargePaste(
          pasteKey(sequence),
          result.current,
          nextPlaceholderId,
          pendingPastes,
        );
      });
    },
    expand: (): string =>
      expandLargePastePlaceholders(result.current.text, pendingPastes.current),
  };
}

describe('input prompt paste', () => {
  afterEach(() => {
    unmountBuffer?.();
    unmountBuffer = undefined;
  });

  describe('paste content sanitization', () => {
    it.each([0, 1000])(
      'removes unsafe controls while preserving Unicode, tabs and newlines with %i padding characters',
      (paddingLength) => {
        const padding = 'x'.repeat(paddingLength);
        const pasted =
          '\u001b[31mcafé😀\u001b[0m\t漢字\u0000\u0007\u0008\u000b\u000c\u0080\u009f\r\nnext\rlast' +
          padding;
        const expected = 'café😀\t漢字\nnext\nlast' + padding;
        const buffer = renderPasteBuffer('before:after', 7);

        buffer.paste(pasted);

        expect(buffer.expand()).toBe('before:' + expected + 'after');
        expect([...buffer.pendingPastes.current.values()]).toStrictEqual(
          paddingLength === 0 ? [] : [expected],
        );
      },
    );

    it.each([999, 1000])(
      'uses sanitized codepoint length at the %i-character boundary',
      (characterCount) => {
        const content = '😀'.repeat(characterCount);
        const buffer = renderPasteBuffer();

        buffer.paste('\u001b[32m' + content + '\u001b[0m\u0007');

        expect(buffer.expand()).toBe(content);
        expect(buffer.pendingPastes.current.size).toBe(
          characterCount === 1000 ? 1 : 0,
        );
        expect(buffer.result.current.text).toBe(
          characterCount === 1000 ? '[1000 characters pasted #1]' : content,
        );
      },
    );

    it.each([3, 4])(
      'uses normalized line count at the %i-line boundary',
      (lineCount) => {
        const lines = Array.from({ length: lineCount }, () => 'é\t😀');
        const buffer = renderPasteBuffer();

        buffer.paste('\u001b[31m' + lines.join('\r\n') + '\u001b[0m');

        expect(buffer.expand()).toBe(lines.join('\n'));
        expect(buffer.pendingPastes.current.size).toBe(lineCount === 4 ? 1 : 0);
      },
    );

    it('does not create a placeholder when removing controls leaves an empty paste', () => {
      const buffer = renderPasteBuffer('keep', 2);

      buffer.paste('\u0000'.repeat(1000));

      expect(buffer.result.current.text).toBe('keep');
      expect(buffer.result.current.cursor).toStrictEqual([0, 2]);
      expect(buffer.pendingPastes.current.size).toBe(0);
    });
  });

  describe('large paste insertion and caret', () => {
    it.each([
      { prefix: '😀', suffix: 'ab' },
      { prefix: 'head😀\n中😀', suffix: 'tail\nend' },
      { prefix: 'first😀\nsecond\n', suffix: 'tail😀' },
    ])(
      'preserves the prefix $prefix and places subsequent typing before the suffix',
      ({ prefix, suffix }) => {
        const pasted = 'one\ntwo\nthree\nfour';
        const placeholder = '[4 lines pasted #1]';
        const buffer = renderPasteBuffer(prefix + suffix, [...prefix].length);

        buffer.paste(pasted);

        expect(buffer.result.current.text).toBe(prefix + placeholder + suffix);
        expect(buffer.expand()).toBe(prefix + pasted + suffix);
        expect(buffer.result.current.getOffset()).toBe(
          [...(prefix + placeholder)].length,
        );
        const prefixLines = prefix.split('\n');
        expect(buffer.result.current.cursor).toStrictEqual([
          prefixLines.length - 1,
          [...(prefixLines.at(-1) ?? '')].length + placeholder.length,
        ]);

        act(() => {
          buffer.result.current.handleInput({
            ...pasteKey('Ω'),
            name: 'Ω',
            insertable: true,
          });
        });

        expect(buffer.expand()).toBe(prefix + pasted + 'Ω' + suffix);
      },
    );
  });
});
