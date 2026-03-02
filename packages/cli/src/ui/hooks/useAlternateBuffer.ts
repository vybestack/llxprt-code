/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSettings } from '../contexts/SettingsContext.js';

/**
 * Hook to detect if the terminal is using alternate buffer mode.
 * Reads the user's `ui.useAlternateBuffer` setting, which is the same
 * source of truth used by inkRenderOptions, AppContainer, and
 * DefaultAppLayout to decide whether Ink renders in alternate buffer.
 */
export function useAlternateBuffer(): boolean {
  const settings = useSettings();
  return settings.merged.ui?.useAlternateBuffer === true;
}
