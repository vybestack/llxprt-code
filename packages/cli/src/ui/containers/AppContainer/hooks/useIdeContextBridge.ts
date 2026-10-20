/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { IdeContext } from '@vybestack/llxprt-code-core';

interface UseIdeContextBridgeParams {
  readIdeContext: () => IdeContext | undefined;
  subscribeIdeContext: (
    listener: (context: IdeContext | undefined) => void,
  ) => () => void;
  setIdeContextState: (value: IdeContext | undefined) => void;
}

/**
 * @hook useIdeContextBridge
 * @description Subscribes UI state to the owner's IDE client context updates
 * @inputs ide, setIdeContextState
 * @outputs void
 * @sideEffects Registers a context listener on the owner's IDE client
 * @cleanup Removes the listener on unmount
 */
export function useIdeContextBridge({
  readIdeContext,
  subscribeIdeContext,
  setIdeContextState,
}: UseIdeContextBridgeParams): void {
  useEffect(() => {
    setIdeContextState(readIdeContext());
    return subscribeIdeContext(setIdeContextState);
  }, [readIdeContext, subscribeIdeContext, setIdeContextState]);
}
