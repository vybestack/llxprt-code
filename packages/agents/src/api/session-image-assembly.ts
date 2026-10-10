/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { RuntimeProviderManager } from '@vybestack/llxprt-code-core';
import type { ImageOperationRunner } from '@vybestack/llxprt-code-core/services/image/imageCapability.js';
import { runImageOperation } from '@vybestack/llxprt-code-core/services/image/imageOperationDispatch.js';
import { createCodexImageBackendResolver } from '@vybestack/llxprt-code-providers';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { admittedEndpoint } from '../core/admittedRouteSecurity.js';
import type { SessionClientOwner } from '../session/session-client-owner.js';

export interface SessionImageSelection {
  readonly imageOperation?:
    | { readonly run: ImageOperationRunner; readonly ownership?: 'caller' }
    | {
        readonly run: ImageOperationRunner;
        readonly ownership: 'agent';
        readonly dispose?: () => Promise<void>;
      };
}

export function assembleSessionImages(
  client: SessionClientOwner,
  workspaceRoot: string,
  manager: RuntimeProviderManager,
  oauthManager: OAuthManager | undefined,
  settings: SettingsService,
  selection?: SessionImageSelection['imageOperation'],
): void {
  if (client.hasImageComposition()) {
    if (selection !== undefined)
      throw new Error(
        'Preflight image operation cannot be replaced during adoption',
      );
    return;
  }
  if (selection !== undefined) {
    client.bindImageOperation(
      selection.run,
      selection.ownership === 'agent' ? selection.dispose : undefined,
    );
    return;
  }
  const resolveBackend = createCodexImageBackendResolver({
    oauthManager,
    getActiveProvider: () => manager.getActiveProvider(),
    getBaseUrl: () => {
      const providerName = manager.getActiveProviderName();
      return providerName === undefined
        ? undefined
        : admittedEndpoint(settings, providerName);
    },
  });
  client.bindImageOperation((input) => {
    const backend = resolveBackend();
    return runImageOperation(input, {
      workspaceRoot,
      resolveBackend: () => backend,
    });
  });
}

export function prepareImageConstruction(
  selection: SessionImageSelection['imageOperation'],
): {
  readonly selection: SessionImageSelection['imageOperation'];
  cleanupFailedConstruction(): Promise<void>;
} {
  const release =
    selection?.ownership === 'agent' ? selection.dispose : undefined;
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposal ??= Promise.resolve().then(() => release?.());
    return disposal;
  };
  let copied: SessionImageSelection['imageOperation'];
  if (selection !== undefined) {
    copied =
      selection.ownership === 'agent'
        ? Object.freeze({ run: selection.run, ownership: 'agent', dispose })
        : Object.freeze({ run: selection.run, ownership: 'caller' });
  }
  return { selection: copied, cleanupFailedConstruction: dispose };
}
