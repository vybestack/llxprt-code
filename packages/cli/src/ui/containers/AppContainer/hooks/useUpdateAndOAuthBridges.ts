/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type {
  HistoryItemWithoutId,
  HistoryItemInfo,
  HistoryItemWarning,
  HistoryItemError,
  HistoryItemOAuthURL,
} from '../../../types.js';
import { setUpdateHandler } from '../../../../utils/handleAutoUpdate.js';
import {
  oauthUIBridge,
  type OAuthUIEvent,
  type OAuthUICallback,
} from '@vybestack/llxprt-code-auth';
import type { UpdateObject } from '../../../utils/updateCheck.js';

type HistoryAddItem = (
  item: Omit<HistoryItemWithoutId, 'id'>,
  timestamp?: number,
) => number;

interface OAuthProviderWithAddItem {
  setAddItem?: (callback: OAuthUICallback) => void;
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
 * Converts a UI-agnostic {@link OAuthUIEvent} into a CLI history item payload.
 *
 * The mapping is explicit and exhaustive over every `OAuthUIEvent` variant so
 * that adding a new event type forces a compile error here (via the `never`
 * default). Each case constructs the precisely-typed
 * `Omit<HistoryItemWithoutId,'id'>` variant — no `any` or broad casts.
 */
function eventToHistoryItem(
  event: OAuthUIEvent,
): Omit<HistoryItemWithoutId, 'id'> {
  switch (event.type) {
    case 'info': {
      const item: HistoryItemInfo = {
        type: 'info',
        text: event.text,
        ...(event.icon !== undefined ? { icon: event.icon } : {}),
        ...(event.color !== undefined ? { color: event.color } : {}),
      };
      return item;
    }
    case 'warning': {
      const item: HistoryItemWarning = { type: 'warning', text: event.text };
      return item;
    }
    case 'error': {
      const item: HistoryItemError = { type: 'error', text: event.text };
      return item;
    }
    case 'oauth_url': {
      const item: HistoryItemOAuthURL = {
        type: 'oauth_url',
        text: event.text,
        url: event.url,
      };
      return item;
    }
    default: {
      // Exhaustiveness guard: if a new variant is added to OAuthUIEvent,
      // this assignment fails to compile.
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * Build an {@link OAuthUICallback} adapter that ultimately calls `addItem`.
 */
function makeOAuthCallback(addItem: HistoryAddItem): OAuthUICallback {
  return (event: OAuthUIEvent, timestamp?: number): number =>
    addItem(eventToHistoryItem(event), timestamp);
}

/**
 * @hook useUpdateAndOAuthBridges
 * @description Wires update handler and OAuth UI event bridges
 * @inputs addItem, setUpdateInfo, getCliOAuthManager
 * @outputs void
 * @sideEffects Registers update callback, the global OAuth UI event bridge
 *   callback, and each OAuth provider's addItem callback
 * @cleanup Restores update handler cleanup, clears the global OAuth UI event
 *   bridge callback, and resets provider callbacks to a safe no-op
 */
export function useUpdateAndOAuthBridges({
  addItem,
  setUpdateInfo,
  getCliOAuthManager,
}: UseUpdateAndOAuthBridgesParams): void {
  useEffect(() => {
    const cleanup = setUpdateHandler(addItem, setUpdateInfo);

    const oauthCallback = makeOAuthCallback(addItem);

    const oauthManager = getCliOAuthManager();
    const providersMap =
      oauthManager != null &&
      typeof oauthManager === 'object' &&
      'providers' in oauthManager
        ? (oauthManager as CliOAuthManagerWithProviders).providers
        : undefined;
    const providers: OAuthProviderWithAddItem[] = [];
    if (providersMap instanceof Map) {
      for (const provider of providersMap.values()) {
        const candidate = provider as OAuthProviderWithAddItem;
        candidate.setAddItem?.(oauthCallback);
        providers.push(candidate);
      }
    }

    return () => {
      // Replace stale addItem references in providers with a safe no-op
      // so callbacks that fire after unmount don't interact with stale closures.
      providers.forEach((p) => p.setAddItem?.(() => -1));
      cleanup();
    };
  }, [addItem, getCliOAuthManager, setUpdateInfo]);

  useEffect(() => {
    oauthUIBridge.setCallback(makeOAuthCallback(addItem));

    return () => {
      oauthUIBridge.clearCallback();
    };
  }, [addItem]);
}
