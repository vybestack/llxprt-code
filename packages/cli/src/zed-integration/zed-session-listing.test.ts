/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
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

function recordedSessionUpdatedAtIsInvalid(
  updatedAt: string | null | undefined,
): boolean {
  return Number.isNaN(Date.parse(updatedAt ?? ''));
}

function normalizeRecordedSessionUpdatedAt(
  updatedAt: string | null | undefined,
): string {
  return updatedAt ?? '';
}

function firstRecordedSessionUpdatedAt(
  sessions: Awaited<ReturnType<typeof listRecordedSessions>>['sessions'],
): string | null | undefined {
  const session = sessions.at(0);
  if (session === undefined) {
    throw new Error('Expected one recorded session');
  }
  return session.updatedAt;
}

describe('recorded ACP session listing', () => {
  afterEach(async () => {
    await Promise.allSettled(
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

    async function verifyUsesTheFallbackCwdAndOmitsTitleForLegacyNonHumanSessions() {
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
      const session = result.sessions[0];

      return session;
    }

    it('uses the fallback cwd and omits title for legacy non-human sessions', async () => {
      const session =
        await verifyUsesTheFallbackCwdAndOmitsTitleForLegacyNonHumanSessions();

      expect(session.cwd).toBe('/fallback');
      expect(session).not.toHaveProperty('title');
      expect(recordedSessionUpdatedAtIsInvalid(session.updatedAt)).toBe(false);
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

    it('preserves the durable updatedAt when it is newer than the live value', async () => {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const service = new SessionRecordingService({
        sessionId: 'durable-newer-session',
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
        sessionId: 'durable-newer-session',
        cwd: '/workspace',
        // Live updatedAt is older than the durable file mtime.
        updatedAt: '2000-01-01T00:00:00.000Z',
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
      // Durable mtime is newer than the live value, so it should be preserved.
      expect(result.sessions[0].updatedAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(new Date(result.sessions[0].updatedAt!).getTime()).toBeGreaterThan(
        new Date('2000-01-01T00:00:00.000Z').getTime(),
      );
    });
  });
  describe('durable + live title normalization consistency (issue #1611 finding 5)', () => {
    // The durable path (SessionDiscovery.readFirstUserMessage →
    // extractUserMessageText) joins text blocks with '' and truncates — NO trim,
    // NO newline collapse. The live path (deriveSessionTitle) must match exactly
    // so the on-disk listing title and the session_info_update title agree.

    function buildBlocks(name: string, text: string) {
      return name === 'multiple text blocks'
        ? [
            { type: 'text' as const, text: 'part1' },
            { type: 'text' as const, text: 'part2' },
          ]
        : [{ type: 'text' as const, text }];
    }

    const cases: Array<{ name: string; text: string }> = [
      { name: 'multiline', text: 'line one\nline two\nline three' },
      { name: 'leading/trailing whitespace', text: '  padded title  ' },
      { name: 'tabs', text: 'col1\tcol2' },
      { name: 'multiple text blocks', text: 'part1part2' },
      { name: 'truncation (>120 chars)', text: 'z'.repeat(200) },
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
        const blocks = buildBlocks(name, text);
        const content: IContent = {
          speaker: 'human',
          blocks,
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

        const liveTitle = deriveSessionTitle(blocks);

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

    async function verifyExposesTheCreationTimestampAsUpdatedAtForAnUntouchedDurableSession() {
      const root = await mkdtemp(join(tmpdir(), 'zed-session-list-'));
      roots.push(root);
      const chatsDir = join(root, 'chats');
      await mkdir(chatsDir);
      const startedAt = Date.now();
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
      return {
        sessions: result.sessions,
        startedAt,
      };
    }

    it('exposes the creation timestamp as updatedAt for an untouched durable session', async () => {
      const behaviorResult =
        await verifyExposesTheCreationTimestampAsUpdatedAtForAnUntouchedDurableSession();

      expect(behaviorResult.sessions).toHaveLength(1);
      const updatedAt = firstRecordedSessionUpdatedAt(behaviorResult.sessions);
      expect(updatedAt).toBeDefined();
      const normalizedUpdatedAt = normalizeRecordedSessionUpdatedAt(updatedAt);
      expect(new Date(normalizedUpdatedAt).toISOString()).toBe(
        normalizedUpdatedAt,
      );
      // The assertion under test is that updatedAt is the session's creation
      // time, not that two clock reads agree to the millisecond. The default
      // Windows system timer ticks about every 15.6ms, so `startedAt` and the
      // recorder's own timestamp can legitimately disagree by close to a full
      // tick in either direction; a 1ms allowance was too tight and flaked on
      // the Windows runner with "expected T to be >= T+1".
      const CLOCK_GRANULARITY_MS = 32;
      const updatedAtTime = new Date(normalizedUpdatedAt).getTime();
      expect(updatedAtTime).toBeGreaterThanOrEqual(
        behaviorResult.startedAt - CLOCK_GRANULARITY_MS,
      );
      expect(updatedAtTime).toBeLessThanOrEqual(Date.now());
    });
  });
});
