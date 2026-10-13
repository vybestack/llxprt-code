/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProfileManager } from '@vybestack/llxprt-code-settings';
import { createOAuthProfileReads } from './oauth-profile-reads.js';

export interface PreflightOAuthProfileReads
  extends Pick<ProfileManager, 'loadProfile'> {
  attachProfileDirectory(directory: string | undefined): void;
}

type ProfileReadPhase =
  | { readonly kind: 'pre-config' }
  | {
      readonly kind: 'attached';
      readonly reads: Pick<ProfileManager, 'loadProfile'>;
    };

export function createPreflightOAuthProfileReads(): PreflightOAuthProfileReads {
  let phase: ProfileReadPhase = { kind: 'pre-config' };
  return {
    loadProfile: async (name) => {
      if (phase.kind === 'pre-config')
        throw new Error(
          'OAuth profile reads require Config attachment; current phase: pre-config',
        );
      return phase.reads.loadProfile(name);
    },
    attachProfileDirectory: (directory) => {
      if (phase.kind === 'attached')
        throw new Error(
          'OAuth profile repository is already attached; current phase: attached',
        );
      phase = { kind: 'attached', reads: createOAuthProfileReads(directory) };
    },
  };
}
