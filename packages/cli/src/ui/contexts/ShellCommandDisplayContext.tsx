/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../constants.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { ToolCallStatus } from '../types.js';

interface ShellCommandDisplayState {
  getShowFullDescription: (callId: string) => boolean;
  toggleShowFullDescription: (callId: string) => void;
}

const ShellCommandDisplayContext =
  createContext<ShellCommandDisplayState | null>(null);

interface ShellCommandDisplayProviderProps {
  alwaysDisplayFullShellCommand: boolean;
  children: React.ReactNode;
}

export const ShellCommandDisplayProvider: React.FC<
  ShellCommandDisplayProviderProps
> = ({ alwaysDisplayFullShellCommand, children }) => {
  const [callDisplayOverrides, setCallDisplayOverrides] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());

  const getShowFullDescription = useCallback(
    (callId: string): boolean =>
      callDisplayOverrides.get(callId) ?? alwaysDisplayFullShellCommand,
    [alwaysDisplayFullShellCommand, callDisplayOverrides],
  );

  const toggleShowFullDescription = useCallback(
    (callId: string): void => {
      setCallDisplayOverrides((previousOverrides) => {
        const currentValue =
          previousOverrides.get(callId) ?? alwaysDisplayFullShellCommand;
        return new Map([
          ...previousOverrides.entries(),
          [callId, !currentValue],
        ]);
      });
    },
    [alwaysDisplayFullShellCommand],
  );

  const value = useMemo<ShellCommandDisplayState>(
    () => ({ getShowFullDescription, toggleShowFullDescription }),
    [getShowFullDescription, toggleShowFullDescription],
  );

  return (
    <ShellCommandDisplayContext.Provider value={value}>
      {children}
    </ShellCommandDisplayContext.Provider>
  );
};

export function useShellCommandDisplay(
  callId: string,
  name: string,
  status: ToolCallStatus,
  isFocused: boolean,
): boolean {
  const context = useContext(ShellCommandDisplayContext);
  if (context === null) {
    throw new Error(
      'useShellCommandDisplay must be used within ShellCommandDisplayProvider',
    );
  }

  const isShellTool = name === SHELL_COMMAND_NAME || name === SHELL_NAME;
  const { getShowFullDescription, toggleShowFullDescription } = context;
  const onKeypress = useCallback(
    (key: { ctrl?: boolean; name?: string }): void => {
      if (
        isShellTool &&
        key.ctrl === true &&
        key.name === 'r' &&
        status === ToolCallStatus.Executing
      ) {
        toggleShowFullDescription(callId);
      }
    },
    [callId, isShellTool, status, toggleShowFullDescription],
  );

  useKeypress(onKeypress, { isActive: isFocused && isShellTool });

  return isShellTool && getShowFullDescription(callId);
}
