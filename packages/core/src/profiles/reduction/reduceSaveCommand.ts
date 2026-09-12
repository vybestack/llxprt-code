/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';

type SaveCommand = Extract<ProfileCommand, { kind: 'save' }>;

/**
 * Reduce a `/profile save` command for a configured profile.
 *
 * Saving names the working document. A command name wins when offered; otherwise an
 * already-saved identity supplies its name, and a draft that was never saved has no
 * name to fall back on. A save that would write the current name back over its own
 * unchanged working document is a no-op. A real save is a `save` outcome that
 * carries the working document and the unchanged revision; the controller persists
 * it through the repository port.
 *
 * The no-op requires the current name to match too: a named draft, or a draft
 * that renames to its source, is the same identity and needs no repository write.
 */
function invalid(
  state: ConfiguredProfile,
  error: string,
): ProfileReductionOutcome {
  return { kind: 'invalid', errors: [error], revision: state.revision };
}

export function reduceSaveCommand(
  state: ConfiguredProfile,
  command: SaveCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  void env;
  const name: string | undefined =
    command.name ??
    (state.identity.kind === 'saved' ? state.identity.name : undefined);
  if (name === undefined) {
    return invalid(state, 'save requires a name for an unsaved draft');
  }
  if (state.identity.kind === 'saved' && name === state.identity.name) {
    return {
      kind: 'no-op',
      reason: 'working profile already saved and unchanged',
      revision: state.revision,
    };
  }
  return {
    kind: 'save',
    name,
    document: state.document,
    revision: state.revision,
  };
}
