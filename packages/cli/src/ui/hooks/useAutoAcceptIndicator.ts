/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import { useKeypress } from './useKeypress.js';
import { keyMatchers, Command } from '../keyMatchers.js';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';

export interface UseAutoAcceptIndicatorArgs {
  readApprovalMode: () => ApprovalMode;
  setApprovalMode: (mode: ApprovalMode) => void;
  addItem?: (item: HistoryItemWithoutId, timestamp: number) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  isActive?: boolean;
}

export function useAutoAcceptIndicator({
  readApprovalMode,
  setApprovalMode,
  addItem,
  onApprovalModeChange,
  isActive = true,
}: UseAutoAcceptIndicatorArgs): ApprovalMode {
  const currentMode = readApprovalMode();
  const [showAutoAcceptIndicator, setShowAutoAcceptIndicator] =
    useState(currentMode);

  useEffect(() => {
    setShowAutoAcceptIndicator(currentMode);
  }, [currentMode]);

  useEffect(() => {
    const handleFolderTrustChanged = (trusted: boolean): void => {
      setShowAutoAcceptIndicator(
        trusted ? readApprovalMode() : ApprovalMode.DEFAULT,
      );
    };
    coreEvents.on(CoreEvent.FolderTrustChanged, handleFolderTrustChanged);
    return () => {
      coreEvents.off(CoreEvent.FolderTrustChanged, handleFolderTrustChanged);
    };
  }, [readApprovalMode]);

  useKeypress(
    (key) => {
      let nextApprovalMode: ApprovalMode | undefined;

      if (keyMatchers[Command.TOGGLE_YOLO](key)) {
        nextApprovalMode =
          readApprovalMode() === ApprovalMode.YOLO
            ? ApprovalMode.DEFAULT
            : ApprovalMode.YOLO;
      } else if (keyMatchers[Command.TOGGLE_AUTO_EDIT](key)) {
        nextApprovalMode =
          readApprovalMode() === ApprovalMode.AUTO_EDIT
            ? ApprovalMode.DEFAULT
            : ApprovalMode.AUTO_EDIT;
      }

      if (nextApprovalMode !== undefined) {
        try {
          setApprovalMode(nextApprovalMode);
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
