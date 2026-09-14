/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { ProfileState } from '../contracts/profileState.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import {
  toDraftIdentity,
  type ProfileReductionOutcome,
} from './reductionOutcome.js';

/**
 * Configured profile state: a workspace with an active document and a revision.
 */
export type ConfiguredProfile = Extract<ProfileState, { status: 'configured' }>;

type ModelCommand = Extract<ProfileCommand, { kind: 'model' }>;

/**
 * Pure reduction of a `/model` command for a configured profile.
 *
 * For a standard active document the result is a structural clone patched with the new model:
 * a no-op when the model is unchanged, otherwise a candidate derived as a draft. For a load
 * balancer the model must name a member whose captured source offers it; the candidate is a
 * standard fork of that member's immutable source document, which drops the load-balancer
 * wrapper. A provider template is never reread here: explicitly pinned values survive into the
 * clone and omitted values resolve later under the new model's defaults.
 */
export function reduceModelCommand(
  state: ConfiguredProfile,
  command: ModelCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  const revision = state.revision;
  if (state.document.type === 'loadbalancer') {
    if (
      command.member !== undefined &&
      !state.document.profiles.includes(command.member)
    ) {
      return { kind: 'invalid', errors: ['unknown member'], revision };
    }
    return reduceLoadBalancerModelCommand(state, command, env, revision);
  }
  return reduceStandardModelCommand(state, command, revision);
}

function reduceStandardModelCommand(
  state: ConfiguredProfile,
  command: ModelCommand,
  revision: number,
): ProfileReductionOutcome {
  if (command.model === state.document.model) {
    return { kind: 'no-op', reason: 'model unchanged', revision };
  }
  const document: ProfileDocument = {
    ...state.document,
    model: command.model,
  };
  return {
    kind: 'candidate',
    document,
    identity: toDraftIdentity(state.identity),
    baseRevision: revision,
    nextRevision: revision + 1,
  };
}

function reduceLoadBalancerModelCommand(
  state: ConfiguredProfile,
  command: ModelCommand,
  env: ProfileReductionEnvironment,
  revision: number,
): ProfileReductionOutcome {
  const explicitMember =
    command.member !== undefined &&
    Object.prototype.hasOwnProperty.call(env.memberCaptures, command.member)
      ? env.memberCaptures[command.member]
      : undefined;
  const captured =
    command.member === undefined ? state.activeMember : explicitMember;
  if (captured === undefined) {
    return {
      kind: 'invalid',
      errors: ['load-balancer model change requires an explicit member'],
      revision,
    };
  }
  if (captured.models.length === 0) {
    return {
      kind: 'unverified',
      constraints: [`model menu unavailable for provider ${captured.provider}`],
      revision,
    };
  }
  if (!captured.models.includes(command.model)) {
    return {
      kind: 'invalid',
      errors: ['model not offered by member provider'],
      revision,
    };
  }
  const document: ProfileDocument = {
    ...captured.sourceDocument,
    model: command.model,
  };
  return {
    kind: 'candidate',
    document,
    identity: toDraftIdentity(state.identity),
    baseRevision: revision,
    nextRevision: revision + 1,
  };
}
