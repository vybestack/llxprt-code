/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for ChatSession thinking/tool-call test files. Extracted
 * from the original monolithic chatSession.thinking-toolcalls.test.ts so no
 * file-level max-lines/no-console disable is needed.
 */

import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';

export function createConfigParams(
  settingsService: SettingsService,
): ConfigParameters {
  return {
    cwd: '/tmp',
    targetDir: '/tmp/project',
    debugMode: false,
    question: undefined,
    userMemory: '',
    embeddingModel: 'gemini-embedding',
    sandbox: undefined,
    sessionId: 'test-session',
    model: 'claude-sonnet-4-5-20250929',
    settingsService,
  };
}

export interface ThoughtPart {
  thought: true;
  text?: string;
  thoughtSignature?: string;
  llxprtSourceField?: string;
}

/**
 * Type guard mirroring the isThoughtPart predicate used by
 * ChatSession.recordHistory to extract thinking parts from consolidated model
 * output. Centralised here so multiple test files can reuse it without
 * triggering sonarjs/no-identical-functions.
 */
export function isThoughtPart(part: unknown): part is ThoughtPart {
  return (
    part != null &&
    typeof part === 'object' &&
    'thought' in part &&
    (part as { thought: unknown }).thought === true
  );
}
