/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef } from 'react';
import type { HistoryItem } from '../types.js';

/**
 * Ensures the Ink <Static> history output stays in sync with the in-memory
 * history when earlier items are trimmed (due to max items/bytes). Ink's
 * Static component only appends new rows, so if items are removed we must
 * force a full refresh so future rows render again.
 */
export function useStaticHistoryRefresh(
  history: HistoryItem[],
  refreshStatic: () => void,
): void {
  const previousStateRef = useRef<{
    firstId: number | null;
    length: number;
  }>({
    firstId: null,
    length: 0,
  });

  useEffect(() => {
    const currentFirstId = history.length > 0 ? history[0].id : null;
    const previousState = previousStateRef.current;

    const historyShrank =
      history.length < previousState.length ||
      (previousState.firstId !== null && currentFirstId === null) ||
      (previousState.firstId !== null &&
        currentFirstId !== null &&
        currentFirstId > previousState.firstId);

    if (historyShrank) {
      refreshStatic();
    }

    previousStateRef.current = {
      firstId: currentFirstId,
      length: history.length,
    };
  }, [history, refreshStatic]);
}
