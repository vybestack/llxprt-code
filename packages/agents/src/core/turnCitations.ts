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

interface ConfigWithSettings {
  getSettingsService(): { get(key: string): unknown } | undefined;
}

export function shouldShowCitations(
  config: ConfigWithSettings | undefined,
): boolean {
  return config?.getSettingsService()?.get('ui.showCitations') === true;
}

export function buildCitationEvent(
  config: ConfigWithSettings | undefined,
  text: string,
): ServerCitationEvent | null {
  if (!shouldShowCitations(config)) {
    return null;
  }

  return {
    type: AgentEventType.Citation,
    value: text,
  };
}
