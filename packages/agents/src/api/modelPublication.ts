/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

const publicationLogger = new DebugLogger('llxprt:model-publication');

/**
 * Runs a model transition inside a model publication window. The change is
 * published relative to `appliedModel`, the last model the transition
 * successfully applied, only after the whole transition succeeds. A thrown
 * transition step closes the window without publishing and the original error
 * propagates unchanged. A failing subscriber does not undo or fail a completed
 * transition; it is reported through the logger.
 */
export async function withModelPublication(
  owner: Pick<SessionSettingsOwner, 'beginModelPublication'>,
  appliedModel: string,
  transition: () => Promise<void>,
): Promise<void> {
  const publication = owner.beginModelPublication(appliedModel);
  try {
    await transition();
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
