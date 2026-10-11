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
  type InteractiveAuthChallenge,
} from '@vybestack/llxprt-code-providers/auth.js';
import type { OAuthControl } from '../../../contexts/OAuthControlContext.js';
import type { UpdateObject } from '../../../utils/updateCheck.js';

type HistoryAddItem = (
  item: Omit<HistoryItemWithoutId, 'id'>,
  timestamp?: number,
) => number;

interface UseUpdateAndOAuthBridgesParams {
  addItem: HistoryAddItem;
  setUpdateInfo: Dispatch<SetStateAction<UpdateObject | null>>;
  oauthControl: Pick<OAuthControl, 'authenticate' | 'attachProviderMessages'>;
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

async function authenticateChallenge(
  control: Pick<OAuthControl, 'authenticate'>,
  challenge: InteractiveAuthChallenge,
  signal: AbortSignal,
): Promise<void> {
  let authentication: Promise<void>;
  try {
    authentication = control.authenticate(
      challenge.provider,
      challenge.bucket,
      { signal },
    );
  } catch (error) {
    throw new InteractiveAuthHostUnavailableError(challenge, error);
  }
  await authentication;
}

/**
 * @hook useUpdateAndOAuthBridges
 * @description Wires update handler and OAuth UI event bridges
 * @inputs addItem, setUpdateInfo, oauthControl
 * @outputs void
 * @sideEffects Registers update callback, the global OAuth UI event bridge
 *   callback, and each OAuth provider's addItem callback
 * @cleanup Restores update handler cleanup, clears the global OAuth UI event
 *   bridge callback, and resets provider callbacks to a safe no-op
 */
export function useUpdateAndOAuthBridges({
  addItem,
  setUpdateInfo,
  oauthControl,
}: UseUpdateAndOAuthBridgesParams): void {
  // The runtime bridge can hand out fresh function identities on every
  // render; the host binding must survive that churn and only tear down on
  // a real unmount, so the handlers always resolve through this ref.
  const latest = useRef({
    addItem,
    oauthControl,
  });
  useEffect(() => {
    latest.current = {
      addItem,
      oauthControl,
    };
  });

  useEffect(() => {
    const { addItem: currentAddItem } = latest.current;
    const cleanup = setUpdateHandler(currentAddItem, setUpdateInfo);

    const oauthCallback = makeOAuthCallback(currentAddItem);

    const control = latest.current.oauthControl;
    control.attachProviderMessages(oauthCallback);

    return () => {
      control.attachProviderMessages(() => -1);
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
    // the owner control through `latest` so it always uses the mounted root.
    interactiveAuthCoordinator.bindHost(async (challenge, signal) => {
      await authenticateChallenge(
        latest.current.oauthControl,
        challenge,
        signal,
      );
    });

    return () => {
      interactiveAuthCoordinator.cancelActiveSessions();
      interactiveAuthCoordinator.unbindHost();
      oauthUIBridge.clearCallback();
    };
    // Bound for the host lifetime; all dependencies are read through the
    // `latest` ref, which is why this effect has an empty dependency array.
  }, []);
}
