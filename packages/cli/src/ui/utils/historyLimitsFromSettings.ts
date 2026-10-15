/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  normalizeHistoryLimits,
  type HistoryLimits,
} from '../stores/turn/historyLedger.js';

/** The display limits the `ui.historyMaxItems` / `ui.historyMaxBytes` settings select. */
export function historyLimitsFromSettings(settings: {
  readonly merged: {
    readonly ui: {
      readonly historyMaxItems?: number;
      readonly historyMaxBytes?: number;
    };
  };
}): HistoryLimits {
  const { historyMaxItems, historyMaxBytes } = settings.merged.ui;
  return normalizeHistoryLimits({
    maxItems: historyMaxItems,
    maxBytes: historyMaxBytes,
  });
}
