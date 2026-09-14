/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type {
  CapturedStandardSource,
  ProfileState,
  WorkingProfileIdentity,
} from '../contracts/profileState.js';
import type { ConfiguredProfile } from './reduceModelCommand.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';

type LoadCommand = Extract<ProfileCommand, { kind: 'load' }>;

export type LoadCandidate = Extract<
  ProfileReductionOutcome,
  { kind: 'candidate' }
>;

/**
 * Reduce a `/profile load` command for a configured profile.
 *
 * Loading replaces the whole workspace, so an unsaved draft is a destructive
 * operation. On a configured state whose identity is a draft, and without an explicit
 * discard intent, the outcome is confirmation-required carrying a typed pending
 * token; only a matching `confirm-discard` command, or `discardUnsaved`, lets the
 * load proceed.
 */
export function reduceLoadCommand(
  state: ConfiguredProfile,
  command: LoadCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (!Object.prototype.hasOwnProperty.call(env.repository, command.name)) {
    return {
      kind: 'invalid',
      errors: ['unknown profile'],
      revision: state.revision,
    };
  }
  const discardUnsaved = command.discardUnsaved === true;
  if (state.identity.kind === 'draft' && discardUnsaved === false) {
    return {
      kind: 'confirmation-required',
      pending: {
        token: `discard:load:${command.name}`,
        commandKind: 'load',
        description: `Loading profile ${command.name} will discard unsaved changes to the working profile`,
      },
      revision: state.revision,
    };
  }
  return buildLoadCandidate(state, command.name, env);
}

/**
 * Build a load candidate for `name` from the environment and state.
 *
 * The candidate's document is the repository entry verbatim, its identity is saved
 * against the repository fingerprint, and the revision range is base at the current
 * state revision plus one. On an unconfigured state the base revision is zero. A
 * load-balancer document carries the captured source of its first member as
 * activeMember only when that member appears in `memberCaptures`; a standard
 * document carries no member.
 */
export function buildLoadCandidate(
  state: ProfileState,
  name: string,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  const baseRevision = state.status === 'configured' ? state.revision : 0;
  if (!Object.prototype.hasOwnProperty.call(env.repository, name)) {
    return {
      kind: 'invalid',
      errors: ['unknown profile'],
      revision: baseRevision,
    };
  }
  const repositoryEntry = env.repository[name];
  if (
    repositoryEntry.document.type === 'loadbalancer' &&
    repositoryEntry.document.profiles.length === 0
  ) {
    return {
      kind: 'invalid',
      errors: ['load balancer has no members'],
      revision: baseRevision,
    };
  }
  const identity: WorkingProfileIdentity = {
    kind: 'saved',
    name,
    source: repositoryEntry.fingerprint,
  };
  const activeMember = loadActiveMember(repositoryEntry.document, env);
  return {
    kind: 'candidate',
    document: repositoryEntry.document,
    identity,
    activeMember,
    baseRevision,
    nextRevision: baseRevision + 1,
  };
}

function loadActiveMember(
  document: ProfileDocument,
  env: ProfileReductionEnvironment,
): CapturedStandardSource | undefined {
  if (document.type !== 'loadbalancer') {
    return undefined;
  }
  const first = document.profiles[0];
  return Object.prototype.hasOwnProperty.call(env.memberCaptures, first)
    ? env.memberCaptures[first]
    : undefined;
}
