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

import type { ToolKeyStorage } from '@vybestack/llxprt-code-core';
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
 * Dependencies injected into {@link ToolKeysControl}.
 *
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 */
export interface ToolKeysControlDeps {
  /** Resolves the shared ToolKeyStorage (core lazy singleton). Never cached. */
  readonly getStorage: () => ToolKeyStorage;
}

/**
 * The public built-in tool-key control surface (masked).
 *
 * @plan:PLAN-20260622-COREAPIGAP.P16
 * @requirement:REQ-007
 * @pseudocode tool-keys.md steps 1-73
 */
export class ToolKeysControl implements AgentToolKeyControl {
  constructor(private readonly deps: ToolKeysControlDeps) {}

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
    const storage = this.deps.getStorage();
    const rawKey = await storage.getKey(toolName);
    const keyFile = await storage.getKeyfilePath(toolName);
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
    await this.deps.getStorage().saveKey(toolName, key);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 50-53
  async delete(toolName: string): Promise<void> {
    await this.deps.getStorage().deleteKey(toolName);
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 60-67
  async setKeyFile(toolName: string, path: string | null): Promise<void> {
    if (path === null) {
      await this.deps.getStorage().clearKeyfilePath(toolName);
    } else {
      await this.deps.getStorage().setKeyfilePath(toolName, path);
    }
  }

  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007 @pseudocode lines 70-73
  async getKeyFile(toolName: string): Promise<string | null> {
    return this.deps.getStorage().getKeyfilePath(toolName);
  }
}
