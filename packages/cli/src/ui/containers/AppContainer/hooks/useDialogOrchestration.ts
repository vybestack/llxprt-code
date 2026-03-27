/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState } from 'react';
import type { ModelsDialogData } from '../../../commands/types.js';
import { SubagentView } from '../../../components/SubagentManagement/types.js';

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
  // Permissions dialog
  isPermissionsDialogOpen: boolean;
  openPermissionsDialog: () => void;
  closePermissionsDialog: () => void;

  // Logging dialog
  isLoggingDialogOpen: boolean;
  loggingDialogData: { entries: unknown[] };
  openLoggingDialog: (data?: { entries: unknown[] }) => void;
  closeLoggingDialog: () => void;

  // Subagent dialog
  isSubagentDialogOpen: boolean;
  subagentDialogInitialView: SubagentView | undefined;
  subagentDialogInitialName: string | undefined;
  openSubagentDialog: (
    initialView?: SubagentView,
    initialName?: string,
  ) => void;
  closeSubagentDialog: () => void;

  // Models dialog
  isModelsDialogOpen: boolean;
  modelsDialogData: ModelsDialogData | undefined;
  openModelsDialog: (data?: ModelsDialogData) => void;
  closeModelsDialog: () => void;

  // Session browser dialog
  isSessionBrowserDialogOpen: boolean;
  openSessionBrowserDialog: () => void;
  closeSessionBrowserDialog: () => void;
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
    isPermissionsDialogOpen,
    openPermissionsDialog,
    closePermissionsDialog,
  ] = useBooleanDialog();

  const [
    isLoggingDialogOpen,
    loggingDialogData,
    openLoggingDialog,
    closeLoggingDialog,
  ] = usePayloadDialog<{ entries: unknown[] }>({ entries: [] });

  // Subagent has two payload params — manage manually
  const [isSubagentDialogOpen, setIsSubagentDialogOpen] = useState(false);
  const [subagentDialogInitialView, setSubagentDialogInitialView] = useState<
    SubagentView | undefined
  >(undefined);
  const [subagentDialogInitialName, setSubagentDialogInitialName] = useState<
    string | undefined
  >(undefined);

  const openSubagentDialog = useCallback(
    (initialView?: SubagentView, initialName?: string) => {
      setSubagentDialogInitialView(initialView);
      setSubagentDialogInitialName(initialName);
      setIsSubagentDialogOpen(true);
    },
    [],
  );

  const closeSubagentDialog = useCallback(() => {
    setIsSubagentDialogOpen(false);
    setSubagentDialogInitialView(undefined);
    setSubagentDialogInitialName(undefined);
  }, []);

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

  return {
    // Permissions dialog
    isPermissionsDialogOpen,
    openPermissionsDialog,
    closePermissionsDialog,

    // Logging dialog
    isLoggingDialogOpen,
    loggingDialogData,
    openLoggingDialog,
    closeLoggingDialog,

    // Subagent dialog
    isSubagentDialogOpen,
    subagentDialogInitialView,
    subagentDialogInitialName,
    openSubagentDialog,
    closeSubagentDialog,

    // Models dialog
    isModelsDialogOpen,
    modelsDialogData,
    openModelsDialog,
    closeModelsDialog,

    // Session browser dialog
    isSessionBrowserDialogOpen,
    openSessionBrowserDialog,
    closeSessionBrowserDialog,
  };
}
