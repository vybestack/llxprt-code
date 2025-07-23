/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IProvider as Provider,
  IProviderManager as CoreProviderManager,
} from '@vybestack/llxprt-code-core';
import { ProviderManager } from './ProviderManager.js';

/**
 * Adapter that makes the CLI's ProviderManager compatible with the core's ProviderManager interface
 */
export class ProviderManagerAdapter implements CoreProviderManager {
  constructor(private cliProviderManager: ProviderManager) {}

  hasActiveProvider(): boolean {
    return this.cliProviderManager.hasActiveProvider();
  }

  getActiveProvider(): Provider | null {
    return this.cliProviderManager.getActiveProvider();
  }

  getActiveProviderName(): string {
    return this.cliProviderManager.getActiveProviderName();
  }
}
