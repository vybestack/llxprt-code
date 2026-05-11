/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useStaticRefreshManager
 * @description Debounced static refresh and flicker correction orchestration
 * @inputs streamingState, terminal dimensions, refreshStatic, constrainHeight state
 * @outputs void
 * @sideEffects Debounced resize handler, deferred refresh, AppEvent subscription
 * @cleanup Clears timers and unsubscribes on unmount
 * @strictMode Safe - idempotent subscriptions and cleanup
 * @subscriptionStrategy Stable + debounced timer
 */

import { useEffect, useRef } from 'react';
import { StreamingState } from '../../../types.js';
import { appEvents, AppEvent } from '../../../../utils/events.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const debug = new DebugLogger('llxprt:ui:staticrefresh');

interface UseStaticRefreshManagerOptions {
  streamingState: StreamingState;
  terminalWidth: number;
  terminalHeight: number;
  refreshStatic: () => void;
  constrainHeight: boolean;
  setConstrainHeight: (value: boolean) => void;
}

export function useStaticRefreshManager({
  streamingState,
  terminalWidth,
  terminalHeight,
  refreshStatic,
  constrainHeight,
  setConstrainHeight,
}: UseStaticRefreshManagerOptions): void {
  const staticNeedsRefreshRef = useRef(false);
  const isInitialMount = useRef(true);

  useEffect(() => {
    const handleFlicker = (data: {
      contentHeight: number;
      terminalHeight: number;
      overflow: number;
    }) => {
      debug.log(
        `Flicker event received: overflow=${data.overflow}, content=${data.contentHeight}, terminal=${data.terminalHeight}`,
      );
      if (!constrainHeight) {
        setConstrainHeight(true);
      }
    };

    appEvents.on(AppEvent.Flicker, handleFlicker);
    return () => {
      appEvents.off(AppEvent.Flicker, handleFlicker);
    };
  }, [constrainHeight, setConstrainHeight]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return undefined;
    }

    const handler = setTimeout(() => {
      if (streamingState === StreamingState.Idle) {
        refreshStatic();
      } else {
        staticNeedsRefreshRef.current = true;
      }
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [terminalWidth, terminalHeight, refreshStatic, streamingState]);

  useEffect(() => {
    if (
      streamingState === StreamingState.Idle &&
      staticNeedsRefreshRef.current
    ) {
      staticNeedsRefreshRef.current = false;
      refreshStatic();
    }
  }, [streamingState, refreshStatic]);
}
