/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MutableRefObject } from 'react';
import { useCallback, useRef } from 'react';
import { useKeypress, type Key } from '../../../hooks/useKeypress.js';
import { keyMatchers, Command } from '../../../keyMatchers.js';
import {
  isMouseEventsActive,
  setMouseEventsActive,
  disableMouseEvents,
  enableMouseEvents,
} from '../../../utils/mouse.js';
import { MessageType } from '../../../types.js';
import {
  DebugLogger,
  ShellExecutionService,
} from '@vybestack/llxprt-code-core';

const debug = new DebugLogger('llxprt:ui:keybindings');

/**
 * @hook useKeybindings
 * @description Global keybinding handler with priority delegation
 * @inputs ExitKeybindingDeps, DisplayKeybindingDeps, ShellKeybindingDeps, CopyModeDeps
 * @outputs void
 * @sideEffects useKeypress registration
 * @cleanup Removes handler on unmount
 * @strictMode Safe - handler stable via useCallback
 * @subscriptionStrategy Stable
 */

export interface ExitKeybindingDeps {
  requestCtrlCExit: () => void;
  requestCtrlDExit: () => void;
  ctrlCPressedOnce: boolean;
  cancelOngoingRequest?: () => void;
  bufferTextLength: number;
}

export interface DisplayKeybindingDeps {
  showErrorDetails: boolean;
  setShowErrorDetails: (v: boolean) => void;
  showToolDescriptions: boolean;
  setShowToolDescriptions: (v: boolean) => void;
  renderMarkdown: boolean;
  setRenderMarkdown: (v: boolean) => void;
  isTodoPanelCollapsed: boolean;
  setIsTodoPanelCollapsed: (v: boolean) => void;
  constrainHeight: boolean;
  setConstrainHeight: (v: boolean) => void;
  refreshStatic: () => void;
  addItem: (item: { type: MessageType; text: string }, ts: number) => number;
  handleSlashCommand: (cmd: string) => Promise<unknown>;
}

export interface ShellKeybindingDeps {
  activeShellPtyId: number | null;
  setEmbeddedShellFocused: (v: boolean | ((prev: boolean) => boolean)) => void;
  getEnableInteractiveShell: () => boolean;
}

export interface CopyModeDeps {
  copyModeEnabled: boolean;
  setCopyModeEnabled: (v: boolean) => void;
  useAlternateBuffer: boolean;
}

export interface IdeContextDeps {
  getIdeMode: () => boolean;
  ideContextState: unknown;
}

export interface McpDeps {
  getMcpServers: () => Record<string, unknown> | undefined;
}

export interface UseKeybindingsParams {
  exit: ExitKeybindingDeps;
  display: DisplayKeybindingDeps;
  shell: ShellKeybindingDeps;
  copyMode: CopyModeDeps;
  ideContext: IdeContextDeps;
  mcp: McpDeps;
}

/**
 * Handles copy mode toggle keybinding.
 * Returns true if key was handled (should short-circuit).
 */
function handleCopyModeKey(
  key: Key,
  copyMode: CopyModeDeps,
  mouseStateRef: MutableRefObject<boolean | null>,
): boolean {
  if (copyMode.copyModeEnabled) {
    copyMode.setCopyModeEnabled(false);
    // Restore the pre-copy-mode mouse state. If no saved state (e.g. copy mode
    // was active at mount), fall back to enabling mouse events (previous default).
    if (mouseStateRef.current === null || mouseStateRef.current) {
      enableMouseEvents();
    } else {
      disableMouseEvents();
    }
    mouseStateRef.current = null;
    return true;
  }

  if (
    copyMode.useAlternateBuffer &&
    keyMatchers[Command.TOGGLE_COPY_MODE](key)
  ) {
    // Save mouse state before disabling so it can be restored on exit.
    mouseStateRef.current = isMouseEventsActive();
    copyMode.setCopyModeEnabled(true);
    disableMouseEvents();
    return true;
  }

  return false;
}

/**
 * Handles exit keybindings (Ctrl+C/D).
 * Returns true if key was handled (should short-circuit).
 */
function handleExitKeys(key: Key, exit: ExitKeybindingDeps): boolean {
  if (keyMatchers[Command.QUIT](key)) {
    if (!exit.ctrlCPressedOnce) {
      exit.cancelOngoingRequest?.();
    }
    exit.requestCtrlCExit();
    return true;
  }

  if (keyMatchers[Command.EXIT](key)) {
    if (exit.bufferTextLength > 0) {
      return true; // Don't exit if there's text in buffer
    }
    exit.requestCtrlDExit();
    return true;
  }

  return false;
}

/**
 * Handles display toggle keybindings.
 */
