/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CoreToolScheduler } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../test-utils/render.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useReactToolScheduler } from './useReactToolScheduler.js';

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    CoreToolScheduler: vi.fn(),
  };
});

const mockCoreToolScheduler = vi.mocked(CoreToolScheduler);

describe('useReactToolScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only creates one instance of CoreToolScheduler even if props change', () => {
    const onComplete = vi.fn();
    const getPreferredEditor = vi.fn();
    const config = {} as Config;

    const setPendingHistoryItem = vi.fn();
    const onEditorClose = vi.fn();
    const { rerender } = renderHook(
      (props) =>
        useReactToolScheduler(
          props.onComplete,
          props.config,
          props.setPendingHistoryItem,
          props.getPreferredEditor,
          props.onEditorClose,
        ),
      {
        initialProps: {
          onComplete,
          config,
          setPendingHistoryItem,
          getPreferredEditor,
          onEditorClose,
        },
      },
    );

    expect(mockCoreToolScheduler).toHaveBeenCalledTimes(1);

    // Rerender with a new onComplete function
    const newOnComplete = vi.fn();
    rerender({
      onComplete: newOnComplete,
      config,
      setPendingHistoryItem,
      getPreferredEditor,
      onEditorClose,
    });
    expect(mockCoreToolScheduler).toHaveBeenCalledTimes(1);

    // Rerender with a new getPreferredEditor function
    const newGetPreferredEditor = vi.fn();
    rerender({
      onComplete: newOnComplete,
      config,
      setPendingHistoryItem,
      getPreferredEditor: newGetPreferredEditor,
      onEditorClose,
    });
    expect(mockCoreToolScheduler).toHaveBeenCalledTimes(1);

    rerender({
      onComplete: newOnComplete,
      config,
      getPreferredEditor: newGetPreferredEditor,
    });
    expect(mockCoreToolScheduler).toHaveBeenCalledTimes(1);
  });
});
