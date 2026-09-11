/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ImageProfile } from '@vybestack/llxprt-code-settings';

export interface ActiveImageProfile {
  readonly name: string;
  readonly profile: ImageProfile;
}

export interface ImageProfileRuntimeState {
  getActive(): ActiveImageProfile | undefined;
  select(activeProfile: ActiveImageProfile): void;
  reset(): void;
}

export function createImageProfileRuntimeState(): ImageProfileRuntimeState {
  let activeProfile: ActiveImageProfile | undefined;

  return {
    getActive: () => activeProfile,
    select: (selection) => {
      activeProfile = selection;
    },
    reset: () => {
      activeProfile = undefined;
    },
  };
}
