/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage } from '../config/storage.js';
import type { HookConfig } from './types.js';
import { getHookKey } from './types.js';
import { DebugLogger } from '../debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:hooks:trust');

const TRUSTED_HOOKS_FILENAME = 'trusted_hooks.json';

interface TrustedHooksData {
  trustedHooks: string[];
}

export class TrustedHooksManager {
  private trustedHooks: Set<string> = new Set();
  private readonly filePath: string;

  constructor() {
    this.filePath = path.join(
      Storage.getGlobalLlxprtDir(),
      TRUSTED_HOOKS_FILENAME,
    );
  }

  /**
   * Load trusted hooks from disk
   */
  load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(
          fs.readFileSync(this.filePath, 'utf-8'),
        ) as TrustedHooksData;
        this.trustedHooks = new Set(data.trustedHooks || []);
        debugLogger.debug(
          () => `Loaded ${this.trustedHooks.size} trusted hooks`,
        );
      }
    } catch (error) {
      debugLogger.warn(
        `Failed to load trusted hooks: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.trustedHooks = new Set();
    }
  }

  /**
   * Save trusted hooks to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data: TrustedHooksData = {
        trustedHooks: Array.from(this.trustedHooks),
      };

      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
      debugLogger.debug(() => 'Saved trusted hooks to disk');
    } catch (error) {
      debugLogger.warn(
        `Failed to save trusted hooks: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get hooks that are not yet trusted
   */
  getUntrustedHooks(hooks: HookConfig[]): HookConfig[] {
    const untrusted: HookConfig[] = [];
    for (const hook of hooks) {
      const key = getHookKey(hook);
      if (!this.trustedHooks.has(key)) {
        untrusted.push(hook);
      }
    }
    return untrusted;
  }

  /**
   * Trust a list of hooks
   */
  trustHooks(hooks: HookConfig[]): void {
    let added = false;
    for (const hook of hooks) {
      const key = getHookKey(hook);
      if (!this.trustedHooks.has(key)) {
        this.trustedHooks.add(key);
        added = true;
      }
    }

    if (added) {
      this.save();
      debugLogger.log(`Trusted ${hooks.length} hook(s)`);
    }
  }
}
