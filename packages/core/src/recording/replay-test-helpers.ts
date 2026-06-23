/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test helpers for ReplayEngine behavioral tests.
 */

import { expect } from 'vitest';
import * as fs from 'fs/promises';
import type { ReplayResult } from './types.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  type SessionRecordingServiceConfig,
  type SessionStartPayload,
} from './types.js';
import { type IContent } from '../services/history/IContent.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROJECT_HASH = 'abc123def456';

export type ReplayOkResult = Extract<ReplayResult, { ok: true }>;
export type ReplayErrorResult = Extract<ReplayResult, { ok: false }>;

export function assertReplayOk(
  result: ReplayResult,
): asserts result is ReplayOkResult {
  expect(result.ok).toBe(true);
}

export function assertReplayError(
  result: ReplayResult,
): asserts result is ReplayErrorResult {
  expect(result.ok).toBe(false);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeConfig(
  overrides: Partial<SessionRecordingServiceConfig> = {},
): SessionRecordingServiceConfig {
  return {
    sessionId: overrides.sessionId ?? 'test-session-00000001',
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    chatsDir: overrides.chatsDir ?? '/tmp/test-chats',
    workspaceDirs: overrides.workspaceDirs ?? ['/home/user/project'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
  };
}

export function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
  };
}

export function makeContentWithToolCall(
  toolName: string,
  params: unknown,
): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: `Calling ${toolName}` },
      {
        type: 'tool_call',
        id: `call_${toolName}`,
        name: toolName,
        parameters: params,
      },
    ],
  };
}

/**
 * Build a valid JSONL line for a session_start event.
 */
export function sessionStartLine(
  seq: number,
  overrides: Partial<SessionStartPayload> = {},
): string {
  const payload: SessionStartPayload = {
    sessionId: overrides.sessionId ?? 'test-session-00000001',
    projectHash: overrides.projectHash ?? PROJECT_HASH,
    workspaceDirs: overrides.workspaceDirs ?? ['/home/user/project'],
    provider: overrides.provider ?? 'anthropic',
    model: overrides.model ?? 'claude-4',
    startTime: overrides.startTime ?? '2026-02-11T16:00:00.000Z',
  };
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-02-11T16:00:00.000Z',
    type: 'session_start',
    payload,
  });
}

/**
 * Build a valid JSONL line for a content event.
 */
export function contentLine(seq: number, content: IContent): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'content',
    payload: { content },
  });
}

/**
 * Build a valid JSONL line for a compressed event.
 */
export function compressedLine(
  seq: number,
  summary: IContent,
  itemsCompressed: number,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'compressed',
    payload: { summary, itemsCompressed },
  });
}

/**
 * Build a valid JSONL line for a rewind event.
 */
export function rewindLine(seq: number, itemsRemoved: number): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'rewind',
    payload: { itemsRemoved },
  });
}

/**
 * Build a valid JSONL line for a provider_switch event.
 */
export function providerSwitchLine(
  seq: number,
  provider: string,
  model: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'provider_switch',
    payload: { provider, model },
  });
}

/**
 * Build a valid JSONL line for a session_event event.
 */
export function sessionEventLine(
  seq: number,
  severity: 'info' | 'warning' | 'error',
  message: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'session_event',
    payload: { severity, message },
  });
}

/**
 * Build a valid JSONL line for a directories_changed event.
 */
export function _directoriesChangedLine(
  seq: number,
  directories: string[],
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: new Date().toISOString(),
    type: 'directories_changed',
    payload: { directories },
  });
}

/**
 * Write raw JSONL lines to a file.
 */
export async function writeJsonlFile(
  filePath: string,
  lines: string[],
): Promise<void> {
  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * Use SessionRecordingService to create a valid file and return its path.
 */
export async function createValidFile(
  chatsDir: string,
  setup: (svc: SessionRecordingService) => void | Promise<void>,
  configOverrides: Partial<SessionRecordingServiceConfig> = {},
): Promise<string> {
  const config = makeConfig({ chatsDir, ...configOverrides });
  const svc = new SessionRecordingService(config);
  try {
    await setup(svc);
    await svc.flush();
    const filePath = svc.getFilePath();
    if (!filePath) {
      throw new Error(
        'createValidFile: SessionRecordingService.getFilePath() returned no path',
      );
    }
    return filePath;
  } finally {
    await svc.dispose();
  }
}
