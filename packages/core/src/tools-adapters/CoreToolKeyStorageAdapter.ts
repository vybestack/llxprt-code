/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getSupportedToolNames,
  maskKeyForDisplay,
  type IToolKeyStorage,
} from '@vybestack/llxprt-code-tools';
import type { ToolKeyStorage } from '../tools/tool-key-storage.js';

export class CoreToolKeyStorageAdapter implements IToolKeyStorage {
  constructor(
    private readonly storage: Pick<
      ToolKeyStorage,
      'saveKey' | 'getKey' | 'deleteKey' | 'hasKey' | 'resolveKey'
    >,
  ) {}

  async saveKey(toolName: string, key: string): Promise<void> {
    return this.storage.saveKey(toolName, key);
  }

  async getKey(toolName: string): Promise<string | null> {
    return this.storage.getKey(toolName);
  }

  async deleteKey(toolName: string): Promise<void> {
    return this.storage.deleteKey(toolName);
  }

  async hasKey(toolName: string): Promise<boolean> {
    return this.storage.hasKey(toolName);
  }

  async resolveKey(toolName: string): Promise<string | null> {
    return this.storage.resolveKey(toolName);
  }

  maskKeyForDisplay(key: string): string {
    return maskKeyForDisplay(key);
  }

  getSupportedToolNames(): string[] {
    return getSupportedToolNames();
  }
}
