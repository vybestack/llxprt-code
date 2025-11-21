/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo } from 'react';
import { ExtensionAutoUpdater } from '../../extensions/extensionAutoUpdater.js';
import type { LoadedSettings } from '../../config/settings.js';
import type { ConsoleMessageItem } from '../types.js';

interface UseExtensionAutoUpdateOptions {
  settings: LoadedSettings;
  onConsoleMessage: (message: ConsoleMessageItem) => void;
}

export function useExtensionAutoUpdate({
  settings,
  onConsoleMessage,
}: UseExtensionAutoUpdateOptions): void {
  const autoUpdateSettings = settings.merged.extensions?.autoUpdate;
  const perExtensionSignature = useMemo(
    () => JSON.stringify(autoUpdateSettings?.perExtension ?? {}),
    [autoUpdateSettings?.perExtension],
  );

  useEffect(() => {
    if (!autoUpdateSettings?.enabled) {
      return;
    }

    const updater = new ExtensionAutoUpdater({
      settings: autoUpdateSettings,
      notify: (message, level) => {
        const type: ConsoleMessageItem['type'] =
          level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
        onConsoleMessage({
          type,
          content: message,
          count: 1,
        });
      },
    });
    const stop = updater.start();

    return () => {
      stop();
    };
  }, [
    autoUpdateSettings,
    autoUpdateSettings?.enabled,
    autoUpdateSettings?.checkIntervalHours,
    autoUpdateSettings?.installMode,
    autoUpdateSettings?.notificationLevel,
    perExtensionSignature,
    onConsoleMessage,
  ]);
}
