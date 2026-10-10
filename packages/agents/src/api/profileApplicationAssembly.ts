/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';

import type {
  Config,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { applyProfileCascade } from '@vybestack/llxprt-code-providers/runtime/profileApplication.js';
import {
  finishProfileApplication,
  type ProfileLoadOptions,
  type ProfileLoadResult,
} from '@vybestack/llxprt-code-providers/runtime/profileSnapshot.js';
import { getActiveModelParams } from '@vybestack/llxprt-code-providers/runtime/providerModelParameters.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-providers/runtime/providerSwitch.js';

import { checkpointProviderTransition } from './providerTransitionCheckpoint.js';
import type { Agent } from './agent.js';
import type { AgentProviderState } from './agentImpl.js';
import type { AgentAuthState } from './control/authState.js';
import { ProfilesControl } from './control/profilesControl.js';

export interface PreparedProfileFacade {
  publish(): void;
  retire(): Promise<void>;
  discard(): Promise<void>;
}

export interface AgentProfileApplication {
  load(name: string): Promise<ProfileLoadResult>;
  applySnapshot(
    profile: Profile,
    options?: ProfileLoadOptions,
  ): Promise<ProfileLoadResult>;
  isApplying(): boolean;
  cancelAndJoin(): Promise<void>;
}

function assembleProfileParameterCommands(owner: SessionSettingsOwner): {
  readEndpoint(): unknown;
  applyParameter(key: string, value: unknown): void;
} {
  return {
    readEndpoint: () => owner.readSelectedEndpoint(),
    applyParameter: (key, value) => owner.writeUserParameter(key, value),
  };
}

export function assembleProfileApplication(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  switchProvider: ProviderSwitcher,
  settingsOwner: SessionSettingsOwner,
  profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
  committed: (
    result: ProfileLoadResult,
    signal: AbortSignal,
  ) => Promise<PreparedProfileFacade | void> = async () => {},
): AgentProfileApplication {
  let installed:
    | Awaited<ReturnType<typeof finishProfileApplication>>
    | undefined;
  return queueProfileApplications(
    profiles,
    async (profile, options, signal) => {
      signal.throwIfAborted();
      const restore = checkpointProviderTransition(
        settingsOwner,
        settings,
        manager,
        oauth?.checkpointRetryHandlers() ?? (() => {}),
      );
      const modelPublication = settingsOwner.beginModelPublication();
      let prepared: Awaited<ReturnType<typeof finishProfileApplication>>;
      let facade: PreparedProfileFacade | void = undefined;
      try {
        const application = await applyProfileCascade(
          profile,
          options,
          config,
          settings,
          manager,
          profiles,
          switchProvider,
          assembleModelSelection(settingsOwner),
          assembleProfileParameterCommands(settingsOwner),
        );
        signal.throwIfAborted();
        prepared = await finishProfileApplication(
          profile,
          options,
          application,
          settings,
          oauth,
          profiles,
          signal,
        );
        signal.throwIfAborted();
        facade = await committed(prepared.result, signal);
        signal.throwIfAborted();
      } catch (error) {
        await rollbackProfilePreparation(error, facade, restore, () =>
          modelPublication.rollback(),
        );
        throw error;
      }
      try {
        return await publishPreparedProfile(
          prepared,
          facade,
          () => modelPublication.commit(),
          () => {
            const previous = installed;
            installed = prepared;
            return previous?.cancelAndJoin() ?? Promise.resolve();
          },
        );
      } finally {
        modelPublication.rollback();
      }
    },
    () => installed?.cancelAndJoin() ?? Promise.resolve(),
  );
}

async function rollbackProfilePreparation(
  error: unknown,
  facade: PreparedProfileFacade | void,
  restore: () => void,
  rollbackPublication: () => void,
): Promise<void> {
  const failures: unknown[] = [error];
  try {
    await facade?.discard();
  } catch (cleanupError) {
    failures.push(cleanupError);
  }
  try {
    restore();
  } catch (restoreError) {
    failures.push(restoreError);
  } finally {
    rollbackPublication();
  }
  if (failures.length > 1)
    throw new AggregateError(failures, 'Profile preparation rollback failed');
}

export class ProfileCommittedError extends AggregateError {
  readonly committed = true;

  constructor(
    errors: unknown[],
    readonly result: ProfileLoadResult,
  ) {
    super(errors, 'Profile committed but publication or retirement failed');
    this.name = 'ProfileCommittedError';
  }
}

async function publishPreparedProfile(
  prepared: Awaited<ReturnType<typeof finishProfileApplication>>,
  facade: PreparedProfileFacade | void,
  publishModel: () => void,
  replaceRenewals: () => Promise<void>,
): Promise<ProfileLoadResult> {
  facade?.publish();
  const failures: unknown[] = [];
  const tasks: Array<Promise<void>> = [];
  for (const publish of [
    replaceRenewals,
    prepared.commit,
    publishModel,
    prepared.publish,
    () => facade?.retire(),
  ]) {
    try {
      tasks.push(
        Promise.resolve(publish()).catch((error: unknown) => {
          failures.push(error);
        }),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  await Promise.all(tasks);
  if (failures.length > 0)
    throw new ProfileCommittedError(failures, prepared.result);
  return prepared.result;
}

function queueProfileApplications(
  profiles: Pick<ProfileDefinitionReads, 'loadProfile'>,
  apply: (
    profile: Profile,
    options: ProfileLoadOptions,
    signal: AbortSignal,
  ) => Promise<ProfileLoadResult>,
  cancelInstalled: () => Promise<void>,
): AgentProfileApplication {
  const controller = new AbortController();
  const signal = controller.signal;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const enqueue = (
    run: () => Promise<ProfileLoadResult>,
  ): Promise<ProfileLoadResult> => {
    pending++;
    const result = tail.then(() => {
      signal.throwIfAborted();
      return run();
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      pending--;
    });
  };

  return {
    isApplying: () => pending > 0,
    cancelAndJoin: async () => {
      controller.abort(
        new Error('Profile preparation cancelled by owner disposal'),
      );
      const results = await Promise.allSettled([tail, cancelInstalled()]);
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Profile cancellation failed');
    },
    load: (name) =>
      enqueue(async () =>
        apply(await profiles.loadProfile(name), { profileName: name }, signal),
      ),
    applySnapshot: (profile, options = {}) => {
      const captured = structuredClone(profile);
      const capturedOptions = { ...options };
      return enqueue(() => apply(captured, capturedOptions, signal));
    },
  };
}

export function assembleAgentProfiles(
  config: Config,
  settings: SettingsService,
  manager: RuntimeProviderManager,
  oauth: OAuthManager | null,
  switchProvider: ProviderSwitcher,
  settingsOwner: SessionSettingsOwner,
  providerState: AgentProviderState,
  authState: AgentAuthState,
  captureProfile: Agent['captureProfile'],
  prepareReplacement: (
    providerChanged: boolean,
    signal: AbortSignal,
  ) => Promise<PreparedProfileFacade>,
  profiles: ProfileDefinitionReads,
): ProfilesControl {
  const readString = (key: string): string | undefined => {
    const value = settingsOwner.readNamedParameter(key);
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };
  return new ProfilesControl({
    getState: () => providerState,
    application: assembleProfileApplication(
      config,
      settings,
      manager,
      oauth,
      (name, options) =>
        switchProvider(name, { ...options, clientReplacement: 'deferred' }),
      settingsOwner,
      profiles,
      async (result, signal) => {
        const modelParams = getActiveModelParams(settings, result.providerName);
        const replacement = await prepareReplacement(
          result.providerChanged,
          signal,
        );
        return {
          publish: () => {
            replacement.publish();
            providerState.provider = result.providerName;
            providerState.model = result.modelName;
            providerState.modelParams = modelParams;
            providerState.baseUrl = result.baseUrl;
            providerState.keyName = readString('auth-key-name');
            providerState.isLoadBalancer =
              result.providerName === 'load-balancer';
            authState.keyFile = readString('auth-keyfile');
            authState.rawKeyPresent = readString('auth-key') !== undefined;
            authState.inlineKeyPresent = false;
            authState.baseUrl = result.baseUrl;
          },
          retire: () => replacement.retire(),
          discard: () => replacement.discard(),
        };
      },
    ),
    captureEphemerals: () => ({ ...settingsOwner.captureUserParameters() }),
    workingDir: config.getTargetDir(),
  });
}
