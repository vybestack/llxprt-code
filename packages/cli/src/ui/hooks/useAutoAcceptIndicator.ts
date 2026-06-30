/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ApprovalMode, type Agent } from '@vybestack/llxprt-code-agents';
import { useKeypress } from './useKeypress.js';
import { keyMatchers, Command } from '../keyMatchers.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';

export interface UseAutoAcceptIndicatorArgs {
  agent: Agent;
  addItem?: (item: HistoryItemWithoutId, timestamp: number) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  isActive?: boolean;
}

export function useAutoAcceptIndicator({
  agent,
  addItem,
  onApprovalModeChange,
  isActive = true,
}: UseAutoAcceptIndicatorArgs): ApprovalMode {
  const currentMode = agent.getApprovalMode();
  const [showAutoAcceptIndicator, setShowAutoAcceptIndicator] =
    useState(currentMode);

  useEffect(() => {
    setShowAutoAcceptIndicator(currentMode);
  }, [currentMode]);

  useKeypress(
    (key) => {
      let nextApprovalMode: ApprovalMode | undefined;

      if (keyMatchers[Command.TOGGLE_YOLO](key)) {
        nextApprovalMode =
          agent.getApprovalMode() === ApprovalMode.YOLO
            ? ApprovalMode.DEFAULT
            : ApprovalMode.YOLO;
      } else if (keyMatchers[Command.TOGGLE_AUTO_EDIT](key)) {
        nextApprovalMode =
          agent.getApprovalMode() === ApprovalMode.AUTO_EDIT
            ? ApprovalMode.DEFAULT
            : ApprovalMode.AUTO_EDIT;
      }

      if (nextApprovalMode !== undefined) {
        try {
          agent.setApprovalMode(nextApprovalMode);
          // Update local state immediately for responsiveness
          setShowAutoAcceptIndicator(nextApprovalMode);
          // Notify callback if provided
          onApprovalModeChange?.(nextApprovalMode);
        } catch (e) {
          addItem?.(
            {
              type: MessageType.INFO,
              text: (e as Error).message,
            },
            Date.now(),
          );
        }
      }
    },
    { isActive },
  );

  return showAutoAcceptIndicator;
}
