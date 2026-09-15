/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { TurnStore } from './turnStore.js';

const TurnContext = createContext<TurnStore | null>(null);

export function TurnProvider({
  store,
  children,
}: {
  store: TurnStore;
  children: React.ReactNode;
}) {
  return <TurnContext.Provider value={store}>{children}</TurnContext.Provider>;
}

export function useTurnStore(): TurnStore {
  const store = useContext(TurnContext);
  if (store === null) {
    throw new Error('useTurnStore must be used within a TurnProvider');
  }
  return store;
}
