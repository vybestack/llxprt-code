/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { globalOAuthUI } from '../../global-oauth-ui.js';
import type {
  HistoryItemWithoutId,
  HistoryItemOAuthURL,
} from '../../../ui/types.js';

function makeOAuthItem(
  text: string,
): Omit<HistoryItemOAuthURL, keyof HistoryItemWithoutId> &
  Omit<HistoryItemWithoutId, 'id'> {
  return {
    type: 'oauth_url',
    text,
    url: `https://example.com/${text}`,
  };
}

describe('Bridge/UI behavioral scenarios', () => {
  beforeEach(() => {
    globalOAuthUI.clearAddItem();
    globalOAuthUI.clearPendingItems();
  });

  it('BR-01: Bridge available at module load', () => {
    const bridge = (global as Record<string, unknown>).__oauth_add_item;

    expect(bridge).toBeDefined();
    expect(typeof bridge).toBe('function');
  });

  it('BR-02: Event before UI mount buffered', () => {
    const item = makeOAuthItem('pre-mount');

    globalOAuthUI.callAddItem(item);

    expect(globalOAuthUI.getPendingCount()).toBe(1);
  });

  it('BR-03: Buffer flush on handler attach (FIFO order)', () => {
    const delivered: Array<Omit<HistoryItemWithoutId, 'id'>> = [];
    const handler = vi.fn((itemData: Omit<HistoryItemWithoutId, 'id'>) => {
      delivered.push(itemData);
      return delivered.length;
    });

    const first = makeOAuthItem('first');
    const second = makeOAuthItem('second');
    const third = makeOAuthItem('third');

    globalOAuthUI.callAddItem(first);
    globalOAuthUI.callAddItem(second);
    globalOAuthUI.callAddItem(third);

    expect(globalOAuthUI.getPendingCount()).toBe(3);

    globalOAuthUI.setAddItem(handler);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(delivered[0]).toEqual(first);
    expect(delivered[1]).toEqual(second);
    expect(delivered[2]).toEqual(third);
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  it('BR-04: Event during cleanup/remount buffered then delivered', () => {
    const firstHandler = vi.fn(() => 1);
    const secondHandler = vi.fn(() => 2);

    globalOAuthUI.setAddItem(firstHandler);

    globalOAuthUI.clearAddItem();

    const item = makeOAuthItem('during-remount');
    globalOAuthUI.callAddItem(item);

    expect(firstHandler).not.toHaveBeenCalled();
    expect(globalOAuthUI.getPendingCount()).toBe(1);

    globalOAuthUI.setAddItem(secondHandler);

    expect(secondHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'during-remount' }),
      undefined,
    );
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  it('BR-05: Direct delivery when handler mounted', () => {
    const handler = vi.fn(() => 42);

    globalOAuthUI.setAddItem(handler);

    const item = makeOAuthItem('live-delivery');
    const result = globalOAuthUI.callAddItem(item);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'live-delivery' }),
      undefined,
    );
    expect(result).toBe(42);
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });
});
