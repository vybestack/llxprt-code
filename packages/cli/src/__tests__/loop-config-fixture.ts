/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { PolicyEngine } from '@vybestack/llxprt-code-core/policy/policy-engine.js';
import { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export interface LoopConfigRoot {
  readonly config: Config;
  readonly directory: string;
  readonly settingsOwner: SessionSettingsOwner;
}
export function createLoopConfig(
  options: {
    messageBus: MessageBus;
    toolRegistry: ToolRegistry;
    policyEngine: PolicyEngine;
    interactive: boolean;
    approvalMode?: ApprovalMode;
  },
  retain: (root: LoopConfigRoot) => void,
): LoopConfigRoot & { readonly settingsService: SettingsService } {
  const directory = mkdtempSync(join(tmpdir(), 'llxprt-loop-integration-'));
  const config = new Config({
    sessionId: 'loop-integration-test',
    targetDir: directory,
    cwd: directory,
    model: 'test-model',
    debugMode: false,
    approvalMode: options.approvalMode ?? ApprovalMode.YOLO,
    interactive: options.interactive,
  });
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const root = { config, directory, settingsOwner, settingsService };
  retain(root);
  return root;
}
