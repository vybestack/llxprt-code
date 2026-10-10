/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runMemoryEntrypoint } from './entrypoint.ts';
import { main } from './launcher.ts';
export * from './launcher.ts';

const { main: isMain } = import.meta;

await runMemoryEntrypoint(isMain, main);
