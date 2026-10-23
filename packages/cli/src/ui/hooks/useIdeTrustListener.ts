/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useSyncExternalStore } from 'react';

/**
 * This hook listens for trust status updates from the IDE companion extension
 * and provides the current IDE trust status.
 */
export function useIdeTrustListener(
  readIdeWorkspaceTrust: () => boolean | undefined,
  subscribeIdeWorkspaceTrust: (
    listener: (trusted: boolean | undefined) => void,
  ) => () => void,
) {
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeIdeWorkspaceTrust(() => onStoreChange()),
    [subscribeIdeWorkspaceTrust],
  );

  const isIdeTrusted = useSyncExternalStore(subscribe, readIdeWorkspaceTrust);

  return { isIdeTrusted };
}
