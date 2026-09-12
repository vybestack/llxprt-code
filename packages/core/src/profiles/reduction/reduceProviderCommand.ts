/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

type ProviderCommand = Extract<ProfileCommand, { kind: 'provider' }>;

/**
 * Build a provider candidate from the environment alone.
 *
 * The candidate is the provider template exactly as materialized by the caller, copying
 * nothing from the current document: a blank reset. The base revision comes from the
 * optional state, otherwise zero; startup uses this directly, and a configured
 * `/provider` command passes its own state for the revision range.
 */
export function buildProviderCandidate(
  provider: string,
  env: ProfileReductionEnvironment,
  state?: ConfiguredProfile,
): ProfileReductionOutcome {
  if (!Object.prototype.hasOwnProperty.call(env.providerTemplates, provider)) {
    return {
      kind: 'invalid',
      errors: ['unknown provider template'],
      revision: state === undefined ? 0 : state.revision,
    };
  }
  const document: ProfileDocument = env.providerTemplates[provider];
  const baseRevision = state === undefined ? 0 : state.revision;
  return {
    kind: 'candidate',
    document,
    identity: { kind: 'draft' },
    baseRevision,
    nextRevision: baseRevision + 1,
  };
}

/**
 * Pure reduction of a `/provider` command for a configured profile.
 */
export function reduceProviderCommand(
  state: ConfiguredProfile,
  command: ProviderCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (state.identity.kind === 'draft' && command.discardUnsaved !== true) {
    return {
      kind: 'confirmation-required',
      pending: {
        token: 'discard:provider',
        commandKind: 'provider',
        description:
          'Changing provider will discard unsaved changes to the working profile',
      },
      revision: state.revision,
    };
  }
  return buildProviderCandidate(command.provider, env, state);
}
