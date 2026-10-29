/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LoadedSettings, type Settings } from '../config/settings.js';

export function createLoadedSettings(settings: Settings = {}): LoadedSettings {
  const file = { settings: {}, path: '/test/settings.json' };
  return new LoadedSettings(file, file, { ...file, settings }, file, true);
}
