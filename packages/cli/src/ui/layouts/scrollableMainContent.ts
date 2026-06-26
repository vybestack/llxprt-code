/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

export interface ScrollableMainContentItem {
  key: string;
  estimatedHeight: number;
  element: React.ReactElement;
}

export function renderScrollableMainContentItem({
  item,
}: {
  item: ScrollableMainContentItem;
  index: number;
}): React.ReactElement {
  return item.element;
}

export function keyExtractorScrollableMainContentItem(
  item: ScrollableMainContentItem,
): string {
  return item.key;
}

export function estimateScrollableMainContentItemHeight(
  _index: number,
): number {
  return 100;
}
