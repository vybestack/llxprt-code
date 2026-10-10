/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { resolveInstalledMemprofileRoot } from './runtime-paths.ts';

export async function main(): Promise<void> {
  const { INSTALLED_REQUEST_USAGE, runRequestCliMain } = await import(
    './request-cli.ts'
  );

  await runRequestCliMain({
    usage: INSTALLED_REQUEST_USAGE,
    memprofileRoot: resolveInstalledMemprofileRoot(),
    startCommandHint: 'llxprt --memprofile',
  });
}
