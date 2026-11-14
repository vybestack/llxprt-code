/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

export function installChatSessionFactoryConfigFixture(): (
  model?: string,
  providedInstructions?: string,
) => Config {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories) {
      rmSync(directory, { recursive: true, force: true });
    }
    directories.length = 0;
  });

  return (
    model = 'gemini-2.5-flash',
    providedInstructions = 'user memory text',
  ): Config => {
    const directory = mkdtempSync(join(tmpdir(), 'agent-chat-factory-'));
    directories.push(directory);
    const settingsService = new SettingsService();
    const config = new Config({
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      question: undefined,
      userMemory: providedInstructions,
      embeddingModel: 'gemini-embedding',
      sandbox: undefined,
      sessionId: 'test-session-id',
      model,
      initialSettings: settingsService.getAllGlobalSettings(),
    });
    return config;
  };
}
