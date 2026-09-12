/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Save route for the agents-side profile controller.
 *
 * Persists the working document under `name` through the repository port. When the save
 * targets the identity's own saved name, the route hands the repository the source
 * fingerprint as the optimistic-concurrency anchor so an outside edit to the underlying
 * file surfaces as a conflict instead of being silently overwritten. Any other save is a
 * save-as: the route stats the destination first and refuses — with a typed
 * `destination-exists` conflict, workspace untouched — rather than overwriting an
 * existing profile. On success the state stays configured at the same revision and
 * document, now bound to the freshly saved fingerprint.
 */

import {
  buildRedactedSnapshot,
  ProfileRepositoryConflictError,
  type ProfileCommandResult,
  type ProfileDocument,
  type ProfileState,
  type SourceFingerprint,
} from '@vybestack/llxprt-code-core';
import type { ProfileControllerDeps } from './controllerTypes.js';

/**
 * Outcome of the save route: the command result plus the state the workspace moves to.
 */
export interface SaveRouteOutcome {
  result: ProfileCommandResult;
  newState: ProfileState;
}

/**
 * The fingerprint to anchor the write with, when the save targets the identity's own
 * saved name. A save-as never anchors on the source: the source fingerprint belongs to
 * a different file.
 */
function expectedFingerprint(
  state: ProfileState,
  name: string,
): SourceFingerprint | undefined {
  if (state.status !== 'configured') {
    return undefined;
  }
  const source =
    state.identity.kind === 'saved'
      ? state.identity
      : state.identity.derivedFrom;
  return source?.name === name ? source.source : undefined;
}

function saveGuard(
  state: ProfileState,
  revision: number,
  isClosed: () => boolean,
  signal?: AbortSignal,
): SaveRouteOutcome | undefined {
  if (signal?.aborted === true) {
    return {
      result: { kind: 'cancelled', reason: 'execute cancelled', revision },
      newState: state,
    };
  }
  if (isClosed()) {
    return {
      result: { kind: 'failed', error: 'controller disposed', revision },
      newState: state,
    };
  }
  return undefined;
}

/**
 * Execute a save of the working document.
 *
 * Saving over the identity's own name anchors the write with its source fingerprint; any
 * other save (a rename, or a draft's first save) is a create: the destination is statted
 * first, and an existing destination yields a `destination-exists` conflict without
 * touching the workspace. When the repository detects the persisted file changed under
 * the expected fingerprint it throws a conflict error, which becomes a `source-changed`
 * conflict result.
 */
export async function executeSaveRoute(
  state: ProfileState,
  name: string,
  document: ProfileDocument,
  revision: number,
  deps: ProfileControllerDeps,
  isClosed: () => boolean,
  signal?: AbortSignal,
): Promise<SaveRouteOutcome> {
  const guard = (): SaveRouteOutcome | undefined =>
    saveGuard(state, revision, isClosed, signal);
  const beforeSave = guard();
  if (beforeSave !== undefined) {
    return beforeSave;
  }
  const expectedFp = expectedFingerprint(state, name);

  if (expectedFp === undefined) {
    const existing = await deps.repository.stat(name);
    const afterStat = guard();
    if (afterStat !== undefined) {
      return afterStat;
    }
    if (existing !== null) {
      return {
        result: { kind: 'conflict', cause: 'destination-exists', revision },
        newState: state,
      };
    }
  }

  let newFp: SourceFingerprint;
  try {
    newFp = await deps.repository.save(name, document, expectedFp, {
      mustCreate: expectedFp === undefined,
    });
  } catch (error) {
    const stopped = guard();
    if (stopped !== undefined) {
      return stopped;
    }
    if (error instanceof ProfileRepositoryConflictError) {
      return {
        result: {
          kind: 'conflict',
          cause:
            expectedFp === undefined ? 'destination-exists' : 'source-changed',
          revision,
        },
        newState: state,
      };
    }
    throw error;
  }
  const persisted = await deps.repository.stat(name);
  const newState: ProfileState = {
    status: 'configured',
    revision,
    identity:
      persisted === null
        ? { kind: 'draft', derivedFrom: { name, source: newFp } }
        : { kind: 'saved', name, source: persisted },
    document,
    ...(state.status === 'configured' && state.activeMember !== undefined
      ? { activeMember: state.activeMember }
      : {}),
  };

  const afterSave = saveGuard(newState, revision, isClosed, signal);
  if (afterSave !== undefined) {
    return afterSave;
  }

  return {
    result: {
      kind: 'committed',
      revision,
      snapshot: buildRedactedSnapshot(newState),
    },
    newState,
  };
}
