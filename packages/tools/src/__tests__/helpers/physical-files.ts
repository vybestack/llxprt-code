/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import type { IToolHostFileSystemService } from '../../interfaces/index.js';

export const physicalFiles: IToolHostFileSystemService = {
  readTextFile: (filePath) => fs.readFile(filePath, 'utf8'),
  writeTextFile: (filePath, content) => fs.writeFile(filePath, content, 'utf8'),
};
