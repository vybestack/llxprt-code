/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { DialogStore } from './dialogStore.js';

const DialogContext = createContext<DialogStore | null>(null);

export function DialogProvider({
  store,
  children,
}: {
  store: DialogStore;
  children: React.ReactNode;
}) {
  return (
    <DialogContext.Provider value={store}>{children}</DialogContext.Provider>
  );
}

export function useDialogStore(): DialogStore {
  const store = useContext(DialogContext);
  if (store === null) {
    throw new Error('useDialogStore must be used within a DialogProvider');
  }
  return store;
}
