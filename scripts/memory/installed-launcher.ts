/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clearInstalledEntryLoading,
  markInstalledEntryLoading,
} from './entrypoint.ts';

markInstalledEntryLoading();
const { createInstalledLauncherRuntime, runLauncher } = await import(
  './launcher.ts'
);
clearInstalledEntryLoading();

runLauncher(
  createInstalledLauncherRuntime(import.meta.url, process.env.CLI_VERSION),
);
