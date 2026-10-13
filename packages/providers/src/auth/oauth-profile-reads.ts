/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import { createProfileManager } from './profile-utils.js';

export function createOAuthProfileReads(
  directory: string | undefined,
): Pick<ProfileManager, 'loadProfile'> {
  let profiles: ReturnType<typeof createProfileManager> | undefined;
  return {
    loadProfile: async (name) => {
      profiles ??= createProfileManager(directory);
      return (await profiles).loadProfile(name);
    },
  };
}
