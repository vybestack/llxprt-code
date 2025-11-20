/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Config } from '@vybestack/llxprt-code-core';
import { ideContext } from '@vybestack/llxprt-code-core';

/**
 * This hook listens for trust status updates from the IDE companion extension.
 * It provides the current trust status from the IDE and a flag indicating
 * if a restart is needed because the trust state has changed.
 */
export function useIdeTrustListener(config: Config) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const ideClient = config.getIdeClient();
      if (!ideClient) {
        return () => {}; // Return empty cleanup function if no IDE client
      }
      ideClient.addTrustChangeListener(onStoreChange);
      return () => {
        ideClient.removeTrustChangeListener(onStoreChange);
      };
    },
    [config],
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
