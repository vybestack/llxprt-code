/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useContext } from 'react';
import type { SettingsProfileStore } from './settingsStore.js';

const SettingsProfileContext = createContext<SettingsProfileStore | null>(null);

export function SettingsProfileProvider({
  store,
  children,
}: {
  store: SettingsProfileStore;
  children: React.ReactNode;
}) {
  return (
    <SettingsProfileContext.Provider value={store}>
      {children}
    </SettingsProfileContext.Provider>
  );
}

export function useSettingsProfileStore(): SettingsProfileStore {
  const store = useContext(SettingsProfileContext);
  if (store === null) {
    throw new Error(
      'useSettingsProfileStore must be used within a SettingsProfileProvider',
    );
  }
  return store;
}
