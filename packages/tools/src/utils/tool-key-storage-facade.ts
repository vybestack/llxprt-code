/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IToolKeyStorage } from '../interfaces/IToolKeyStorage.js';
import {
  getSupportedToolNames,
  getToolKeyEntry,
  isValidToolKeyName,
  maskKeyForDisplay,
  type ToolKeyRegistryEntry,
} from './tool-key-storage-types.js';

/**
 * Tools-package facade over an injected tool-key storage implementation.
 *
 * The concrete persistence mechanism remains outside packages/tools. Core
 * supplies SecureStore-backed persistence through CoreToolKeyStorageAdapter,
 * while tools own registry metadata, display helpers, and this stable boundary.
 */
export class ToolKeyStorageFacade implements IToolKeyStorage {
  constructor(private readonly storage: IToolKeyStorage) {}

  async saveKey(toolName: string, key: string): Promise<void> {
    this.assertSupportedTool(toolName);
    await this.storage.saveKey(toolName, key);
  }

  async getKey(toolName: string): Promise<string | null> {
    this.assertSupportedTool(toolName);
    return this.storage.getKey(toolName);
  }

  async deleteKey(toolName: string): Promise<void> {
    this.assertSupportedTool(toolName);
    await this.storage.deleteKey(toolName);
  }

  async hasKey(toolName: string): Promise<boolean> {
    this.assertSupportedTool(toolName);
    return this.storage.hasKey(toolName);
  }

  async resolveKey(toolName: string): Promise<string | null> {
    this.assertSupportedTool(toolName);
    return this.storage.resolveKey(toolName);
  }

  maskKeyForDisplay(key: string): string {
    return maskKeyForDisplay(key);
  }

  getSupportedToolNames(): string[] {
    return getSupportedToolNames();
  }

  getToolKeyEntry(toolName: string): ToolKeyRegistryEntry | undefined {
    return getToolKeyEntry(toolName);
  }

  isValidToolKeyName(toolName: string): boolean {
    return isValidToolKeyName(toolName);
  }

  private assertSupportedTool(toolName: string): void {
    if (!isValidToolKeyName(toolName)) {
      throw new Error(`Unsupported tool key storage name: ${toolName}`);
    }
  }
}
