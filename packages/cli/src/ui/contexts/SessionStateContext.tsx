/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useContext,
  useReducer,
  ReactNode,
  useMemo,
} from 'react';
import {
  sessionReducer,
  SessionState,
  SessionAction,
} from '../reducers/sessionReducer.js';

// Context type with strict typing for [state, dispatch]
type SessionStateContextType = [SessionState, React.Dispatch<SessionAction>];

// Create the context
const SessionStateContext = createContext<SessionStateContextType | undefined>(
  undefined,
);

// Provider props
interface SessionStateProviderProps {
  children: ReactNode;
  initialState: SessionState;
}

// Provider component
export const SessionStateProvider: React.FC<SessionStateProviderProps> = ({
  children,
  initialState,
}) => {
  const [state, dispatch] = useReducer(sessionReducer, initialState);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo<SessionStateContextType>(
    () => [state, dispatch],
    [state, dispatch],
  );

  return (
    <SessionStateContext.Provider value={contextValue}>
      {children}
    </SessionStateContext.Provider>
  );
};

// Hook to use the session state context
export const useSessionState = (): SessionStateContextType => {
  const context = useContext(SessionStateContext);
  if (!context) {
    throw new Error('useSessionState must be used within SessionStateProvider');
  }
  return context;
};
