/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import type { IStorageService } from '@vybestack/llxprt-code-tools';
import { Storage } from '@vybestack/llxprt-code-settings';

export class CoreStorageServiceAdapter implements IStorageService {
  getLLXPRTDir(): string {
    return Storage.getGlobalDataDir();
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}
