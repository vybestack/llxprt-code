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
  useEffect,
  useRef,
  RefObject,
} from 'react';
import { DOMElement, measureElement } from 'ink';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface LayoutContextValue {
  terminalHeight: number;
  terminalWidth: number;
  footerHeight: number;
  constrainHeight: boolean;
  availableTerminalHeight: number;
  setFooterHeight: (height: number) => void;
  setConstrainHeight: (value: boolean) => void;
  footerRef: RefObject<DOMElement | null>;
  registerFooterDependency: () => void;
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
  const footerRef = useRef<DOMElement>(null);
  const [footerUpdateCounter, setFooterUpdateCounter] = useState(0);

  // Register additional dependencies that might affect footer height
  const registerFooterDependency = useRef(() => {
    setFooterUpdateCounter((prev) => prev + 1);
  }).current;

  // Measure footer element when it changes
  useEffect(() => {
    if (footerRef.current) {
      const measurement = measureElement(footerRef.current);
      setFooterHeight(measurement.height);
    }
  }, [terminalHeight, footerUpdateCounter]); // Re-measure when terminal height or dependencies change

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
      footerRef,
      registerFooterDependency,
    }),
    [
      terminalHeight,
      terminalWidth,
      footerHeight,
      constrainHeight,
      availableTerminalHeight,
      registerFooterDependency,
    ],
  );

  return (
    <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
  );
};
