/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  clearInstalledEntryLoading,
  markInstalledEntryLoading,
} from './entrypoint.ts';
import { resolveInstalledMemprofileRoot } from './runtime-paths.ts';

markInstalledEntryLoading();
const { INSTALLED_REPORT_USAGE, runReportCliMain } = await import(
  './report.ts'
);
clearInstalledEntryLoading();

runReportCliMain({
  usage: INSTALLED_REPORT_USAGE,
  memprofileRoot: resolveInstalledMemprofileRoot(),
  startCommandHint: 'llxprt --memprofile',
});
