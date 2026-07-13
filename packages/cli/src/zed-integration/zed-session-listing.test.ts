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
import { deriveSessionTitle } from './zed-session-info.js';
import { listRecordedSessions } from './zed-session-listing.js';

const roots: string[] = [];

describe('recorded ACP session listing', () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  describe('listing and live merging', () => {
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

    it('surfaces a live session title and updatedAt when no durable recording exists yet (issue #1609 feed)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);

      const liveSession = {
        sessionId: 'live-only-session',
        cwd: '/workspace',
        updatedAt: '2026-07-12T12:00:00.000Z',
        title: 'Live session title from first prompt',
      };

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
        [liveSession],
      );

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]).toMatchObject({
        sessionId: 'live-only-session',
        cwd: '/workspace',
        title: 'Live session title from first prompt',
        updatedAt: '2026-07-12T12:00:00.000Z',
      });
    });

    it('durable title takes precedence over live title when both exist (issue #1611 finding 6)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'merged-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      service.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Durable title from disk' }],
      });
      await service.flush();
      await service.dispose();

      const liveSession = {
        sessionId: 'merged-session',
        cwd: '/workspace',
        updatedAt: '2026-07-12T12:00:00.000Z',
        title: 'Live title that should be overridden',
      };

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
        [liveSession],
      );

      expect(result.sessions).toHaveLength(1);
      // Durable title wins over live title.
      expect(result.sessions[0].title).toBe('Durable title from disk');
    });

    it('durable + live updatedAt merges to the newer value (issue #1611 finding 6)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'freshness-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      service.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Some title' }],
      });
      await service.flush();
      await service.dispose();

      const liveSession = {
        sessionId: 'freshness-session',
        cwd: '/workspace',
        // Live updatedAt is newer than the durable file mtime.
        updatedAt: '2099-01-01T00:00:00.000Z',
        title: 'Live title',
      };

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
        [liveSession],
      );

      expect(result.sessions).toHaveLength(1);
      // updatedAt should be the live (newer) value.
      expect(result.sessions[0].updatedAt).toBe('2099-01-01T00:00:00.000Z');
    });
  });
  describe('durable + live title normalization consistency (issue #1611 finding 5)', () => {
    // The durable path (SessionDiscovery.readFirstUserMessage →
    // extractUserMessageText) joins text blocks with '' and truncates — NO trim,
    // NO newline collapse. The live path (deriveSessionTitle) must match exactly
    // so the on-disk listing title and the session_info_update title agree.
    const cases: Array<{ name: string; text: string }> = [
      { name: 'multiline', text: 'line one\nline two\nline three' },
      { name: 'leading/trailing whitespace', text: '  padded title  ' },
      { name: 'tabs', text: 'col1\tcol2' },
      { name: 'multiple text blocks', text: 'part1part2' },
    ];

    for (const { name, text } of cases) {
      it(`durable listing title matches live deriveSessionTitle for ${name}`, async () => {
        const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
        roots.push(root);
        const chatsDir = join(root, 'chats');
        await mkdir(chatsDir);
        const service = new SessionRecordingService({
          sessionId: 'consistency-session',
          projectHash: 'project-hash',
          chatsDir,
          workspaceDirs: ['/workspace'],
          cwd: '/workspace',
          provider: 'openai',
          model: 'test-model',
        });
        const content: IContent = {
          speaker: 'human',
          blocks:
            name === 'multiple text blocks'
              ? [
                  { type: 'text', text: 'part1' },
                  { type: 'text', text: 'part2' },
                ]
              : [{ type: 'text', text }],
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
        const durableTitle = result.sessions[0].title;

        const liveTitle = deriveSessionTitle(
          name === 'multiple text blocks'
            ? [
                { type: 'text', text: 'part1' },
                { type: 'text', text: 'part2' },
              ]
            : [{ type: 'text', text }],
        );

        expect(durableTitle).toBe(liveTitle);
      });
    }
  });

  describe('session_metadata title takes precedence over legacy first-human-text (issue #1611)', () => {
    it('uses the session_metadata title when present', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'metadata-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      // Record a metadata title BEFORE the content event.
      service.recordSessionMetadata('Metadata title from ACP');
      service.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Different first human text' }],
      });
      await service.flush();
      await service.dispose();

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
      );

      expect(result.sessions).toHaveLength(1);
      // The session_metadata title wins over the first-human-text fallback.
      expect(result.sessions[0].title).toBe('Metadata title from ACP');
    });

    it('falls back to first-human-text when no session_metadata event exists (legacy)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'legacy-metadata-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      // No recordSessionMetadata — legacy behavior.
      service.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Legacy first human text' }],
      });
      await service.flush();
      await service.dispose();

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
      );

      expect(result.sessions).toHaveLength(1);
      // Falls back to first-human-text for legacy sessions.
      expect(result.sessions[0].title).toBe('Legacy first human text');
    });

    it('omits title when session_metadata is explicit null (untitled)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'untitled-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      // Explicit null title.
      service.recordSessionMetadata(null);
      service.recordContent({
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Human text that should NOT be the title' },
        ],
      });
      await service.flush();
      await service.dispose();

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
      );

      expect(result.sessions).toHaveLength(1);
      // Explicit null → no title surfaced (consistent with legacy no-human-text).
      expect(result.sessions[0]).not.toHaveProperty('title');
    });

    it('exposes the creation timestamp as updatedAt for an untouched durable session', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'created-at-session',
        projectHash: 'project-hash',
        chatsDir,
        workspaceDirs: ['/workspace'],
        cwd: '/workspace',
        provider: 'openai',
        model: 'test-model',
      });
      service.recordSessionMetadata('Title');
      await service.flush();
      await service.dispose();

      const result = await listRecordedSessions(
        chatsDir,
        'project-hash',
        '/fallback',
        {},
      );

      expect(result.sessions).toHaveLength(1);
      const updatedAt = result.sessions[0].updatedAt;
      expect(updatedAt).toBeDefined();
      expect(new Date(updatedAt ?? '').toISOString()).toBe(updatedAt);
    });
  });
});
