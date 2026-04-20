/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { createContext, useContext } from 'react';
import type { AppAction } from '../reducers/appReducer.js';

const AppDispatchContext = createContext<React.Dispatch<AppAction> | undefined>(
  undefined,
);

export const AppDispatchProvider: React.FC<{
  value: React.Dispatch<AppAction>;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <AppDispatchContext.Provider value={value}>
    {children}
  </AppDispatchContext.Provider>
);

export const useAppDispatch = (): React.Dispatch<AppAction> => {
  const dispatch = useContext(AppDispatchContext);
  if (!dispatch) {
    throw new Error('useAppDispatch must be used within AppDispatchProvider');
  }
  return dispatch;
};
