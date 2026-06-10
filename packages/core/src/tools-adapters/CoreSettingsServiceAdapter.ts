/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ISettingsService,
  SettingsService as ToolsSettingsService,
} from '@vybestack/llxprt-code-tools';
import type { Config } from '../config/config.js';

export class CoreSettingsServiceAdapter implements ISettingsService {
  constructor(private readonly config: Config) {}

  getSettingsService(): ToolsSettingsService {
    return this.config.getSettingsService() as ToolsSettingsService;
  }

  getSetting(key: string): unknown {
    return this.getSettingsService().get?.(key);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.getSettingsService().set?.(key, value);
  }
}
