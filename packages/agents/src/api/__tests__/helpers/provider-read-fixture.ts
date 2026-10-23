/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionProviderOwner } from '../../session-provider-reads.js';

export class ProviderReadFixture extends SessionProviderOwner {
  constructor(
    selection: SessionSettingsOwner,
    manager: RuntimeProviderManager,
    readConfiguredModel: () => string,
    readProviderSettings: (provider: string) => Record<string, unknown>,
  ) {
    super();
    this.facadeSettingsOwner = selection;
    this.facadeProviderManager = manager;
    this.readConfiguredModel = readConfiguredModel;
    this.readProviderSettings = readProviderSettings;
    this.initializeProviderReads();
  }

  getActiveProviderName(): string {
    return this.readProviderName();
  }

  listProviders(): string[] {
    return this.readProviderNames();
  }

  listAvailableModels(
    provider?: string,
  ): ReturnType<RuntimeProviderManager['getAvailableModels']> {
    return this.readAvailableModels(provider);
  }

  protected rebuild(): never {
    throw new Error('Provider read fixture does not compose model execution');
  }
}
