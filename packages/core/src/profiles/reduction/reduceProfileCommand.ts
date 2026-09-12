/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileState } from '../contracts/profileState.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';
import { reduceModelCommand } from './reduceModelCommand.js';
import { reduceProviderCommand } from './reduceProviderCommand.js';
import { reduceLoadCommand } from './reduceLoadCommand.js';
import { reduceSetupCommand } from './reduceSetupCommand.js';
import { reduceSetCommand } from './reduceSetCommand.js';
import { reduceSaveCommand } from './reduceSaveCommand.js';
import { reduceStartupCommand } from './reduceStartupCommand.js';

type ConfiguredState = Extract<ProfileState, { status: 'configured' }>;
type ConfirmDiscardCommand = Extract<
  ProfileCommand,
  { kind: 'confirm-discard' }
>;

/**
 * Pure literal reduction of a profile command against the current workspace state.
 *
 * Every branch is pure: it reads only `state`, `command`, and `env`, and returns
 * an outcome with no I/O. The revision gate runs first so a command aimed at a stale
 * workspace is rejected before any kind-specific work. `setup` and `startup` are
 * valid from the unconfigured workspace; every other kind needs a configured one.
 */
export function reduceProfileCommand(
  state: ProfileState,
  command: ProfileCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (state.status === 'configured') {
    if (command.expectedRevision !== state.revision) {
      return {
        kind: 'stale',
        expectedRevision: command.expectedRevision,
        currentRevision: state.revision,
      };
    }
    return reduceConfiguredCommand(state, command, env);
  }
  return reduceUnconfiguredCommand(command, env);
}

function reduceUnconfiguredCommand(
  command: ProfileCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (command.expectedRevision !== 0) {
    return {
      kind: 'stale',
      expectedRevision: command.expectedRevision,
      currentRevision: 0,
    };
  }
  if (command.kind === 'setup') {
    return reduceSetupCommand({ status: 'unconfigured' }, command, env);
  }
  if (command.kind === 'startup') {
    return reduceStartupCommand({ status: 'unconfigured' }, command, env);
  }
  return {
    kind: 'invalid',
    errors: ['command requires a configured profile'],
    revision: 0,
  };
}

function reduceConfiguredCommand(
  state: ConfiguredState,
  command: ProfileCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  switch (command.kind) {
    case 'model':
      return reduceModelCommand(state, command, env);
    case 'provider':
      return reduceProviderCommand(state, command, env);
    case 'load':
      return reduceLoadCommand(state, command, env);
    case 'setup':
      return reduceSetupCommand(state, command, env);
    case 'set':
      return reduceSetCommand(state, command, env);
    case 'save':
      return reduceSaveCommand(state, command, env);
    case 'startup':
      return reduceStartupCommand(state, command, env);
    case 'confirm-discard':
      return reduceConfirmDiscard(state, command);
    default: {
      const unhandled: never = command;
      throw new Error(
        `Unhandled profile command kind: ${String(unhandled)} (reduction)`,
      );
    }
  }
}

function reduceConfirmDiscard(
  state: ConfiguredState,
  command: ConfirmDiscardCommand,
): ProfileReductionOutcome {
  if (command.pending.token.length === 0) {
    return {
      kind: 'invalid',
      errors: ['pending confirmation token must be non-empty'],
      revision: state.revision,
    };
  }
  return { kind: 'discard-authorized', revision: state.revision };
}
