/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '../../../../test-utils/render.js';
import { SubagentView } from '../../../components/SubagentManagement/types.js';
import { useDialogOrchestration } from './useDialogOrchestration.js';

describe('useDialogOrchestration', () => {
  it('opens and closes the permissions dialog', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    expect(result.current.isPermissionsDialogOpen).toBe(false);

    act(() => {
      result.current.openPermissionsDialog();
    });

    expect(result.current.isPermissionsDialogOpen).toBe(true);

    act(() => {
      result.current.closePermissionsDialog();
    });

    expect(result.current.isPermissionsDialogOpen).toBe(false);
  });

  it('opens logging dialog with provided payload and defaults to empty entries', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    act(() => {
      result.current.openLoggingDialog({ entries: ['a', 'b'] });
    });

    expect(result.current.isLoggingDialogOpen).toBe(true);
    expect(result.current.loggingDialogData).toEqual({ entries: ['a', 'b'] });

    act(() => {
      result.current.closeLoggingDialog();
    });

    expect(result.current.isLoggingDialogOpen).toBe(false);

    act(() => {
      result.current.openLoggingDialog();
    });

    expect(result.current.loggingDialogData).toEqual({ entries: [] });
  });

  it('resets subagent initial state when closing the subagent dialog', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    act(() => {
      result.current.openSubagentDialog(SubagentView.EDIT, 'agent-alpha');
    });

    expect(result.current.isSubagentDialogOpen).toBe(true);
    expect(result.current.subagentDialogInitialView).toBe(SubagentView.EDIT);
    expect(result.current.subagentDialogInitialName).toBe('agent-alpha');

    act(() => {
      result.current.closeSubagentDialog();
    });

    expect(result.current.isSubagentDialogOpen).toBe(false);
    expect(result.current.subagentDialogInitialView).toBeUndefined();
    expect(result.current.subagentDialogInitialName).toBeUndefined();
  });

  it('clears models dialog data when closed', () => {
    const { result } = renderHook(() => useDialogOrchestration());

    act(() => {
      result.current.openModelsDialog({
        initialSearch: 'claude',
        includeDeprecated: true,
      });
    });

    expect(result.current.isModelsDialogOpen).toBe(true);
    expect(result.current.modelsDialogData).toEqual({
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
});
