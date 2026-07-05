/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { ideContext } from '@vybestack/llxprt-code-core';
import type { IdeState } from '../cliUiRuntime.js';

/**
 * This hook listens for trust status updates from the IDE companion extension.
 * It provides the current trust status from the IDE and a flag indicating
 * if a restart is needed because the trust state has changed.
 */
export function useIdeTrustListener(ide: IdeState) {
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

  const [needsRestart, setNeedsRestart] = useState(false);
  const [initialTrustValue] = useState(isIdeTrusted);

  useEffect(() => {
    if (
      !needsRestart &&
      initialTrustValue !== undefined &&
      initialTrustValue !== isIdeTrusted
    ) {
      setNeedsRestart(true);
    }
  }, [isIdeTrusted, initialTrustValue, needsRestart]);

  return { isIdeTrusted, needsRestart };
}
