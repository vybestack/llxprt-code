/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { renderHook } from '../test-utils/render.js';
import { useTextBuffer } from './components/shared/text-buffer.js';

describe('useTextBuffer IME input', () => {
  it('preserves every character when an IME commits characters in one batch', () => {
    const { result } = renderHook(() =>
      useTextBuffer({
        viewport: { width: 80, height: 24 },
        isValidPath: () => false,
      }),
    );
    const insert = result.current.insert;

    act(() => {
      for (const character of '你好世界') {
        insert(character);
      }
    });

    expect(result.current.text).toBe('你好世界');
    expect(result.current.cursor).toStrictEqual([0, 4]);
  });
});
