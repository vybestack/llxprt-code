/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { listRecordedSessions } from './zed-session-listing.js';

const roots: string[] = [];

describe('recorded ACP session listing', () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });
  it('returns persisted cwd, first human text title, and updated timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
    roots.push(root);
    const chatsDir = join(root, 'chats');
    await mkdir(chatsDir);
    const service = new SessionRecordingService({
      sessionId: 'listed-session',
      projectHash: 'project-hash',
      chatsDir,
      workspaceDirs: ['/workspace'],
      cwd: '/workspace',
      provider: 'openai',
      model: 'test-model',
    });
    const content: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Investigate session lifecycle' }],
    };
    service.recordContent(content);
    await service.flush();
    await service.dispose();

    const result = await listRecordedSessions(
      chatsDir,
      'project-hash',
      '/fallback',
      {},
    );

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: 'listed-session',
      cwd: '/workspace',
      title: 'Investigate session lifecycle',
    });
    expect(result.sessions[0].updatedAt).toStrictEqual(expect.any(String));
  });

  it('uses the fallback cwd and omits title for legacy non-human sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
    roots.push(root);
    const chatsDir = join(root, 'chats');
    await mkdir(chatsDir);
    const service = new SessionRecordingService({
      sessionId: 'legacy-session',
      projectHash: 'project-hash',
      chatsDir,
      workspaceDirs: [],
      provider: 'openai',
      model: 'test-model',
    });
    service.recordContent({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'agent-only content' }],
    });
    await service.flush();
    await service.dispose();

    const result = await listRecordedSessions(
      chatsDir,
      'project-hash',
      '/fallback',
      {},
    );

    expect(result.sessions[0].cwd).toBe('/fallback');
    expect(result.sessions[0]).not.toHaveProperty('title');
    expect(Number.isNaN(Date.parse(result.sessions[0].updatedAt ?? ''))).toBe(
      false,
    );
  });
});
