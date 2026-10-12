/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveInstalledMemprofileRoot } from './runtime-paths.ts';

export async function main(): Promise<void> {
  const { INSTALLED_REPORT_USAGE, runReportCliMain } = await import(
    './report.ts'
  );

  runReportCliMain({
    usage: INSTALLED_REPORT_USAGE,
    memprofileRoot: resolveInstalledMemprofileRoot(),
    startCommandHint: 'llxprt --memprofile',
  });
}
