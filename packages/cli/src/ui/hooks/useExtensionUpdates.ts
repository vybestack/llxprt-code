/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import { getErrorMessage } from '../../utils/errors.js';
import {
  ExtensionUpdateState,
  type ExtensionUpdateAction,
  type ScheduledUpdate,
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

function shouldDoUpdate(
  extension: GeminiCLIExtension,
  scheduledUpdate?: ScheduledUpdate | null,
): boolean {
  if (scheduledUpdate !== undefined && scheduledUpdate !== null) {
    if (scheduledUpdate.all === true) {
      return true;
    }
    return scheduledUpdate.names?.includes(extension.name) === true;
  }
  return extension.installMetadata?.autoUpdate === true;
}

function processExtensionUpdate(
  extension: GeminiCLIExtension,
  cwd: string,
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void,
  currentState: { status: ExtensionUpdateState; notified?: boolean },
  dispatchExtensionStateUpdate: React.Dispatch<ExtensionUpdateAction>,
  addItem: UseHistoryManagerReturn['addItem'],
): Promise<ExtensionUpdateInfo | undefined> {
  const updatePromise = updateExtension(
    extension,
    cwd,
    (description) =>
      requestConsentInteractive(description, addConfirmUpdateExtensionRequest),
    currentState.status,
    dispatchExtensionStateUpdate,
  );

  updatePromise
    .then((result) => {
      if (result === undefined) return;
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

  return updatePromise;
}

function notifyPendingUpdates(
  pendingUpdates: string[],
  addItem: UseHistoryManagerReturn['addItem'],
): void {
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
}

async function processScheduledUpdateCallbacks(
  updatePromises: Array<Promise<ExtensionUpdateInfo | undefined>>,
  scheduledUpdate: {
    onCompleteCallbacks: Array<(results: ExtensionUpdateInfo[]) => void>;
  },
): Promise<void> {
  const results = await Promise.allSettled(updatePromises);
  const nonNullResults = results
    .filter(
      (result) => result.status === 'fulfilled' && result.value !== undefined,
    )
    .map(
      (result) => (result as PromiseFulfilledResult<ExtensionUpdateInfo>).value,
    );
  scheduledUpdate.onCompleteCallbacks.forEach((callback) => {
    try {
      callback(nonNullResults);
    } catch (e) {
      debugLogger.error(getErrorMessage(e));
    }
  });
}

interface ProcessedUpdates {
  pendingUpdates: string[];
  updatePromises: Array<Promise<ExtensionUpdateInfo | undefined>>;
}

function processExtensions(
  extensions: GeminiCLIExtension[],
  extensionStatuses: Map<
    string,
    { status: ExtensionUpdateState; notified?: boolean }
  >,
  scheduledUpdate: ScheduledUpdate | null | undefined,
  cwd: string,
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void,
  dispatchExtensionStateUpdate: React.Dispatch<ExtensionUpdateAction>,
  addItem: UseHistoryManagerReturn['addItem'],
): ProcessedUpdates {
  const pendingUpdates: string[] = [];
  const updatePromises: Array<Promise<ExtensionUpdateInfo | undefined>> = [];

  for (const extension of extensions) {
    const currentState = extensionStatuses.get(extension.name);
    if (
      currentState === undefined ||
      currentState.status !== ExtensionUpdateState.UPDATE_AVAILABLE
    ) {
      continue;
    }
    const shouldUpdate = shouldDoUpdate(extension, scheduledUpdate);
    if (!shouldUpdate) {
      pendingUpdates.push(extension.name);
      if (currentState.notified !== true) {
        dispatchExtensionStateUpdate({
          type: 'SET_NOTIFIED',
          payload: { name: extension.name, notified: true },
        });
      }
    } else {
      const updatePromise = processExtensionUpdate(
        extension,
        cwd,
        addConfirmUpdateExtensionRequest,
        currentState,
        dispatchExtensionStateUpdate,
        addItem,
      );
      updatePromises.push(updatePromise);
    }
  }

  return { pendingUpdates, updatePromises };
}

function useCheckForUpdates(
  extensions: GeminiCLIExtension[],
  extensionStatuses: Map<
    string,
    { status: ExtensionUpdateState; notified?: boolean }
  >,
  cwd: string,
  dispatchExtensionStateUpdate: React.Dispatch<ExtensionUpdateAction>,
): void {
  useEffect(() => {
    const extensionsToCheck = extensions.filter((extension) => {
      const currentStatus = extensionStatuses.get(extension.name);
      if (currentStatus === undefined) return true;
      return currentStatus.status === ExtensionUpdateState.UNKNOWN;
    });
    if (extensionsToCheck.length === 0) return;
    void checkForAllExtensionUpdates(
      extensionsToCheck,
      dispatchExtensionStateUpdate,
      cwd,
    );
  }, [extensions, extensionStatuses, cwd, dispatchExtensionStateUpdate]);
}

function useProcessUpdates(
  extensions: GeminiCLIExtension[],
  batchChecksInProgress: number,
  extensionStatuses: Map<
    string,
    { status: ExtensionUpdateState; notified?: boolean }
  >,
  scheduledUpdate: ScheduledUpdate | null,
  cwd: string,
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void,
  dispatchExtensionStateUpdate: React.Dispatch<ExtensionUpdateAction>,
  addItem: UseHistoryManagerReturn['addItem'],
): void {
  useEffect(() => {
    if (batchChecksInProgress > 0) {
      return;
    }

    if (scheduledUpdate != null) {
      dispatchExtensionStateUpdate({
        type: 'CLEAR_SCHEDULED_UPDATE',
      });
    }

    const { pendingUpdates, updatePromises } = processExtensions(
      extensions,
      extensionStatuses,
      scheduledUpdate,
      cwd,
      addConfirmUpdateExtensionRequest,
      dispatchExtensionStateUpdate,
      addItem,
    );

    notifyPendingUpdates(pendingUpdates, addItem);

    if (scheduledUpdate != null) {
      void processScheduledUpdateCallbacks(updatePromises, scheduledUpdate);
    }
  }, [
    extensions,
    batchChecksInProgress,
    extensionStatuses,
    scheduledUpdate,
    cwd,
    addConfirmUpdateExtensionRequest,
    dispatchExtensionStateUpdate,
    addItem,
  ]);
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

  useCheckForUpdates(
    extensions,
    extensionsUpdateState.extensionStatuses,
    cwd,
    dispatchExtensionStateUpdate,
  );

  useProcessUpdates(
    extensions,
    extensionsUpdateState.batchChecksInProgress,
    extensionsUpdateState.extensionStatuses,
    extensionsUpdateState.scheduledUpdate,
    cwd,
    addConfirmUpdateExtensionRequest,
    dispatchExtensionStateUpdate,
    addItem,
  );

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
