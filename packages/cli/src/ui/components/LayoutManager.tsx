/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
} from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface LayoutContextValue {
  terminalHeight: number;
  terminalWidth: number;
  footerHeight: number;
  constrainHeight: boolean;
  availableTerminalHeight: number;
  setFooterHeight: (height: number) => void;
  setConstrainHeight: (value: boolean) => void;
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined);

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutManager');
  }
  return context;
};

interface LayoutManagerProps {
  children: React.ReactNode;
}

export const LayoutManager: React.FC<LayoutManagerProps> = ({ children }) => {
  const { rows: terminalHeight, columns: terminalWidth } = useTerminalSize();
  const [footerHeight, setFooterHeight] = useState<number>(0);
  const [constrainHeight, setConstrainHeight] = useState<boolean>(true);

  // Same calculation as in App.tsx
  const staticExtraHeight = /* margins and padding */ 3;
  const availableTerminalHeight = useMemo(
    () => terminalHeight - footerHeight - staticExtraHeight,
    [terminalHeight, footerHeight],
  );

  const value = useMemo(
    () => ({
      terminalHeight,
      terminalWidth,
      footerHeight,
      constrainHeight,
      availableTerminalHeight,
      setFooterHeight,
      setConstrainHeight,
    }),
    [
      terminalHeight,
      terminalWidth,
      footerHeight,
      constrainHeight,
      availableTerminalHeight,
    ],
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
};