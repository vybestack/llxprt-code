/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the loadSession loader helpers (issue #1604 re-attach):
 * the on-disk recording probe {@link hasRecordedSessionFile} and the live
 * in-memory history bridge {@link readAgentHistoryAsIContent}. These exercise the
 * REAL chats-dir derivation + filename matching against an honest readdir-like
 * lister (directory entry names, NOT a result-shaped mock of our logic) and the
 * live neutral-history bridge against a fake agent, so no internal decision
 * logic is mocked.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';
import type { Agent, AgentMessage } from '@vybestack/llxprt-code-agents';
import {
  hasRecordedSessionFile,
  readAgentHistoryAsIContent,
  type ChatSessionFileLister,
} from './zed-session-loader.js';

const PROJECT_TEMP_DIR = '/tmp/llxprt-project-abc';
const EXPECTED_CHATS_DIR = path.join(PROJECT_TEMP_DIR, 'chats');

/** Config whose storage.getProjectChatsDir drives the chats-dir derivation. */
function buildConfig(): Config {
  return {
    storage: {
      getProjectTempDir: () => PROJECT_TEMP_DIR,
      getProjectChatsDir: () => EXPECTED_CHATS_DIR,
    },
  } as unknown as Config;
}

const FIXED_SESSION_TIMESTAMP = '2026-07-11T10-00-00';

/** The real recorded-file name shape for a session id. */
function recordedName(sessionId: string): string {
  return `session-${FIXED_SESSION_TIMESTAMP}-${sessionId.substring(0, 12)}.jsonl`;
}

describe('hasRecordedSessionFile (issue #1604 re-attach probe)', () => {
  afterEach(() => {
    // Restore any DebugLogger.prototype.warn spy installed by the C2 tests so it
    // does not leak into sibling tests.
    vi.restoreAllMocks();
  });

  it('derives the chats dir from storage.getProjectChatsDir() and reports true when a matching recording exists', async () => {
    const sessionId = 'sess-1234567890ab';
    let listedDir: string | undefined;
    const lister: ChatSessionFileLister = async (dir) => {
      listedDir = dir;
      return [recordedName(sessionId), 'session-other-000000000000.jsonl'];
    };

    const exists = await hasRecordedSessionFile(
      buildConfig(),
      sessionId,
      lister,
    );

    expect(exists).toBe(true);
    // The probe read the SAME chats dir the recording layer writes to.
    expect(listedDir).toBe(EXPECTED_CHATS_DIR);
  });

  it('reports false (→ re-attach) when NO entry matches the session id (an unprompted session with no recording)', async () => {
    const lister: ChatSessionFileLister = async () => [
      'session-unrelated-999999999999.jsonl',
      'not-a-session-file.txt',
    ];

    const exists = await hasRecordedSessionFile(
      buildConfig(),
      'sess-1234567890ab',
      lister,
    );

    expect(exists).toBe(false);
  });

  it('reports false when the chats dir is empty (fresh project, no recordings yet)', async () => {
    const lister: ChatSessionFileLister = async () => [];
    const exists = await hasRecordedSessionFile(
      buildConfig(),
      'sess-1234567890ab',
      lister,
    );
    expect(exists).toBe(false);
  });

  it('treats an ENOENT probe failure (chats dir does not exist) as no recording present (→ re-attach) WITHOUT a warn (expected case, FINDING C2)', async () => {
    // Spy on the DebugLogger the loader module uses so we can assert the ENOENT
    // case stays at debug level (no warn) — the common fresh-project path.
    const warnSpy = vi
      .spyOn(DebugLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const lister: ChatSessionFileLister = async () => {
      const error = new Error(
        'ENOENT: no such file or directory, scandir chats',
      ) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    };

    // Must resolve false (not reject): a missing directory routes to re-attach.
    await expect(
      hasRecordedSessionFile(buildConfig(), 'sess-1234567890ab', lister),
    ).resolves.toBe(false);
    // ENOENT is expected → logged at debug only, NOT warn.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('propagates a non-ENOENT probe failure instead of re-attaching without checking durable state', async () => {
    const lister: ChatSessionFileLister = async () => {
      const error = new Error(
        'EACCES: permission denied, scandir chats',
      ) as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    };

    await expect(
      hasRecordedSessionFile(buildConfig(), 'sess-1234567890ab', lister),
    ).rejects.toThrow('EACCES');
  });

  it('matches ONLY on the session id suffix, not an unrelated file that merely starts with session-', async () => {
    const sessionId = 'abcdef123456ffff';
    const lister: ChatSessionFileLister = async () => [
      // Same prefix word, DIFFERENT id suffix → must NOT match.
      `session-2026-07-11T10-00-00-abcdef000000.jsonl`,
    ];

    const exists = await hasRecordedSessionFile(
      buildConfig(),
      sessionId,
      lister,
    );
    expect(exists).toBe(false);
  });
});

describe('readAgentHistoryAsIContent (issue #1604 re-attach replay bridge)', () => {
  /** Fake agent exposing only getHistory (the sole method this helper uses). */
  function buildAgent(history: readonly AgentMessage[]): {
    agent: Agent;
    getHistory: ReturnType<typeof vi.fn>;
  } {
    const getHistory = vi.fn(async () => history);
    const agent = { getHistory } as unknown as Agent;
    return { agent, getHistory };
  }

  it('preserves the live neutral history without dropping blocks', async () => {
    const history: readonly AgentMessage[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello there' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'general kenobi' }] },
    ];
    const { agent, getHistory } = buildAgent(history);

    const items = await readAgentHistoryAsIContent(agent);

    expect(getHistory).toHaveBeenCalledTimes(1);
    expect(items).toStrictEqual(history);
    expect(items).not.toBe(history);
  });

  it('returns an empty array for a fresh unprompted session (empty live history → zero replay updates)', async () => {
    const { agent } = buildAgent([]);
    const items = await readAgentHistoryAsIContent(agent);
    expect(items).toStrictEqual([]);
  });
});
