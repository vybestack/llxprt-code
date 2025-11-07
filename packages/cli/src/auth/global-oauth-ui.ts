/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryItemWithoutId } from '../ui/types.js';

/**
 * Global holder for the OAuth UI callback (addItem).
 * This allows OAuth providers to be created before the UI renders,
 * but still display OAuth URLs once the UI is available.
 */
class GlobalOAuthUI {
  private addItemCallback:
    | ((
        itemData: Omit<HistoryItemWithoutId, 'id'>,
        baseTimestamp: number,
      ) => number)
    | undefined = undefined;

  /**
   * Set the addItem callback when UI is available
   */
  setAddItem(
    callback: (
      itemData: Omit<HistoryItemWithoutId, 'id'>,
      baseTimestamp: number,
    ) => number,
  ): void {
    this.addItemCallback = callback;
  }

  /**
   * Clear the addItem callback when UI is disposed
   */
  clearAddItem(): void {
    this.addItemCallback = undefined;
  }

  /**
   * Get the current addItem callback, or undefined if UI not available
   */
  getAddItem():
    | ((
        itemData: Omit<HistoryItemWithoutId, 'id'>,
        baseTimestamp: number,
      ) => number)
    | undefined {
    return this.addItemCallback;
  }

  /**
   * Call addItem if available, otherwise no-op
   */
  callAddItem(
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp: number,
  ): number | undefined {
    return this.addItemCallback?.(itemData, baseTimestamp);
  }
}

export const globalOAuthUI = new GlobalOAuthUI();
