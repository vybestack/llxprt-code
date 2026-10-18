import { getToolKeyStorage } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 * @pseudocode tool-keys.md steps 1-73
 *
 * Built-in TOOL key storage (Exa, etc.), exposed as `agent.tools.keys`.
 * DISTINCT from `agent.auth.keys` (provider-auth keys). Masked: the raw key
 * never crosses the API boundary (R-NO-RAW-SECRETS). Tool-name validation is
 * owned by ToolKeyStorage.assertValidToolName (invoked inside every storage
 * call); its throw propagates (delegate, never swallow).
 */

import {
  getSupportedToolNames,
  getToolKeyEntry,
  maskKeyForDisplay,
} from '@vybestack/llxprt-code-core';
import type {
  AgentToolKeyControl,
  ToolKeyInfo,
  ToolKeyStatus,
} from '../agent.js';

/**
 * The public built-in tool-key control surface (masked).
 *
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 * @pseudocode tool-keys.md steps 1-73
 */
export class ToolKeysControl implements AgentToolKeyControl {
  constructor(
    private readonly readKeyRecord: (name: string) => Promise<{
      key: string | null;
      keyFile: string | null;
    }>,
    private readonly saveKey: (name: string, key: string) => Promise<void>,
    private readonly deleteKey: (name: string) => Promise<void>,
    private readonly writeKeyfile: (
      name: string,
      file: string,
    ) => Promise<void>,
    private readonly clearKeyfile: (name: string) => Promise<void>,
    private readonly readKeyfile: (name: string) => Promise<string | null>,
  ) {}

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 1-11
  supported(): readonly ToolKeyInfo[] {
    const out: ToolKeyInfo[] = [];
    for (const name of getSupportedToolNames()) {
      const entry = getToolKeyEntry(name);
      if (entry === undefined) {
        continue;
      }
      out.push({
        toolName: entry.toolKeyName,
        displayName: entry.displayName,
        description: entry.description,
      });
    }
    return out;
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 20-34
  async status(toolName: string): Promise<ToolKeyStatus> {
    const { key: rawKey, keyFile } = await this.readKeyRecord(toolName);
    if (rawKey !== null) {
      return {
        toolName,
        hasKey: true,
        maskedKey: maskKeyForDisplay(rawKey),
        ...(keyFile !== null ? { keyFile } : {}),
      };
    }
    return {
      toolName,
      hasKey: false,
      ...(keyFile !== null ? { keyFile } : {}),
    };
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 40-43
  async save(toolName: string, key: string): Promise<void> {
    await this.saveKey(toolName, key);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 50-53
  async delete(toolName: string): Promise<void> {
    await this.deleteKey(toolName);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 60-67
  async setKeyFile(toolName: string, path: string | null): Promise<void> {
    if (path === null) {
      await this.clearKeyfile(toolName);
    } else {
      await this.writeKeyfile(toolName, path);
    }
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 70-73
  async getKeyFile(toolName: string): Promise<string | null> {
    return this.readKeyfile(toolName);
  }
}

export function assembleToolKeys(): ToolKeysControl {
  return new ToolKeysControl(
    async (name) => {
      const storage = getToolKeyStorage();
      return {
        key: await storage.getKey(name),
        keyFile: await storage.getKeyfilePath(name),
      };
    },
    (name, key) => getToolKeyStorage().saveKey(name, key),
    (name) => getToolKeyStorage().deleteKey(name),
    (name, file) => getToolKeyStorage().setKeyfilePath(name, file),
    (name) => getToolKeyStorage().clearKeyfilePath(name),
    (name) => getToolKeyStorage().getKeyfilePath(name),
  );
}
