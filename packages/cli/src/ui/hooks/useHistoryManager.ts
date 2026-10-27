/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { useMemo } from 'react';
import { useStoreSelector } from '../stores/useStoreSelector.js';
import type { TurnStore, TurnCommands } from '../stores/turn/turnStore.js';

export interface UseHistoryManagerReturn {
  addItem: TurnCommands['addItem'];
  clearItems: TurnCommands['clearItems'];
}

export function useHistory(turnStore: TurnStore): UseHistoryManagerReturn {
  const error = useStoreSelector(
    turnStore.store,
    (state) => state.displayError,
  );
  if (error !== null) throw new Error(error);
  return useMemo(
    () => ({
      addItem: turnStore.commands.addItem,
      clearItems: turnStore.commands.clearItems,
    }),
    [turnStore],
  );
}
