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
const { INSTALLED_REQUEST_USAGE, runRequestCliMain } = await import(
  './request-cli.ts'
);
clearInstalledEntryLoading();

await runRequestCliMain({
  usage: INSTALLED_REQUEST_USAGE,
  memprofileRoot: resolveInstalledMemprofileRoot(),
  startCommandHint: 'llxprt --memprofile',
});
