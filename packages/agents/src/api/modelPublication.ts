/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';

const publicationLogger = new DebugLogger('llxprt:model-publication');

/**
 * Runs a model transition inside a model publication window. The change is
 * published relative to `appliedModel`, the last model the transition
 * successfully applied, only after the whole transition succeeds. A thrown
 * transition step closes the window without publishing and the original error
 * propagates unchanged. A failing subscriber does not undo or fail a completed
 * transition; it is reported through the logger. Resolves with the
 * transition's result.
 */
export async function withModelPublication<T>(
  owner: Pick<SessionSettingsOwner, 'beginModelPublication'>,
  appliedModel: string,
  transition: () => Promise<T>,
): Promise<T> {
  const publication = owner.beginModelPublication(appliedModel);
  let outcome: T;
  try {
    outcome = await transition();
  } catch (error) {
    publication.rollback();
    throw error;
  }
  try {
    publication.commit();
  } catch (error) {
    publicationLogger.warn(
      () =>
        `Model change completed but a ModelChanged listener failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
  return outcome;
}

/** The model-transition steps an agent runs, in order, to apply a new model. */
export interface ModelTransitionSteps {
  setOwnerModel(model: string): Promise<unknown>;
  refreshAuth(): Promise<unknown>;
  restoreChatVisibility(): Promise<void>;
  rebuild(): void;
}

/**
 * Applies `model` through `steps` inside a publication window opened relative
 * to the facade's applied model (`state.model`). The facade state records the
 * new model only after every step succeeds, so a failed transition leaves the
 * applied model, and therefore the rollback baseline, untouched.
 */
export function applyModelWithPublication(
  owner: Pick<SessionSettingsOwner, 'beginModelPublication'>,
  state: { model: string },
  model: string,
  steps: ModelTransitionSteps,
): Promise<void> {
  return withModelPublication(owner, state.model, async () => {
    await steps.setOwnerModel(model);
    await steps.refreshAuth();
    await steps.restoreChatVisibility();
    steps.rebuild();
    state.model = model;
  });
}

/**
 * Runs a provider switch so its publication describes the final state. With an
 * explicit `requestedModel` the switch runs deferred inside one publication
 * window opened relative to `appliedModel`, so the target provider default is
 * never published ahead of the requested model; after the window commits, a
 * changed provider announces the model actually in force. Without a requested
 * model the switch publishes for itself, unchanged.
 */
export async function publishProviderSwitch<
  R extends { changed: boolean; nextProvider: string },
>(
  owner: Pick<
    SessionSettingsOwner,
    'beginModelPublication' | 'readSelectedModel'
  >,
  appliedModel: string,
  requestedModel: string | undefined,
  readProfileName: () => string | null,
  runSwitch: (publication: 'deferred' | undefined) => Promise<R>,
): Promise<R> {
  if (requestedModel === undefined) return runSwitch(undefined);
  const result = await withModelPublication(owner, appliedModel, () =>
    runSwitch('deferred'),
  );
  if (result.changed) {
    const model = owner.readSelectedModel() ?? result.nextProvider;
    const profileName = readProfileName();
    try {
      coreEvents.emitModelProfileChanged({
        model,
        providerName: result.nextProvider,
        profileName,
        displayLabel: profileName ?? model,
      });
    } catch (error) {
      publicationLogger.warn(
        () =>
          `Provider switch completed but a ModelProfileChanged listener failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }
  return result;
}
