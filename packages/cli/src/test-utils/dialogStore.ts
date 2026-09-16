/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  selectDialogOpen,
  type DialogKind,
  type DialogStore,
} from '../ui/stores/dialog/dialogStore.js';

/**
 * @param store Dialog lifecycle owner under test.
 * @param kind Dialog whose visibility is being checked.
 * @returns Whether the dialog has an outstanding request, including consent slots.
 */
export function hasDialogRequest(
  store: DialogStore,
  kind: DialogKind,
): boolean {
  return selectDialogOpen(store.store.getState(), kind);
}
