/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '../../utils/errors.js';
import {
  ExtensionUpdateState,
  extensionUpdatesReducer,
  initialExtensionUpdatesState,
} from '../state/extensions.js';
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { MessageType, type ConfirmationRequest } from '../types.js';
import {
  checkForAllExtensionUpdates,
  updateExtension,
} from '../../config/extensions/update.js';
import {
  requestConsentInteractive,
  type ExtensionUpdateInfo,
} from '../../config/extension.js';
import { checkExhaustive } from '../../utils/checks.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

type ConfirmationRequestWrapper = {
  prompt: React.ReactNode;
  onConfirm: (confirmed: boolean) => void;
};

type ConfirmationRequestAction =
  | { type: 'add'; request: ConfirmationRequestWrapper }
  | { type: 'remove'; request: ConfirmationRequestWrapper };

function confirmationRequestsReducer(
  state: ConfirmationRequestWrapper[],
  action: ConfirmationRequestAction,
): ConfirmationRequestWrapper[] {
  switch (action.type) {
    case 'add':
      return [...state, action.request];
    case 'remove':
      return state.filter((r) => r !== action.request);
    default:
      checkExhaustive(action);
  }
}

export const useExtensionUpdates = (
  extensions: GeminiCLIExtension[],
  addItem: UseHistoryManagerReturn['addItem'],
  cwd: string,
) => {
  const [extensionsUpdateState, dispatchExtensionStateUpdate] = useReducer(
    extensionUpdatesReducer,
    initialExtensionUpdatesState,
  );
  const [
    confirmUpdateExtensionRequests,
    dispatchConfirmUpdateExtensionRequests,
  ] = useReducer(confirmationRequestsReducer, []);
  const addConfirmUpdateExtensionRequest = useCallback(
    (original: ConfirmationRequest) => {
      const wrappedRequest = {
        prompt: original.prompt,
        onConfirm: (confirmed: boolean) => {
          // Remove it from the outstanding list of requests by identity.
          dispatchConfirmUpdateExtensionRequests({
            type: 'remove',
            request: wrappedRequest,
          });
          original.onConfirm(confirmed);
        },
      };
      dispatchConfirmUpdateExtensionRequests({
        type: 'add',
        request: wrappedRequest,
      });
    },
    [dispatchConfirmUpdateExtensionRequests],
  );

  useEffect(() => {
    const extensionsToCheck = extensions.filter((extension) => {
      const currentStatus = extensionsUpdateState.extensionStatuses.get(
        extension.name,
      );
      if (!currentStatus) return true;
      const currentState = currentStatus.status;
      return currentState === ExtensionUpdateState.UNKNOWN;
    });
    if (extensionsToCheck.length === 0) return;
    void checkForAllExtensionUpdates(
      extensionsToCheck,
      dispatchExtensionStateUpdate,
      cwd,
    );
  }, [
    extensions,
    extensionsUpdateState.extensionStatuses,
    cwd,
    dispatchExtensionStateUpdate,
  ]);

  useEffect(() => {
    if (extensionsUpdateState.batchChecksInProgress > 0) {
      return;
    }
    const scheduledUpdate = extensionsUpdateState.scheduledUpdate;
    if (scheduledUpdate) {
      dispatchExtensionStateUpdate({
        type: 'CLEAR_SCHEDULED_UPDATE',
      });
    }

    function shouldDoUpdate(extension: GeminiCLIExtension): boolean {
      if (scheduledUpdate) {
        if (scheduledUpdate.all) {
          return true;
        }
        return scheduledUpdate.names?.includes(extension.name) === true;
      }
      return extension.installMetadata?.autoUpdate === true;
    }

    const pendingUpdates: string[] = [];
    const updatePromises: Array<Promise<ExtensionUpdateInfo | undefined>> = [];
    for (const extension of extensions) {
      const currentState = extensionsUpdateState.extensionStatuses.get(
        extension.name,
      );
      if (
        !currentState ||
        currentState.status !== ExtensionUpdateState.UPDATE_AVAILABLE
      ) {
        continue;
      }
      const shouldUpdate = shouldDoUpdate(extension);
      if (!shouldUpdate) {
        pendingUpdates.push(extension.name);
        if (!currentState.notified) {
          // Mark as processed immediately to avoid re-triggering.
          dispatchExtensionStateUpdate({
            type: 'SET_NOTIFIED',
            payload: { name: extension.name, notified: true },
          });
        }
      } else {
        const updatePromise = updateExtension(
          extension,
          cwd,
          (description) =>
            requestConsentInteractive(
              description,
              addConfirmUpdateExtensionRequest,
            ),
          currentState.status,
          dispatchExtensionStateUpdate,
        );
        updatePromises.push(updatePromise);
        updatePromise
          .then((result) => {
            if (!result) return;
            addItem(
              {
                type: MessageType.INFO,
                text: `Extension "${extension.name}" successfully updated: ${result.originalVersion} → ${result.updatedVersion}.`,
              },
              Date.now(),
            );
          })
          .catch((error) => {
            addItem(
              {
                type: MessageType.ERROR,
                text: getErrorMessage(error),
              },
              Date.now(),
            );
          });
      }
    }
    if (pendingUpdates.length > 0) {
      const s = pendingUpdates.length > 1 ? 's' : '';
      addItem(
        {
          type: MessageType.INFO,
          text: `You have ${pendingUpdates.length} extension${s} with an update available. Run "/extensions update ${pendingUpdates.join(' ')}".`,
        },
        Date.now(),
      );
    }
    if (scheduledUpdate) {
      void Promise.allSettled(updatePromises).then((results) => {
        const nonNullResults = results
          .filter(
            (result) => result.status === 'fulfilled' && result.value != null,
          )
          .map(
            (result) =>
              (result as PromiseFulfilledResult<ExtensionUpdateInfo>).value,
          );
        scheduledUpdate.onCompleteCallbacks.forEach((callback) => {
          try {
            callback(nonNullResults);
          } catch (e) {
            debugLogger.error(getErrorMessage(e));
          }
        });
      });
    }
  }, [
    extensions,
    extensionsUpdateState,
    addConfirmUpdateExtensionRequest,
    addItem,
    cwd,
  ]);

  const extensionsUpdateStateComputed = useMemo(() => {
    const result = new Map<string, ExtensionUpdateState>();
    for (const [
      key,
      value,
    ] of extensionsUpdateState.extensionStatuses.entries()) {
      result.set(key, value.status);
    }
    return result;
  }, [extensionsUpdateState]);

  return {
    extensionsUpdateState: extensionsUpdateStateComputed,
    extensionsUpdateStateInternal: extensionsUpdateState.extensionStatuses,
    dispatchExtensionStateUpdate,
    confirmUpdateExtensionRequests,
    addConfirmUpdateExtensionRequest,
  };
};
