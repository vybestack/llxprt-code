/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { ideContext, type IdeContext } from '@vybestack/llxprt-code-core';

interface UseIdeContextBridgeParams {
  setIdeContextState: (value: IdeContext | undefined) => void;
}

/**
 * @hook useIdeContextBridge
 * @description Subscribes UI state to IDE context updates
 * @inputs setIdeContextState
 * @outputs void
 * @sideEffects Registers ideContext subscription
 * @cleanup Unsubscribes on unmount
 */
export function useIdeContextBridge({
  setIdeContextState,
}: UseIdeContextBridgeParams): void {
  useEffect(() => {
    const unsubscribe = ideContext.subscribeToIdeContext(setIdeContextState);
    setIdeContextState(ideContext.getIdeContext());
    return unsubscribe;
  }, [setIdeContextState]);
}
