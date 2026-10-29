/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ComponentProps } from 'react';
import type { HistoryItemDisplay } from '../components/HistoryItemDisplay.js';
type HistoryItemDisplayProps = ComponentProps<typeof HistoryItemDisplay>;
export type JournalRowRendering = Pick<
  HistoryItemDisplayProps,
  | 'config'
  | 'readIdeMode'
  | 'readIdeDiffingEnabled'
  | 'subscribeIdeDiffing'
  | 'resolveIdeDiff'
>;
