/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useSyncExternalStore } from 'react';

import { ideContext } from '@vybestack/llxprt-code-core';
import type { IdeState } from '../cliUiRuntime.js';

/**
 * This hook listens for trust status updates from the IDE companion extension
 * and provides the current IDE trust status.
 */
export function useIdeTrustListener(ide: Pick<IdeState, 'getIdeClient'>) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const ideClient = ide.getIdeClient();
      if (!ideClient) {
        return () => {}; // Return empty cleanup function if no IDE client
      }
      ideClient.addTrustChangeListener(onStoreChange);
      return () => {
        ideClient.removeTrustChangeListener(onStoreChange);
      };
    },
    [ide],
  );

  const getSnapshot = () =>
    ideContext.getIdeContext()?.workspaceState?.isTrusted;

  const isIdeTrusted = useSyncExternalStore(subscribe, getSnapshot);

  return { isIdeTrusted };
}
