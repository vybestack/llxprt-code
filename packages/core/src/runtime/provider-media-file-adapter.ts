/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestMediaResolutionService } from '../storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from './providerRuntimeContext.js';
import { bindProviderMediaAndFiles } from './bindProviderMediaAndFiles.js';

export abstract class ProviderMediaFileAdapter {
  protected requestMediaResolver?: RequestMediaResolutionService;
  protected requestMediaBudgetBytes?: number;
  protected requestProviderFileBindings?: ProviderFileBindingStore;
  protected requestProviderFileLifecycle?: object;
  protected requestWorkspaceDirectory?: string;

  protected bindDelegateProvider<T extends object>(provider: T): T {
    return bindProviderMediaAndFiles(
      provider,
      this.requestMediaResolver,
      this.requestMediaBudgetBytes,
      this.requestProviderFileBindings,
      this.requestProviderFileLifecycle,
      this.requestWorkspaceDirectory,
    );
  }
}
