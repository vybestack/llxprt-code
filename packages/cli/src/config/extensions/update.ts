/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type ExtensionUpdateAction,
  ExtensionUpdateState,
  type ExtensionUpdateStatus,
} from '../../ui/state/extensions.js';
import {
  copyExtension,
  installOrUpdateExtension,
  loadExtension,
  loadInstallMetadata,
  ExtensionStorage,
  loadExtensionConfig,
  type ExtensionInstallMetadata,
} from '../extension.js';
import { checkForExtensionUpdate } from './github.js';
import type { GeminiCLIExtension } from '@vybestack/llxprt-code-core';
import * as fs from 'node:fs';
import { getErrorMessage } from '../../utils/errors.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

export interface ExtensionUpdateInfo {
  name: string;
  originalVersion: string;
  updatedVersion: string;
}
function setExtensionUpdateState(
  extension: GeminiCLIExtension,
  state: ExtensionUpdateState,
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void,
): void {
  dispatchExtensionStateUpdate({
    type: 'SET_STATE',
    payload: { name: extension.name, state },
  });
}

function validateInstallMetadata(
  extension: GeminiCLIExtension,
  installMetadata: ExtensionInstallMetadata | undefined,
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void,
): ExtensionInstallMetadata {
  if (!installMetadata?.type) {
    setExtensionUpdateState(
      extension,
      ExtensionUpdateState.ERROR,
      dispatchExtensionStateUpdate,
    );
    throw new Error(
      `Extension ${extension.name} cannot be updated, type is unknown.`,
    );
  }
  if (installMetadata.type === 'link') {
    setExtensionUpdateState(
      extension,
      ExtensionUpdateState.UP_TO_DATE,
      dispatchExtensionStateUpdate,
    );
    throw new Error(`Extension is linked so does not need to be updated`);
  }
  return installMetadata;
}

function setExtensionUpdatedState(
  extension: GeminiCLIExtension,
  enableExtensionReloading: boolean | undefined,
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void,
): void {
  setExtensionUpdateState(
    extension,
    enableExtensionReloading === true
      ? ExtensionUpdateState.UPDATED
      : ExtensionUpdateState.UPDATED_NEEDS_RESTART,
    dispatchExtensionStateUpdate,
  );
}

function getUpdatedExtension(
  extension: GeminiCLIExtension,
  cwd: string,
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void,
): GeminiCLIExtension {
  const updatedExtensionStorage = new ExtensionStorage(extension.name);
  const updatedExtension = loadExtension({
    extensionDir: updatedExtensionStorage.getExtensionDir(),
    workspaceDir: cwd,
  });
  if (!updatedExtension) {
    setExtensionUpdateState(
      extension,
      ExtensionUpdateState.ERROR,
      dispatchExtensionStateUpdate,
    );
    throw new Error('Updated extension not found after installation.');
  }
  return updatedExtension;
}

export async function updateExtension(
  extension: GeminiCLIExtension,
  cwd: string = process.cwd(),
  requestConsent: (consent: string) => Promise<boolean>,
  currentState: ExtensionUpdateState,
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void,
  enableExtensionReloading?: boolean,
): Promise<ExtensionUpdateInfo | undefined> {
  if (currentState === ExtensionUpdateState.UPDATING) {
    return undefined;
  }
  setExtensionUpdateState(
    extension,
    ExtensionUpdateState.UPDATING,
    dispatchExtensionStateUpdate,
  );
  const installMetadata = validateInstallMetadata(
    extension,
    loadInstallMetadata(extension.path),
    dispatchExtensionStateUpdate,
  );
  const originalVersion = extension.version;

  const tempDir = await ExtensionStorage.createTmpDir();
  try {
    await copyExtension(extension.path, tempDir);
    const previousExtensionConfig = await loadExtensionConfig({
      extensionDir: extension.path,
      workspaceDir: cwd,
    });
    await installOrUpdateExtension(
      installMetadata,
      requestConsent,
      cwd,
      previousExtensionConfig ?? undefined,
    );

    const updatedExtension = getUpdatedExtension(
      extension,
      cwd,
      dispatchExtensionStateUpdate,
    );
    const updatedVersion = updatedExtension.version;
    setExtensionUpdatedState(
      extension,
      enableExtensionReloading,
      dispatchExtensionStateUpdate,
    );
    return {
      name: extension.name,
      originalVersion,
      updatedVersion,
    };
  } catch (e) {
    debugLogger.error(
      `Error updating extension, rolling back. ${getErrorMessage(e)}`,
    );
    setExtensionUpdateState(
      extension,
      ExtensionUpdateState.ERROR,
      dispatchExtensionStateUpdate,
    );
    await copyExtension(tempDir, extension.path);
    throw e;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export async function updateAllUpdatableExtensions(
  cwd: string = process.cwd(),
  requestConsent: (consent: string) => Promise<boolean>,
  extensions: GeminiCLIExtension[],
  extensionsState: Map<string, ExtensionUpdateStatus>,
  dispatch: (action: ExtensionUpdateAction) => void,
  enableExtensionReloading?: boolean,
): Promise<ExtensionUpdateInfo[]> {
  return (
    await Promise.all(
      extensions
        .filter(
          (extension) =>
            extensionsState.get(extension.name)?.status ===
            ExtensionUpdateState.UPDATE_AVAILABLE,
        )
        .map((extension) =>
          updateExtension(
            extension,
            cwd,
            requestConsent,
            extensionsState.get(extension.name)!.status,
            dispatch,
            enableExtensionReloading,
          ),
        ),
    )
  ).filter((updateInfo) => !!updateInfo);
}

export interface ExtensionUpdateCheckResult {
  state: ExtensionUpdateState;
  error?: string;
}

export async function checkForAllExtensionUpdates(
  extensions: GeminiCLIExtension[],
  dispatch: (action: ExtensionUpdateAction) => void,
  _cwd: string = process.cwd(),
): Promise<void> {
  dispatch({ type: 'BATCH_CHECK_START' });
  try {
    const promises: Array<Promise<void>> = [];
    for (const extension of extensions) {
      if (!extension.installMetadata) {
        dispatch({
          type: 'SET_STATE',
          payload: {
            name: extension.name,
            state: ExtensionUpdateState.NOT_UPDATABLE,
          },
        });
        continue;
      }
      dispatch({
        type: 'SET_STATE',
        payload: {
          name: extension.name,
          state: ExtensionUpdateState.CHECKING_FOR_UPDATES,
        },
      });
      promises.push(
        checkForExtensionUpdate(extension, (state) =>
          dispatch({
            type: 'SET_STATE',
            payload: { name: extension.name, state },
          }),
        ),
      );
    }
    await Promise.all(promises);
  } finally {
    dispatch({ type: 'BATCH_CHECK_END' });
  }
}
