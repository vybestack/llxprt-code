/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { ProfileState } from '../contracts/profileState.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';

type SetupCommand = Extract<ProfileCommand, { kind: 'setup' }>;

/**
 * Reduce a `/setup` command.
 *
 * Setup always starts a blank wizard draft: an empty standard document with no
 * provider, model, parameters, settings, or member. It is valid both from the
 * unconfigured state (base revision zero) and from a configured state (base revision
 * at the current revision).
 */
export function reduceSetupCommand(
  state: ProfileState,
  command: SetupCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  void env;
  if (
    state.status === 'configured' &&
    state.identity.kind === 'draft' &&
    command.discardUnsaved !== true
  ) {
    return {
      kind: 'confirmation-required',
      pending: {
        token: 'discard:setup',
        commandKind: 'setup',
        description:
          'Setup will discard unsaved changes to the working profile',
      },
      revision: state.revision,
    };
  }
  const blank: ProfileDocument = {
    version: 1,
    type: 'standard',
    provider: '',
    model: '',
    modelParams: {},
    ephemeralSettings: {},
  };
  const baseRevision = state.status === 'configured' ? state.revision : 0;
  return {
    kind: 'candidate',
    document: blank,
    identity: { kind: 'draft' },
    baseRevision,
    nextRevision: baseRevision + 1,
  };
}
