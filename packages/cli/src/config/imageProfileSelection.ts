/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ImageOperationBackendResolver,
  ImageProfileRuntimeState,
} from '@vybestack/llxprt-code-core';
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import {
  createCodexImageBackendResolver,
  type CodexImageBackendResolverDeps,
} from '@vybestack/llxprt-code-providers';
import { loadAndSelectImageProfile } from '@vybestack/llxprt-code-providers/runtime.js';
import { isImageModeActive, type ImageModeFlags } from './imageMode.js';
import type { ProfileLoadResult } from './profileResolution.js';

/** Apply file-profile selection after bootstrap; standalone CLI selection wins. */
export async function applyStartupImageProfile(
  flags: ImageModeFlags,
  manager: ProfileManager,
  state: ImageProfileRuntimeState,
  fileProfile: Pick<ProfileLoadResult, 'activeImageProfile'> = {},
): Promise<void> {
  const name = flags.imageProfile?.trim();
  if (name && !isImageModeActive(flags)) {
    await loadAndSelectImageProfile(manager, state, name);
  } else if ('activeImageProfile' in fileProfile) {
    if (fileProfile.activeImageProfile === undefined) {
      state.reset();
    } else {
      state.select(fileProfile.activeImageProfile);
    }
  }
}

/** Resolve saved per-operation overrides without changing runtime selection. */
export function createImageProfileOperationResolver(
  manager: ProfileManager,
  state: ImageProfileRuntimeState,
  deps: Omit<CodexImageBackendResolverDeps, 'getActiveImageProfile'>,
): ImageOperationBackendResolver {
  return async (name) => {
    const profile =
      name === undefined
        ? state.getActive()?.profile
        : await manager.loadImageProfile(name);
    return createCodexImageBackendResolver({
      ...deps,
      getActiveImageProfile: () => profile,
    })();
  };
}
