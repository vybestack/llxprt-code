/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Loaders stay owned by dialogs; slash commands consume the committed callbacks. */
export interface DialogActions {
  openThemeDialog: () => void;
  openProviderDialog: () => void;
  openLoadProfileDialog: () => void | Promise<void>;
  openCreateProfileDialog: () => void;
  openProfileListDialog: () => void | Promise<void>;
  viewProfileDetail: (
    name: string,
    openedDirectly?: boolean,
  ) => void | Promise<void>;
  openProfileEditor: (
    name: string,
    openedDirectly?: boolean,
  ) => void | Promise<void>;
  welcomeActions: { resetAndReopen: () => void };
}

function uninitializedDialogAction(): never {
  throw new Error('Dialog actions invoked before the dialog writer committed');
}

/** @returns Initial callbacks that fail fast if invoked before mount effects. */
export function initialDialogActions(): DialogActions {
  return {
    openThemeDialog: uninitializedDialogAction,
    openProviderDialog: uninitializedDialogAction,
    openLoadProfileDialog: uninitializedDialogAction,
    openCreateProfileDialog: uninitializedDialogAction,
    openProfileListDialog: uninitializedDialogAction,
    viewProfileDetail: uninitializedDialogAction,
    openProfileEditor: uninitializedDialogAction,
    welcomeActions: { resetAndReopen: uninitializedDialogAction },
  };
}
