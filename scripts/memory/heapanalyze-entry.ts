/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { runMemoryEntrypoint } from './entrypoint.ts';
import { main } from './heapanalyze.ts';
export * from './heapanalyze.ts';

const { main: isMain } = import.meta;

await runMemoryEntrypoint(isMain, main);
