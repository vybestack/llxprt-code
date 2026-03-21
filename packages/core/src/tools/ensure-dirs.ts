/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fsPromises } from 'fs';
import * as path from 'path';

/**
 * Ensures that the parent directories for a file path exist, creating them if necessary.
 * @param filePath - The absolute path to the file
 */
export async function ensureParentDirectoriesExist(
  filePath: string,
): Promise<void> {
  const dirName = path.dirname(filePath);
  try {
    await fsPromises.access(dirName);
  } catch {
    await fsPromises.mkdir(dirName, { recursive: true });
  }
}
