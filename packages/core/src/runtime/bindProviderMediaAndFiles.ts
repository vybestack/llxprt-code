/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestMediaResolutionService } from '../storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from './providerRuntimeContext.js';
import { bindProviderMedia } from './bindProviderMedia.js';
import { bindProviderFiles } from './bindProviderFiles.js';

export function bindProviderMediaAndFiles<T extends object, TLifecycle>(
  provider: T,
  mediaResolver: RequestMediaResolutionService | undefined,
  mediaBudgetBytes: number | undefined,
  fileBindings: ProviderFileBindingStore | undefined,
  fileLifecycle: TLifecycle | undefined,
  workspaceDirectory: string | undefined,
): T {
  return bindProviderFiles(
    bindProviderMedia(provider, mediaResolver, mediaBudgetBytes),
    fileBindings,
    fileLifecycle,
    workspaceDirectory,
  );
}
