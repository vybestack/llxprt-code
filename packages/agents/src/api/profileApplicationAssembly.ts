/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from './model-selection.js';

import type {
  ProfileDefinitionReads,
  ProviderSwitcher,
  RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { Profile, SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';
import { applyProfileCascade } from './profileApplication.js';
import {
  finishProfileApplication,
  type ProfileLoadOptions,
  type ProfileLoadResult,
} from './profileSnapshot.js';

import { checkpointProviderTransition } from './providerTransitionCheckpoint.js';

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

type PreparedProfile = Awaited<ReturnType<typeof finishProfileApplication>>;

function requireProfileKeyStorage(
  keys: ProviderKeyStorageLike | undefined,
): ProviderKeyStorageLike {
  if (!keys)
    throw new Error(
      'Profile key resolution requires an explicit credential owner',
    );
  return keys;
}

export function assembleProfileApplication(
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
  assertAdmission: () => void = () => {},
): AgentProfileApplication {
  const keys = requireProfileKeyStorage(manager.getProviderKeys?.());
  let installed: PreparedProfile | undefined;
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
      let prepared: PreparedProfile;
      let facade: PreparedProfileFacade | void = undefined;
      try {
        const application = await applyProfileCascade(
          profile,
          options,
          settings,
          manager,
          profiles,
          switchProvider,
          assembleModelSelection(settingsOwner),
          assembleProfileParameterCommands(settingsOwner),
          (name) => keys.getKey(name),
        );
        signal.throwIfAborted();
        prepared = await finishProfileApplication(
          profile,
          options,
          application,
          settings,
          oauth,
          profiles,
          settingsOwner.publishModelProfile.bind(settingsOwner),
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
    assertAdmission,
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
  assertAdmission: () => void,
): AgentProfileApplication {
  const controller = new AbortController();
  const signal = controller.signal;
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  const enqueue = async (
    run: () => Promise<ProfileLoadResult>,
  ): Promise<ProfileLoadResult> => {
    assertAdmission();
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
