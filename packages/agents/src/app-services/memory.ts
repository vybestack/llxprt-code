/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable memory-file edits (REQ-021). Wraps the real
 * `MemoryTool.performAddMemoryEntry` static (`@vybestack/llxprt-code-tools`)
 * which appends a fact to the memory file via a real fs adapter, so
 * write→read-file round-trips. The durable target path is supplied explicitly
 * in the typed input (no live `Agent` instance required).
 */

import { promises as fs } from 'node:fs';
import { MemoryTool } from '@vybestack/llxprt-code-tools';
import type { EditMemoryInput, EditMemoryResult } from './types.js';

const fsAdapter = {
  readFile: (filePath: string, encoding: 'utf-8'): Promise<string> =>
    fs.readFile(filePath, encoding),
  writeFile: (
    filePath: string,
    data: string,
    encoding: 'utf-8',
  ): Promise<void> => fs.writeFile(filePath, data, encoding),
  mkdir: (
    dirPath: string,
    options: { recursive: boolean },
  ): Promise<string | undefined> => fs.mkdir(dirPath, options),
};

/**
 * Append a fact to the durable memory file at the provided path.
 */
export async function editMemory(
  input: EditMemoryInput,
): Promise<EditMemoryResult> {
  await MemoryTool.performAddMemoryEntry(
    input.fact,
    input.memoryFilePath,
    fsAdapter,
  );
  return { memoryFilePath: input.memoryFilePath, written: true };
}
