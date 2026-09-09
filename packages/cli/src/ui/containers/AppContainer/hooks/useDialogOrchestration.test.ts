/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect } from 'bun:test';
import { renderHook } from '../../../../test-utils/render.js';
import { useDialogOrchestration } from './useDialogOrchestration.js';

describe('useDialogOrchestration', () => {
  it('clears models dialog data when closed', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    act(() => {
      result.current.openModelsDialog({
        initialSearch: 'claude',
        includeDeprecated: true,
      });
    });

    expect(result.current.isModelsDialogOpen).toBe(true);
    expect(result.current.modelsDialogData).toStrictEqual({
      initialSearch: 'claude',
      includeDeprecated: true,
    });

    act(() => {
      result.current.closeModelsDialog();
    });

    expect(result.current.isModelsDialogOpen).toBe(false);
    expect(result.current.modelsDialogData).toBeUndefined();
  });

  it('opens and closes session browser dialog', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    expect(result.current.isSessionBrowserDialogOpen).toBe(false);

    act(() => {
      result.current.openSessionBrowserDialog();
    });

    expect(result.current.isSessionBrowserDialogOpen).toBe(true);

    act(() => {
      result.current.closeSessionBrowserDialog();
    });

    expect(result.current.isSessionBrowserDialogOpen).toBe(false);
  });

  it('opens and closes model config dialog', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    expect(result.current.isModelConfigDialogOpen).toBe(false);

    act(() => {
      result.current.openModelConfigDialog();
    });

    expect(result.current.isModelConfigDialogOpen).toBe(true);

    act(() => {
      result.current.closeModelConfigDialog();
    });

    expect(result.current.isModelConfigDialogOpen).toBe(false);
  });

  it('opens and closes policies dialog', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    expect(result.current.isPoliciesDialogOpen).toBe(false);

    act(() => {
      result.current.openPoliciesDialog();
    });

    expect(result.current.isPoliciesDialogOpen).toBe(true);

    act(() => {
      result.current.closePoliciesDialog();
    });

    expect(result.current.isPoliciesDialogOpen).toBe(false);
  });
});
