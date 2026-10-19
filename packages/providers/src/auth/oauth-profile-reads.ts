/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileManager } from '@vybestack/llxprt-code-settings/profiles/ProfileManager.js';
import type { Profile } from '@vybestack/llxprt-code-settings/profiles/types.js';

export interface OAuthProfileReads {
  loadProfile(name: string): Promise<Profile>;
}

export function createOAuthProfileReads(
  directory: string | undefined,
): OAuthProfileReads {
  let profiles: Promise<ProfileManager> | undefined;
  return {
    loadProfile: async (name) => {
      profiles ??= import(
        '@vybestack/llxprt-code-settings/profiles/ProfileManager.js'
      )
        .then(({ ProfileManager }) => new ProfileManager(directory))
        .catch((error: unknown) => {
          profiles = undefined;
          throw error;
        });
      return (await profiles).loadProfile(name);
    },
  };
}