function handleDisplayKeys(
  key: Key,
  display: DisplayKeybindingDeps,
  mcp: McpDeps,
  enteringConstrainHeightMode: boolean,
): void {
  if (keyMatchers[Command.SHOW_ERROR_DETAILS](key)) {
    display.setShowErrorDetails(!display.showErrorDetails);
    return;
  }

  if (keyMatchers[Command.TOGGLE_MOUSE_EVENTS](key)) {
    const nextActive = !isMouseEventsActive();
    setMouseEventsActive(nextActive);
    display.addItem(
      {
        type: MessageType.INFO,
        text: nextActive
          ? 'Mouse events enabled (wheel scrolling + in-app selection/copy on).'
          : 'Mouse events disabled (terminal selection/copy on; in-app wheel scrolling off).',
      },
      Date.now(),
    );
    return;
  }

  if (keyMatchers[Command.TOGGLE_TOOL_DESCRIPTIONS](key)) {
    const newValue = !display.showToolDescriptions;
    display.setShowToolDescriptions(newValue);
    const mcpServers = mcp.getMcpServers();
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing to handle undefined/null server objects
    if (Object.keys(mcpServers || {}).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      display.handleSlashCommand(newValue ? '/mcp desc' : '/mcp nodesc');
    }
    return;
  }

  if (keyMatchers[Command.TOGGLE_MARKDOWN](key)) {
    display.setRenderMarkdown(!display.renderMarkdown);
    display.refreshStatic();
    return;
  }

  if (keyMatchers[Command.TOGGLE_TODO_DIALOG](key)) {
    display.setIsTodoPanelCollapsed(!display.isTodoPanelCollapsed);
    return;
  }

  if (
    keyMatchers[Command.SHOW_MORE_LINES](key) &&
    !enteringConstrainHeightMode
  ) {
    display.setConstrainHeight(false);
    return;
  }
}

/**
 * Handles IDE and shell keybindings.
 */
function handleIdeAndShellKeys(
  key: Key,
  ideContext: IdeContextDeps,
  shell: ShellKeybindingDeps,
): void {
  if (
    keyMatchers[Command.SHOW_IDE_CONTEXT_DETAIL](key) &&
    ideContext.getIdeMode() &&
    ideContext.ideContextState
  ) {
    // Show IDE status when in IDE mode and context is available.
    // Note: handleSlashCommand is called directly in the main handler for this
    return;
  }

  if (
    keyMatchers[Command.TOGGLE_SHELL_INPUT_FOCUS](key) &&
    shell.getEnableInteractiveShell()
  ) {
    const lastPtyId = ShellExecutionService.getLastActivePtyId();
    debug.log(
      'Ctrl+F: activeShellPtyId=%s, lastActivePtyId=%s, will toggle=%s',
      shell.activeShellPtyId,
      lastPtyId,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing for PTY ID (0 means no active PTY)
      !!(shell.activeShellPtyId || lastPtyId),
    );
    if (shell.activeShellPtyId || lastPtyId) {
      shell.setEmbeddedShellFocused((prev) => {
        debug.log('Ctrl+F: embeddedShellFocused %s -> %s', prev, !prev);
        return !prev;
      });
    }
  }
}

export function useKeybindings(params: UseKeybindingsParams): void {
  const { exit, display, shell, copyMode, ideContext, mcp } = params;

  // Instance-local mouse state tracking for copy mode save/restore.
  const mouseStateBeforeCopyModeRef = useRef<boolean | null>(null);

  const handleGlobalKeypress = useCallback(
    (key: Key) => {
      // Priority 1: Copy mode (highest priority - immediate exit from copy mode)
      if (handleCopyModeKey(key, copyMode, mouseStateBeforeCopyModeRef)) {
        return;
      }

      // Priority 2: Exit keys (Ctrl+C/D)
      if (handleExitKeys(key, exit)) {
        return;
      }

      // Calculate constrain height mode transition
      let enteringConstrainHeightMode = false;
      if (!display.constrainHeight) {
        enteringConstrainHeightMode = true;
        display.setConstrainHeight(true);
      }

      // Priority 3: Display toggles
      handleDisplayKeys(key, display, mcp, enteringConstrainHeightMode);

      // Priority 4: IDE and shell keys
      handleIdeAndShellKeys(key, ideContext, shell);

      // Handle IDE status command separately (needs handleSlashCommand)
      if (
        keyMatchers[Command.SHOW_IDE_CONTEXT_DETAIL](key) &&
        ideContext.getIdeMode() &&
        ideContext.ideContextState
      ) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        display.handleSlashCommand('/ide status');
      }
    },
    [exit, display, shell, copyMode, ideContext, mcp],
  );

  useKeypress(handleGlobalKeypress, {
    isActive: true,
  });
}
