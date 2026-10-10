/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Citation gating helpers extracted from core/turn.ts.
 *
 * Citations are shown only when the settings flag is set. Extracted as
 * pure functions over the config so the gating logic is testable without
 * a full Turn instance.
 */

import {
  AgentEventType,
  type ServerCitationEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';
export function shouldShowCitations(enabled: boolean): boolean {
  return enabled;
}

export function buildCitationEvent(
  enabled: boolean,
  text: string,
): ServerCitationEvent | null {
  if (!shouldShowCitations(enabled)) {
    return null;
  }

  return {
    type: AgentEventType.Citation,
    value: text,
  };
}
