/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeps the advertised tool declarations in step with `/set code-mode` and
 * `/set code-mode-tool-surface` (issue #4084). Lookups read the settings
 * live; the declarations the chat sends are published, so a change to either
 * setting republishes them for the next model request.
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:agents:code-mode');

const SURFACE_KEYS: ReadonlySet<string> = new Set([
  'code-mode',
  'code-mode-tool-surface',
]);

export type SettingChangeSubscription = (
  changed: (key: string) => void,
) => () => void;

/**
 * Republishes the session's tool declarations whenever a surface setting
 * changes. Returns the release of the subscription.
 */
export function republishOnCodeModeChange(
  subscribe: SettingChangeSubscription,
  publish: () => Promise<void>,
): () => void {
  return subscribe((key) => {
    if (!SURFACE_KEYS.has(key)) return;
    // The settings write that triggered this must not fail because of the
    // publication; a failure leaves the previous declarations in place while
    // lookups already follow the new setting, so it is logged.
    void Promise.resolve()
      .then(publish)
      .catch((error: unknown) => {
        logger.warn(
          () =>
            `Could not republish tools after ${key} changed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  });
}
