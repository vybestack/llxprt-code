/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { HistoryItemWithoutId } from '../../../types.js';
import { setUpdateHandler } from '../../../../utils/handleAutoUpdate.js';
import { globalOAuthUI } from '../../../../auth/global-oauth-ui.js';
import type { UpdateObject } from '../../../utils/updateCheck.js';

type HistoryAddItem = (
  item: Omit<HistoryItemWithoutId, 'id'>,
  timestamp?: number,
) => number;

interface OAuthProviderWithAddItem {
  setAddItem?: (callback: HistoryAddItem) => void;
}

interface CliOAuthManagerWithProviders {
  providers?: Map<string, unknown>;
}

interface UseUpdateAndOAuthBridgesParams {
  addItem: HistoryAddItem;
  setUpdateInfo: Dispatch<SetStateAction<UpdateObject | null>>;
  getCliOAuthManager: () => unknown;
}

/**
 * @hook useUpdateAndOAuthBridges
 * @description Wires update handler and OAuth addItem bridges
 * @inputs addItem, setUpdateInfo, getCliOAuthManager
 * @outputs void
 * @sideEffects Registers update callback and global OAuth addItem callback
 * @cleanup Restores update handler cleanup and clears global OAuth callback
 */
export function useUpdateAndOAuthBridges({
  addItem,
  setUpdateInfo,
  getCliOAuthManager,
}: UseUpdateAndOAuthBridgesParams): void {
  useEffect(() => {
    const cleanup = setUpdateHandler(addItem, setUpdateInfo);

    const oauthManager = getCliOAuthManager() as CliOAuthManagerWithProviders;
    const providersMap = oauthManager.providers;
    if (providersMap instanceof Map) {
      for (const provider of providersMap.values()) {
        const candidate = provider as OAuthProviderWithAddItem;
        candidate.setAddItem?.(addItem);
      }
    }

    return cleanup;
  }, [addItem, getCliOAuthManager, setUpdateInfo]);

  useEffect(() => {
    (global as Record<string, unknown>).__oauth_add_item = addItem;
    globalOAuthUI.setAddItem(addItem);

    return () => {
      delete (global as Record<string, unknown>).__oauth_add_item;
      globalOAuthUI.clearAddItem();
    };
  }, [addItem]);
}
