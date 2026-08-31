/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import type { Key } from '../hooks/useKeypress.js';
import {
  expandLargePastePlaceholders,
  handleLargePaste,
} from './inputPromptText.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { useTextBuffer } from './shared/text-buffer.js';

const viewport = { width: 80, height: 24 } as const;

function renderTextBuffer(
  initialText = '',
  initialCursorOffset = 0,
): ReturnType<typeof renderHook<TextBuffer>> {
  return renderHook(() =>
    useTextBuffer({
      initialText,
      initialCursorOffset,
      viewport,
      isValidPath: () => false,
    }),
  );
}

function pasteKey(sequence: string): Key {
  return {
    name: 'paste',
    ctrl: false,
    meta: false,
    shift: false,
    sequence,
  };
}

function getOnlyPlaceholder(
  pendingPastes: ReadonlyMap<string, string>,
): string {
  const labels = [...pendingPastes.keys()];
  expect(labels).toHaveLength(1);
  return labels[0];
}

describe('handleLargePaste', () => {
  it('replaces a four-line paste at the cursor with one tracked placeholder', () => {
    const textBefore = 'prefix ';
    const textAfter = ' suffix';
    const pastedText = 'alpha\r\nbeta\r\ngamma\r\ndelta';
    const sanitizedPaste = pastedText.replace(/\r\n?/g, '\n');
    const nextPlaceholderIdRef = { current: 1 };
    const pendingLargePastesRef = { current: new Map<string, string>() };
    const { result, unmount } = renderTextBuffer(
      textBefore + textAfter,
      textBefore.length,
    );

    act(() => {
      handleLargePaste(
        pasteKey(pastedText),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    const placeholder = getOnlyPlaceholder(pendingLargePastesRef.current);
    expect(result.current.text).toBe(textBefore + placeholder + textAfter);
    expect(result.current.text).not.toContain(sanitizedPaste);
    expect(result.current.getOffset()).toBe(
      textBefore.length + placeholder.length,
    );
    expect(pendingLargePastesRef.current.get(placeholder)).toBe(sanitizedPaste);
    unmount();
  });

  it('uses a placeholder for a single-line paste at the character threshold', () => {
    const pastedText = 'x'.repeat(1000);
    const nextPlaceholderIdRef = { current: 1 };
    const pendingLargePastesRef = { current: new Map<string, string>() };
    const { result, unmount } = renderTextBuffer();

    act(() => {
      handleLargePaste(
        pasteKey(pastedText),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    const placeholder = getOnlyPlaceholder(pendingLargePastesRef.current);
    expect(result.current.text).toBe(placeholder);
    expect(result.current.text).not.toContain(pastedText);
    expect(result.current.getOffset()).toBe(placeholder.length);
    unmount();
  });

  it('inserts exactly three short lines without creating a placeholder', () => {
    const textBefore = 'left:';
    const textAfter = ':right';
    const pastedText = 'one\ntwo\nthree';
    const nextPlaceholderIdRef = { current: 1 };
    const pendingLargePastesRef = { current: new Map<string, string>() };
    const { result, unmount } = renderTextBuffer(
      textBefore + textAfter,
      textBefore.length,
    );

    act(() => {
      handleLargePaste(
        pasteKey(pastedText),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    expect(result.current.text).toBe(textBefore + pastedText + textAfter);
    expect(pendingLargePastesRef.current.size).toBe(0);
    unmount();
  });

  it('expands distinct placeholders back to both pasted bodies in order', () => {
    const textBefore = 'before:';
    const textAfter = ':after';
    const firstPaste = 'first\nlarge\npaste\nbody';
    const secondPaste = 'z'.repeat(1001);
    const nextPlaceholderIdRef = { current: 1 };
    const pendingLargePastesRef = { current: new Map<string, string>() };
    const { result, unmount } = renderTextBuffer(
      textBefore + textAfter,
      textBefore.length,
    );

    act(() => {
      handleLargePaste(
        pasteKey(firstPaste),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    const firstPlaceholder = getOnlyPlaceholder(pendingLargePastesRef.current);
    expect(
      expandLargePastePlaceholders(
        result.current.text,
        pendingLargePastesRef.current,
      ),
    ).toBe(textBefore + firstPaste + textAfter);

    act(() => {
      handleLargePaste(
        pasteKey(secondPaste),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    const placeholders = [...pendingLargePastesRef.current.keys()];
    expect(placeholders).toHaveLength(2);
    const secondPlaceholder = placeholders.find(
      (placeholder) => placeholder !== firstPlaceholder,
    );
    assertDefined(
      secondPlaceholder,
      'Expected a distinct second large-paste placeholder',
    );
    expect(secondPlaceholder).not.toBe(firstPlaceholder);
    expect(result.current.text).toBe(
      textBefore + firstPlaceholder + secondPlaceholder + textAfter,
    );
    expect(
      expandLargePastePlaceholders(
        result.current.text,
        pendingLargePastesRef.current,
      ),
    ).toBe(textBefore + firstPaste + secondPaste + textAfter);
    unmount();
  });

  it('normalizes CRLF and bare carriage returns in a short paste', () => {
    const textBefore = 'left:';
    const textAfter = ':right';
    const pastedText = 'first\r\nsecond\rthird';
    const normalizedPaste = pastedText.replace(/\r\n?/g, '\n');
    const nextPlaceholderIdRef = { current: 1 };
    const pendingLargePastesRef = { current: new Map<string, string>() };
    const { result, unmount } = renderTextBuffer(
      textBefore + textAfter,
      textBefore.length,
    );

    act(() => {
      handleLargePaste(
        pasteKey(pastedText),
        result.current,
        nextPlaceholderIdRef,
        pendingLargePastesRef,
      );
    });

    expect(result.current.text).toBe(textBefore + normalizedPaste + textAfter);
    expect(result.current.text).not.toContain('\r');
    unmount();
  });
});

describe('expandLargePastePlaceholders', () => {
  it('leaves ordinary placeholder-like text unchanged without pending pastes', () => {
    const placeholderLikeText =
      'Keep [4 lines pasted #42] and [1000 characters pasted #9] as written.';

    const expanded = expandLargePastePlaceholders(
      placeholderLikeText,
      new Map(),
    );

    expect(expanded).toBe(placeholderLikeText);
  });
});
