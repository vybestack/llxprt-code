/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import type { IdeContext } from '@vybestack/llxprt-code-core';
import type { IdeState } from '../../../cliUiRuntime.js';

interface UseIdeContextBridgeParams {
  ide: Pick<IdeState, 'getIdeClient'>;
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
  ide,
  setIdeContextState,
}: UseIdeContextBridgeParams): void {
  useEffect(() => {
    const client = ide.getIdeClient();
    setIdeContextState(client?.getIdeContext());
    if (client === undefined) return undefined;
    client.addContextChangeListener(setIdeContextState);
    return () => {
      client.removeContextChangeListener(setIdeContextState);
    };
  }, [ide, setIdeContextState]);
}
