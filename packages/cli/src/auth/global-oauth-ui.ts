/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { HistoryItemWithoutId } from '../ui/types.js';

const logger = new DebugLogger('llxprt:oauth:ui');

export const MAX_PENDING_ITEMS = 32;

type AddItemCallback = (
  itemData: Omit<HistoryItemWithoutId, 'id'>,
  baseTimestamp?: number,
) => number;

interface PendingItem {
  readonly itemData: Omit<HistoryItemWithoutId, 'id'>;
  readonly baseTimestamp?: number;
}

/**
 * Global holder for the OAuth UI callback (addItem).
 * This allows OAuth providers to be created before the UI renders,
 * but still display OAuth URLs once the UI is available.
 *
 * Events are buffered when no handler is attached and flushed FIFO
 * when a handler connects. The buffer is capped at MAX_PENDING_ITEMS
 * with drop-oldest semantics.
 */
class GlobalOAuthUI {
  private addItemCallback: AddItemCallback | null = null;
  private pendingItems: PendingItem[] = [];

  /**
   * Set the addItem callback when UI is available.
   * Flushes any buffered items to the callback (FIFO order).
   * The callback is installed before flush so concurrent events
   * during flush go directly to the handler.
   */
  setAddItem(callback: AddItemCallback): void {
    this.addItemCallback = callback;
    const pending = this.pendingItems.splice(0);
    for (const item of pending) {
      try {
        callback(item.itemData, item.baseTimestamp);
      } catch (error) {
        logger.debug(
          () =>
            `[OAUTH] Failed to deliver buffered item: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Clear the addItem callback when UI is disposed.
   * Does NOT clear the buffer — events persist for the next handler.
   */
  clearAddItem(): void {
    this.addItemCallback = null;
  }

  /**
   * @deprecated Use callAddItem() instead for consistent buffering.
   */
  getAddItem(): AddItemCallback | undefined {
    return this.addItemCallback ?? undefined;
  }

  /**
   * Call addItem if available, otherwise buffer the event.
   * When buffered, returns undefined. When the buffer is full,
   * the oldest item is dropped.
   */
  callAddItem(
    itemData: Omit<HistoryItemWithoutId, 'id'>,
    baseTimestamp?: number,
  ): number | undefined {
    if (this.addItemCallback) {
      return this.addItemCallback(itemData, baseTimestamp);
    }
    if (this.pendingItems.length >= MAX_PENDING_ITEMS) {
      this.pendingItems.shift();
      logger.debug(
        () =>
          `[OAUTH] Pending buffer full (${MAX_PENDING_ITEMS}), dropped oldest item`,
      );
    }
    this.pendingItems.push({ itemData, baseTimestamp });
    return undefined;
  }

  getPendingCount(): number {
    return this.pendingItems.length;
  }

  clearPendingItems(): void {
    this.pendingItems.length = 0;
  }
}

export const globalOAuthUI = new GlobalOAuthUI();

// Stable bridge: always exists from module load, routes through singleton.
// Never deleted — events buffer when no handler is attached.
(global as Record<string, unknown>).__oauth_add_item = (
  itemData: Omit<HistoryItemWithoutId, 'id'>,
  baseTimestamp?: number,
): number | undefined => globalOAuthUI.callAddItem(itemData, baseTimestamp);
