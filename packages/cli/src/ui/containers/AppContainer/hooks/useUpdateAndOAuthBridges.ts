/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
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
  type OAuthInteractiveAuthOutcomeKind,
} from '@vybestack/llxprt-code-auth';
import {
  InteractiveAuthHostUnavailableError,
  interactiveAuthCoordinator,
  type AuthCompletionOptions,
  type InteractiveAuthChallenge,
} from '@vybestack/llxprt-code-providers/auth.js';
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

interface InteractiveHostOAuthManager {
  authenticate(
    provider: string,
    bucket?: string,
    options?: AuthCompletionOptions,
  ): Promise<void>;
}

function isInteractiveHostOAuthManager(
  value: unknown,
): value is InteractiveHostOAuthManager {
  return (
    value !== null &&
    typeof value === 'object' &&
    'authenticate' in value &&
    typeof value.authenticate === 'function'
  );
}

interface UseUpdateAndOAuthBridgesParams {
  addItem: HistoryAddItem;
  setUpdateInfo: Dispatch<SetStateAction<UpdateObject | null>>;
  getCliOAuthManager: () => unknown;
  runInInteractiveHostScope: <T>(callback: () => T) => T;
}

function formatSettledOutcome(kind: OAuthInteractiveAuthOutcomeKind): string {
  switch (kind) {
    case 'succeeded':
      return 'completed';
    case 'cancelled':
      return 'was cancelled';
    case 'timed_out':
      return 'timed out';
    case 'failed':
      return 'failed';
    default: {
      const exhaustive: never = kind;
      return `settled (${String(exhaustive)})`;
    }
  }
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
    case 'oauth_waiting': {
      const item: HistoryItemInfo = {
        type: 'info',
        text: `Waiting for ${event.provider}/${event.bucket ?? 'default'} authentication (requested by ${event.requesterRuntimeKind})…`,
      };
      return item;
    }
    case 'oauth_settled': {
      const item: HistoryItemInfo = {
        type: 'info',
        text: `Authentication for ${event.provider}/${event.bucket ?? 'default'} ${formatSettledOutcome(event.kind)}`,
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

function resolveInteractiveHostOAuthManager(
  getCliOAuthManager: () => unknown,
  challenge: InteractiveAuthChallenge,
): InteractiveHostOAuthManager {
  let manager: unknown;
  try {
    manager = getCliOAuthManager();
  } catch (error) {
    throw new InteractiveAuthHostUnavailableError(challenge, error);
  }

  if (!isInteractiveHostOAuthManager(manager)) {
    throw new InteractiveAuthHostUnavailableError(
      challenge,
      new Error('Registered OAuth manager does not support authentication'),
    );
  }
  return manager;
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
  runInInteractiveHostScope,
}: UseUpdateAndOAuthBridgesParams): void {
  // The runtime bridge can hand out fresh function identities on every
  // render; the host binding must survive that churn and only tear down on
  // a real unmount, so the handlers always resolve through this ref.
  const latest = useRef({
    addItem,
    getCliOAuthManager,
    runInInteractiveHostScope,
  });
  useEffect(() => {
    latest.current = {
      addItem,
      getCliOAuthManager,
      runInInteractiveHostScope,
    };
  });

  useEffect(() => {
    const { addItem: currentAddItem } = latest.current;
    const cleanup = setUpdateHandler(currentAddItem, setUpdateInfo);

    const oauthCallback = makeOAuthCallback(currentAddItem);

    const oauthManager = latest.current.getCliOAuthManager();
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
  }, [addItem, setUpdateInfo]);

  useEffect(() => {
    oauthUIBridge.setCallback((event, timestamp) =>
      makeOAuthCallback(latest.current.addItem)(event, timestamp),
    );

    // @plan PLAN-20260827-ISSUE2562.P05
    // @requirement REQ-2562-4
    // Bound exactly once per mounted host: identity churn of bridge-supplied
    // functions must not cancel active authentication. The handler resolves
    // the manager and scope through `latest` so it always uses current values.
    interactiveAuthCoordinator.bindHost((challenge, signal) =>
      latest.current.runInInteractiveHostScope(async () => {
        const oauthManager = resolveInteractiveHostOAuthManager(
          latest.current.getCliOAuthManager,
          challenge,
        );
        await oauthManager.authenticate(challenge.provider, challenge.bucket, {
          signal,
        });
      }),
    );

    return () => {
      interactiveAuthCoordinator.cancelActiveSessions();
      interactiveAuthCoordinator.unbindHost();
      oauthUIBridge.clearCallback();
    };
    // Bound for the host lifetime; all dependencies are read through the
    // `latest` ref, which is why this effect has an empty dependency array.
  }, []);
}
