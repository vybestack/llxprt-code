/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';

export function subscribeClientModelChanges(
  subscribe: SubscribeModelChanges,
  modelChanged: () => void,
  profileChanged: () => void,
): () => void {
  return subscribe((profile) => {
    if (profile === undefined) modelChanged();
    else profileChanged();
  });
}
