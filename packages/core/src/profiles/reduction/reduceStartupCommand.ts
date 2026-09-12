/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProfileCommand } from '../contracts/profileCommands.js';
import type { ProfileDocument } from '../contracts/profileDocument.js';
import type { ProfileState } from '../contracts/profileState.js';
import type { ProfileReductionOutcome } from './reductionOutcome.js';
import { toDraftIdentity } from './reductionOutcome.js';
import type { ProfileReductionEnvironment } from './reductionEnvironment.js';
import { buildLoadCandidate, type LoadCandidate } from './reduceLoadCommand.js';
import { buildProviderCandidate } from './reduceProviderCommand.js';

type StartupCommand = Extract<ProfileCommand, { kind: 'startup' }>;

/**
 * Reduce a `startup` command.
 *
 * Startup names a profile, a provider, or a model. A blank startup is invalid,
 * provider-with-profile is invalid, and a model alone is invalid. A named profile
 * loads through the repository; a name the repository does not have is invalid. The
 * draft-confirmation rules apply on a configured workspace, and an unconfigured
 * workspace has nothing to discard. A load-balancer profile with a model forks an
 * explicit captured member offering the model. A provider-by-name startup is the
 * blank provider reset, built from the current state so a configured workspace keeps
 * its revision sequence; a model composed with a provider is applied to the provider
 * template and checked against that provider's captured model menu when the
 * environment carries one, and stays unverified when it does not. A model on a
 * loaded standard document patches only the model.
 */
export function reduceStartupCommand(
  state: ProfileState,
  command: StartupCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (
    command.profileName === undefined &&
    command.provider === undefined &&
    command.model === undefined
  ) {
    return invalid(state, 'startup requires a profile, provider, or model');
  }
  if (command.provider !== undefined && command.profileName !== undefined) {
    return invalid(state, 'startup cannot specify both provider and profile');
  }
  if (
    command.model !== undefined &&
    command.provider === undefined &&
    command.profileName === undefined
  ) {
    return invalid(state, 'startup model requires a profile or provider');
  }
  if (command.provider !== undefined) {
    if (
      state.status === 'configured' &&
      state.identity.kind === 'draft' &&
      command.discardUnsaved !== true
    ) {
      return {
        kind: 'confirmation-required',
        pending: {
          token: `discard:startup-provider:${command.provider}`,
          commandKind: 'startup',
          description: `Starting provider ${command.provider} will discard unsaved changes to the working profile`,
        },
        revision: state.revision,
      };
    }
    return reduceStartupProvider(state, command.provider, command.model, env);
  }
  const name = command.profileName;
  if (name === undefined) {
    return invalid(state, 'startup requires a profile, provider, or model');
  }
  return reduceStartupProfile(state, name, command, env);
}

function invalid(state: ProfileState, error: string): ProfileReductionOutcome {
  const revision = state.status === 'configured' ? state.revision : 0;
  return { kind: 'invalid', errors: [error], revision };
}

/**
 * Reduce a provider-name startup, optionally composed with a model.
 *
 * The provider template candidate is built first — with the current state, so a
 * configured workspace advances `revision -> revision + 1` instead of resetting —
 * and an explicit model is then applied to that template. When the environment
 * carries a captured menu for the provider, a model outside it is invalid; without
 * a menu the composite candidate is returned and model support stays unverified for
 * candidate resolution to settle.
 */
function reduceStartupProvider(
  state: ProfileState,
  provider: string,
  model: string | undefined,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  const candidate = buildProviderCandidate(
    provider,
    env,
    state.status === 'configured' ? state : undefined,
  );
  if (candidate.kind !== 'candidate' || model === undefined) {
    return candidate;
  }
  const menuProvider = candidate.document.provider;
  if (
    Object.prototype.hasOwnProperty.call(env.providerModelMenus, menuProvider)
  ) {
    const menu = env.providerModelMenus[menuProvider];
    if (menu.includes(model) === false) {
      return {
        kind: 'invalid',
        errors: ['model must be in the provider menu'],
        revision: candidate.baseRevision,
      };
    }
  }
  const document: ProfileDocument = { ...candidate.document, model };
  return {
    kind: 'candidate',
    document,
    identity: { kind: 'draft' },
    baseRevision: candidate.baseRevision,
    nextRevision: candidate.nextRevision,
  };
}

function reduceStartupProfile(
  state: ProfileState,
  profileName: string,
  command: StartupCommand,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (!Object.prototype.hasOwnProperty.call(env.repository, profileName)) {
    return invalid(state, `unknown profile ${profileName}`);
  }
  if (
    state.status === 'configured' &&
    state.identity.kind === 'draft' &&
    command.discardUnsaved !== true
  ) {
    return {
      kind: 'confirmation-required',
      pending: {
        token: `discard:startup:${profileName}`,
        commandKind: 'startup',
        description: `Loading profile ${profileName} will discard unsaved changes to the working profile`,
      },
      revision: state.revision,
    };
  }
  const loaded = buildLoadCandidate(state, profileName, env);
  if (loaded.kind !== 'candidate') {
    return loaded;
  }
  if (command.model !== undefined) {
    if (loaded.document.type === 'loadbalancer') {
      return forkLoadBalancerModel(
        loaded,
        loaded.document.profiles,
        command.model,
        command.member,
        env,
      );
    }
    return standardForkWithModel(loaded, command.model);
  }
  return {
    kind: 'candidate',
    document: loaded.document,
    identity: loaded.identity,
    ...(loaded.activeMember === undefined
      ? {}
      : { activeMember: loaded.activeMember }),
    baseRevision: loaded.baseRevision,
    nextRevision: loaded.nextRevision,
  };
}

function standardForkWithModel(
  loaded: LoadCandidate,
  model: string,
): ProfileReductionOutcome {
  if (model === loaded.document.model) {
    return loaded;
  }
  const document: ProfileDocument = { ...loaded.document, model };
  return {
    kind: 'candidate',
    document,
    identity: toDraftIdentity(loaded.identity),
    baseRevision: loaded.baseRevision,
    nextRevision: loaded.nextRevision,
  };
}
function forkLoadBalancerModel(
  loaded: LoadCandidate,
  profiles: readonly string[],
  model: string,
  member: string | undefined,
  env: ProfileReductionEnvironment,
): ProfileReductionOutcome {
  if (member === undefined) {
    return {
      kind: 'invalid',
      errors: [
        'startup with a load-balancer profile and model requires an explicit member',
      ],
      revision: loaded.baseRevision,
    };
  }
  if (
    !profiles.includes(member) ||
    !Object.prototype.hasOwnProperty.call(env.memberCaptures, member)
  ) {
    return {
      kind: 'invalid',
      errors: ['unknown member'],
      revision: loaded.baseRevision,
    };
  }
  const captured = env.memberCaptures[member];
  if (captured.models.length === 0) {
    return {
      kind: 'unverified',
      constraints: [`model menu unavailable for provider ${captured.provider}`],
      revision: loaded.baseRevision,
    };
  }
  if (captured.models.includes(model) === false) {
    return {
      kind: 'invalid',
      errors: ['model must be in the member menu'],
      revision: loaded.baseRevision,
    };
  }
  return {
    kind: 'candidate',
    document: { ...captured.sourceDocument, model },
    identity: { kind: 'draft' },
    baseRevision: loaded.baseRevision,
    nextRevision: loaded.nextRevision,
  };
}
