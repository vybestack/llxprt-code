/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { TerminalStore } from './terminalStore.js';

const TerminalContext = createContext<TerminalStore | null>(null);

export function TerminalProvider({
  store,
  children,
}: {
  store: TerminalStore;
  children: React.ReactNode;
}) {
  return (
    <TerminalContext.Provider value={store}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalStore(): TerminalStore {
  const store = useContext(TerminalContext);
  if (store === null) {
    throw new Error('useTerminalStore must be used within a TerminalProvider');
  }
  return store;
}
