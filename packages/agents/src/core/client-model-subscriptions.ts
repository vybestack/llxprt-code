/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CoreEvent,
  coreEvents,
} from '@vybestack/llxprt-code-core/utils/events.js';

export function releaseClientModelSubscriptions(
  modelChanged: () => void,
  profileChanged: () => void,
): unknown[] {
  const failures: unknown[] = [];
  try {
    coreEvents.off(CoreEvent.ModelChanged, modelChanged);
  } catch (error: unknown) {
    failures.push(error);
  }
  try {
    coreEvents.off(CoreEvent.ModelProfileChanged, profileChanged);
  } catch (error: unknown) {
    failures.push(error);
  }
  return failures;
}
