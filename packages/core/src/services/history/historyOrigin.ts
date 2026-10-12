/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from './IContent.js';

export function retainContentOrigins(
  previous: ReadonlyMap<IContent, object>,
  nextHistory: readonly IContent[],
  publishedContents: readonly IContent[] | undefined,
  origin: object | undefined,
  previousHistory: readonly IContent[],
): Map<IContent, object> {
  const retained = new Map<IContent, object>();
  for (const content of nextHistory) {
    const existing = previous.get(content);
    if (existing !== undefined) retained.set(content, existing);
  }
  if (origin !== undefined) {
    const priorContents = new Set(previousHistory);
    for (const content of publishedContents ?? nextHistory) {
      if (publishedContents !== undefined || !priorContents.has(content)) {
        retained.set(content, origin);
      }
    }
  }
  return retained;
}
