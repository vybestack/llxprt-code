/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  HistoryItem,
  SlashCommandProcessorResult,
} from '../../../types.js';
import type { Config } from '@vybestack/llxprt-code-core';
import {
  triggerSessionEndHook,
  SessionEndReason,
} from '@vybestack/llxprt-code-core';
import { restoreTerminalProtocolsSync } from '../../../utils/terminalProtocolCleanup.js';

/**
 * Duration in milliseconds to wait for a second Ctrl+C/D press before showing exit prompt.
 */
const CTRL_EXIT_PROMPT_DURATION_MS = 1000;

/**
 * @hook useExitHandling
 * @description Exit/quit lifecycle with double-press detection
 * @inputs handleSlashCommand, config
 * @outputs ExitState
 * @sideEffects Timer creation, exit effect
 * @cleanup Clears timers on unmount
 * @strictMode Idempotent (guard refs prevent duplicate)
 * @subscriptionStrategy Stable (refs for timers)
 */

export interface UseExitHandlingResult {
  ctrlCPressedOnce: boolean;
  setCtrlCPressedOnce: (value: boolean) => void;
  ctrlDPressedOnce: boolean;
  setCtrlDPressedOnce: (value: boolean) => void;
  quittingMessages: HistoryItem[] | null;
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
  handleExit: (
    pressedOnce: boolean,
    setPressedOnce: (value: boolean) => void,
    timerRef: React.MutableRefObject<NodeJS.Timeout | null>,
  ) => void;
  requestCtrlCExit: () => void;
  requestCtrlDExit: () => void;
  ctrlCTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  ctrlDTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
}

export interface UseExitHandlingParams {
  handleSlashCommand: (
    command: string,
  ) => Promise<SlashCommandProcessorResult | false>;
  config: Config;
}

function useQuitEffect(
  quittingMessages: HistoryItem[] | null,
  config: Config,
): void {
  useEffect(() => {
    if (quittingMessages != null) {
      // Allow UI to render the quit message briefly before exiting
      const timer = setTimeout(() => {
        // Fire SessionEnd hook before exiting
        triggerSessionEndHook(config, SessionEndReason.Exit)
          .catch(() => {
            // Hook failures must not block exit
          })
          .finally(() => {
            // Flush protocol restore before process.exit() so script/pty wrappers
            // don't drop the final disable sequences.
            restoreTerminalProtocolsSync();
            // Note: We don't call runExitCleanup() here because it includes
            // instance.waitUntilExit() which would deadlock. The cleanup is
            // triggered by process.exit() which fires SIGTERM/exit handlers.
            // The mouse events cleanup is registered in gemini.tsx and will
            // run via the process exit handlers. (fixes #959)
            process.exit(0);
          });
      }, 100); // 100ms delay to show quit screen

      return () => clearTimeout(timer);
    }
    return undefined;
  }, [quittingMessages, config]);
}

export function useExitHandling({
  handleSlashCommand,
  config,
}: UseExitHandlingParams): UseExitHandlingResult {
  const [ctrlCPressedOnce, setCtrlCPressedOnce] = useState(false);
  const [ctrlDPressedOnce, setCtrlDPressedOnce] = useState(false);
  const [quittingMessages, setQuittingMessages] = useState<
    HistoryItem[] | null
  >(null);

  const ctrlCTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ctrlDTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleExit = useCallback(
    (
      pressedOnce: boolean,
      setPressedOnce: (value: boolean) => void,
      timerRef: React.MutableRefObject<NodeJS.Timeout | null>,
    ) => {
      if (pressedOnce) {
        if (timerRef.current != null) {
          clearTimeout(timerRef.current);
        }
        // Directly invoke the central command handler.
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        handleSlashCommand('/quit');
        return;
      }

      setPressedOnce(true);
      timerRef.current = setTimeout(() => {
        setPressedOnce(false);
        timerRef.current = null;
      }, CTRL_EXIT_PROMPT_DURATION_MS);
    },
    [handleSlashCommand],
  );

  const requestCtrlCExit = useCallback(() => {
    if (!ctrlCPressedOnce) {
      setCtrlCPressedOnce(true);
      ctrlCTimerRef.current = setTimeout(() => {
        setCtrlCPressedOnce(false);
        ctrlCTimerRef.current = null;
      }, CTRL_EXIT_PROMPT_DURATION_MS);
      return;
    }
    handleExit(ctrlCPressedOnce, setCtrlCPressedOnce, ctrlCTimerRef);
  }, [ctrlCPressedOnce, handleExit]);

  const requestCtrlDExit = useCallback(() => {
    handleExit(ctrlDPressedOnce, setCtrlDPressedOnce, ctrlDTimerRef);
  }, [ctrlDPressedOnce, handleExit]);

  useQuitEffect(quittingMessages, config);

  // Cleanup timers on unmount
  useEffect(
    () => () => {
      const ctrlCTimer = ctrlCTimerRef.current;
      const ctrlDTimer = ctrlDTimerRef.current;
      if (ctrlCTimer != null) {
        clearTimeout(ctrlCTimer);
      }
      if (ctrlDTimer != null) {
        clearTimeout(ctrlDTimer);
      }
    },
    [ctrlCTimerRef, ctrlDTimerRef],
  );

  return {
    ctrlCPressedOnce,
    setCtrlCPressedOnce,
    ctrlDPressedOnce,
    setCtrlDPressedOnce,
    quittingMessages,
    setQuittingMessages,
    handleExit,
    requestCtrlCExit,
    requestCtrlDExit,
    ctrlCTimerRef,
    ctrlDTimerRef,
  };
}
