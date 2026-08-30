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
const { INSTALLED_ANALYZE_USAGE, runAnalyzeCli } = await import(
  './heapanalyze.ts'
);
clearInstalledEntryLoading();

runAnalyzeCli(INSTALLED_ANALYZE_USAGE);
