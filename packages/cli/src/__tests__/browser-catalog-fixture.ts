/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { SessionRecordingService } from '@vybestack/llxprt-code-core';
import {
  bindRawBrowserCatalog,
  bindRawBrowserTargetDelete,
} from '../ui/hooks/browserCatalogHost.js';
import type { UseSessionBrowserProps } from '../ui/hooks/useSessionBrowser.js';
export type BrowserFixtureOverrides = Partial<UseSessionBrowserProps> & {
  activeRecording?: SessionRecordingService | null;
};
export function rawBrowserCatalog(
  chatsDir: string,
  projectHash: string,
  currentSessionId: string,
  activeRecording?: SessionRecordingService | null,
): Pick<UseSessionBrowserProps, 'readCatalog' | 'deleteTarget'> {
  return {
    readCatalog: bindRawBrowserCatalog(
      chatsDir,
      projectHash,
      () => currentSessionId,
      undefined,
    ),
    deleteTarget: bindRawBrowserTargetDelete(
      chatsDir,
      projectHash,
      () => activeRecording ?? null,
      undefined,
    ),
  };
}
