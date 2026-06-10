/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

export function isGitRepository(directory: string): boolean {
  try {
    let currentDir = path.resolve(directory);

    let searching = true;
    while (searching) {
      const gitDir = path.join(currentDir, '.git');
      if (fs.existsSync(gitDir)) {
        return true;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        searching = false;
      }

      if (searching) {
        currentDir = parentDir;
      }
    }

    return false;
  } catch {
    return false;
  }
}
