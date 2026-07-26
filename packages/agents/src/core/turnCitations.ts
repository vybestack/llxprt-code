/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Citation gating helpers extracted from core/turn.ts.
 *
 * Citations are shown only when the settings flag is set or the user's code
 * assist tier is above FREE. Extracted as pure functions over the config so
 * the gating logic is testable without a full Turn instance.
 */

import { getCodeAssistServer } from '@vybestack/llxprt-code-core/code_assist/codeAssist.js';
import { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import {
  AgentEventType,
  type ServerCitationEvent,
} from '@vybestack/llxprt-code-core/core/turn.js';

interface ConfigWithSettings {
  getSettingsService(): { get(key: string): unknown } | undefined;
}

/**
 * Check if citations should be shown for the current user/settings.
 * Based on the upstream implementation from commit 997136ae.
 */
export function shouldShowCitations(config: unknown): boolean {
  try {
    const typedConfig = config as ConfigWithSettings | undefined;
    const settingsService = typedConfig?.getSettingsService();
    if (settingsService) {
      const enabled = settingsService.get('ui.showCitations');
      if (enabled !== undefined) {
        return enabled as boolean;
      }
    }

    // Fallback: check user tier for code assist server
    const server = getCodeAssistServer(config as never);
    return (server && server.userTier !== UserTierId.FREE) ?? false;
  } catch {
    return false;
  }
}

/**
 * Builds a citation event with the given text, or returns null when
 * citations are disabled. Integrates with llxprt's provider abstraction to
 * work across all providers.
 */
export function buildCitationEvent(
  config: unknown,
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
