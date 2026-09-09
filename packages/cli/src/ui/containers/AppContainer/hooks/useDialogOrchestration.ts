/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import type { ModelsDialogData } from '../../../commands/types.js';

/**
 * @hook useDialogOrchestration
 * @description Dialog state machines with open/close callbacks
 * @inputs none
 * @outputs All dialog states and callbacks
 * @sideEffects useState only
 * @cleanup N/A
 * @strictMode Safe - useState initialization is stable
 * @subscriptionStrategy N/A
 */

export interface UseDialogOrchestrationResult {
  // Models dialog
  isModelsDialogOpen: boolean;
  modelsDialogData: ModelsDialogData | undefined;
  openModelsDialog: (data?: ModelsDialogData) => void;
  closeModelsDialog: () => void;

  // Session browser dialog
  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P21
   */
  isSessionBrowserDialogOpen: boolean;
  openSessionBrowserDialog: () => void;
  closeSessionBrowserDialog: () => void;

  // Model config dialog
  isModelConfigDialogOpen: boolean;
  openModelConfigDialog: () => void;
  closeModelConfigDialog: () => void;

  // Policies dialog
  isPoliciesDialogOpen: boolean;
  openPoliciesDialog: () => void;
  closePoliciesDialog: () => void;
}

function useBooleanDialog(): [boolean, () => void, () => void] {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return [isOpen, open, close];
}

function usePayloadDialog<T>(
  defaultVal: T,
): [boolean, T, (data?: T) => void, () => void] {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<T>(defaultVal);
  const defaultRef = useRef(defaultVal);
  defaultRef.current = defaultVal;
  const open = useCallback((incoming?: T) => {
    setData(incoming ?? defaultRef.current);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
    setData(defaultRef.current);
  }, []);
  return [isOpen, data, open, close];
}

export function useDialogOrchestration(): UseDialogOrchestrationResult {
  const [
    isModelsDialogOpen,
    modelsDialogData,
    openModelsDialog,
    closeModelsDialog,
  ] = usePayloadDialog<ModelsDialogData | undefined>(undefined);

  /**
   * Session browser dialog state
   * @plan PLAN-20260214-SESSIONBROWSER.P21
   */
  const [
    isSessionBrowserDialogOpen,
    openSessionBrowserDialog,
    closeSessionBrowserDialog,
  ] = useBooleanDialog();

  const [
    isModelConfigDialogOpen,
    openModelConfigDialog,
    closeModelConfigDialog,
  ] = useBooleanDialog();

  const [isPoliciesDialogOpen, openPoliciesDialog, closePoliciesDialog] =
    useBooleanDialog();

  return {
    // Models dialog
    isModelsDialogOpen,
    modelsDialogData,
    openModelsDialog,
    closeModelsDialog,

    // Session browser dialog
    isSessionBrowserDialogOpen,
    openSessionBrowserDialog,
    closeSessionBrowserDialog,

    // Model config dialog
    isModelConfigDialogOpen,
    openModelConfigDialog,
    closeModelConfigDialog,

    // Policies dialog
    isPoliciesDialogOpen,
    openPoliciesDialog,
    closePoliciesDialog,
  };
}
