/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it, vi } from 'bun:test';
import { renderHook } from '../../../../test-utils/render.js';
import { StreamingState } from '../../../types.js';
import { useSteer } from './useSteer.js';

describe('useSteer', () => {
  it('injects sanitized text while streaming with a tool executing', () => {
    const injectSteer = vi.fn();
    const sanitizeContent = vi.fn(() => ({
      text: 'sanitized steer',
      blocked: false,
    }));
    const { result } = renderHook(() =>
      useSteer({ injectSteer }, StreamingState.Responding, sanitizeContent),
    );

    let consumed = false;
    act(() => {
      consumed = result.current('raw steer');
    });

    expect(consumed).toBe(true);
    expect(sanitizeContent).toHaveBeenCalledWith('raw steer');
    expect(injectSteer).toHaveBeenCalledWith('sanitized steer');
  });

  it('injects sanitized text while streaming without a tool executing', () => {
    const injectSteer = vi.fn();
    const { result } = renderHook(() =>
      useSteer({ injectSteer }, StreamingState.Responding, () => ({
        text: 'steer text',
        blocked: false,
      })),
    );

    let consumed = false;
    act(() => {
      consumed = result.current('steer text');
    });

    expect(consumed).toBe(true);
    expect(injectSteer).toHaveBeenCalledWith('steer text');
  });

  it('does not consume Ctrl+Enter outside an active response', () => {
    const injectSteer = vi.fn();
    const sanitizeContent = vi.fn();
    const { result } = renderHook(() =>
      useSteer({ injectSteer }, StreamingState.Idle, sanitizeContent),
    );

    expect(result.current('newline')).toBe(false);
    expect(sanitizeContent).not.toHaveBeenCalled();
    expect(injectSteer).not.toHaveBeenCalled();
  });

  it('does not inject blocked content', () => {
    const injectSteer = vi.fn();
    const { result } = renderHook(() =>
      useSteer({ injectSteer }, StreamingState.Responding, () => ({
        text: '',
        blocked: true,
      })),
    );

    expect(result.current('blocked')).toBe(false);
    expect(injectSteer).not.toHaveBeenCalled();
  });

  it('does not crash when sanitization fails', () => {
    const injectSteer = vi.fn();
    const { result } = renderHook(() =>
      useSteer({ injectSteer }, StreamingState.Responding, () => {
        throw new Error('sanitizer failure');
      }),
    );

    expect(result.current('steer')).toBe(false);
    expect(injectSteer).not.toHaveBeenCalled();
  });
});
