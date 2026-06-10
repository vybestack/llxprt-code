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
import { getToolKeyStorage } from '../tools/tool-key-storage.js';

export class CoreToolKeyStorageAdapter implements IToolKeyStorage {
  async saveKey(toolName: string, key: string): Promise<void> {
    return getToolKeyStorage().saveKey(toolName, key);
  }

  async getKey(toolName: string): Promise<string | null> {
    return getToolKeyStorage().getKey(toolName);
  }

  async deleteKey(toolName: string): Promise<void> {
    return getToolKeyStorage().deleteKey(toolName);
  }

  async hasKey(toolName: string): Promise<boolean> {
    return getToolKeyStorage().hasKey(toolName);
  }

  async resolveKey(toolName: string): Promise<string | null> {
    return getToolKeyStorage().resolveKey(toolName);
  }

  maskKeyForDisplay(key: string): string {
    return maskKeyForDisplay(key);
  }

  getSupportedToolNames(): string[] {
    return getSupportedToolNames();
  }
}
