/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the session_metadata recording event (issue #1611).
 *
 * Verifies:
 * - recordSessionMetadata writes a typed session_metadata event (not a
 *   session_event sentinel) to the JSONL file.
 * - The title is tri-state: string (concrete), null (explicit untitled).
 * - session_metadata materializes the recording file BEFORE any content event,
 *   so slash/failure sessions persist their metadata.
 * - ReplayEngine restores the tri-state title from session_metadata events.
 * - SessionDiscovery.readSessionMetadataTitle extracts the tri-state title.
 */

import { assert, describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { replaySession } from './ReplayEngine.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  makeConfig,
  sessionStartLine,
  sessionMetadataLine,
  contentLine,
  makeContent,
  writeJsonlFile,
  PROJECT_HASH,
  assertReplayOk,
} from './replay-test-helpers.js';

const tempDirs: string[] = [];
const services: SessionRecordingService[] = [];

describe('session_metadata recording (issue #1611)', () => {
  afterEach(async () => {
    await Promise.allSettled(
      services.splice(0).map((service) => service.dispose()),
    );
    await Promise.allSettled(
      tempDirs
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  async function makeTempChatsDir(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-metadata-'));
    tempDirs.push(dir);
    const chatsDir = path.join(dir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    return chatsDir;
  }

  describe('SessionRecordingService.recordSessionMetadata', () => {
    it('writes a typed session_metadata event (not a session_event sentinel)', async () => {
      const chatsDir = await makeTempChatsDir();
      const service = new SessionRecordingService(makeConfig({ chatsDir }));
      services.push(service);

      service.recordSessionMetadata('My session title');
      await service.flush();

      const filePath = service.getFilePath();
      assert(filePath !== null);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const lines = fileContent.trim().split('\n');
      const types = lines.map((line) => JSON.parse(line).type);

      expect(types).toContain('session_metadata');
      const metadataLine = lines
        .map((line) => JSON.parse(line))
        .find((line) => line.type === 'session_metadata');
      expect(metadataLine.payload).toStrictEqual({ title: 'My session title' });
    });

    it('records a null title for explicit untitled', async () => {
      const chatsDir = await makeTempChatsDir();
      const service = new SessionRecordingService(makeConfig({ chatsDir }));
      services.push(service);

      service.recordSessionMetadata(null);
      await service.flush();

      const filePath = service.getFilePath();
      assert(filePath !== null);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const metadataLine = fileContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((line) => line.type === 'session_metadata');
      expect(metadataLine.payload).toStrictEqual({ title: null });
    });

    it('materializes the recording BEFORE any content event (slash/failure sessions)', async () => {
      const chatsDir = await makeTempChatsDir();
      const service = new SessionRecordingService(makeConfig({ chatsDir }));
      services.push(service);

      service.recordSessionMetadata('Slash command title');
      await service.flush();

      const filePath = service.getFilePath();
      assert(filePath !== null);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const types = fileContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).type);
      expect(types).toContain('session_start');
      expect(types).toContain('session_metadata');
      expect(types).not.toContain('content');
    });

    it('preserves ordering: session_start before session_metadata before content', async () => {
      const chatsDir = await makeTempChatsDir();
      const service = new SessionRecordingService(makeConfig({ chatsDir }));
      services.push(service);

      service.recordSessionMetadata('Ordered title');
      service.recordContent(makeContent('hello'));
      await service.flush();

      const filePath = service.getFilePath();
      assert(filePath !== null);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const types = fileContent
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).type);
      const startIdx = types.indexOf('session_start');
      const metaIdx = types.indexOf('session_metadata');
      const contentIdx = types.indexOf('content');
      expect(startIdx).toBeLessThan(metaIdx);
      expect(metaIdx).toBeLessThan(contentIdx);
    });
  });

  describe('ReplayEngine session_metadata handling', () => {
    it('replays a string title from session_metadata', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-meta-str.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, 'Replayed title'),
        contentLine(3, makeContent('hello')),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(result);
      expect(result.metadata.title).toBe('Replayed title');
    });

    it('replays a null title (explicit untitled)', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-meta-null.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, null),
        contentLine(3, makeContent('hello')),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(result);
      expect(result.metadata.title).toBeNull();
    });

    it('leaves title undefined (legacy) when no session_metadata event exists', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-legacy.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        contentLine(2, makeContent('hello')),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(result);
      expect(result.metadata.title).toBeUndefined();
    });

    it('last session_metadata title wins when multiple exist', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-meta-multi.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, 'First title'),
        contentLine(3, makeContent('turn 1')),
        sessionMetadataLine(4, 'Updated title'),
        contentLine(5, makeContent('turn 2')),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(result);
      expect(result.metadata.title).toBe('Updated title');
    });

    it('returns a fatal replay error when session_metadata precedes session_start', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-meta-early.jsonl');
      await writeJsonlFile(filePath, [
        sessionMetadataLine(1, 'Too early'),
        sessionStartLine(2),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      expect(result.ok).toBe(false);
    });

    it('records a warning for malformed session_metadata title (non-string, non-null)', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-test-meta-malformed.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        JSON.stringify({
          v: 1,
          seq: 2,
          ts: '2026-07-12T00:00:00.000Z',
          type: 'session_metadata',
          payload: { title: 12345 },
        }),
        contentLine(3, makeContent('hello')),
      ]);

      const result = await replaySession(filePath, PROJECT_HASH);
      assertReplayOk(result);
      expect(
        result.warnings.some((w) => w.includes('malformed session_metadata')),
      ).toBe(true);
    });
  });

  describe('SessionDiscovery.readSessionMetadataTitle', () => {
    it('reads a string title from a session_metadata event', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-discovery-str.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, 'Discovery title'),
      ]);

      const title = await SessionDiscovery.readSessionMetadataTitle(filePath);
      expect(title).toBe('Discovery title');
    });

    it('reads null for explicit untitled', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-discovery-null.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, null),
      ]);

      const title = await SessionDiscovery.readSessionMetadataTitle(filePath);
      expect(title).toBeNull();
    });

    it('returns undefined when no session_metadata event exists (legacy)', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-discovery-legacy.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        contentLine(2, makeContent('hello')),
      ]);

      const title = await SessionDiscovery.readSessionMetadataTitle(filePath);
      expect(title).toBeUndefined();
    });

    it('returns undefined when the source stream cannot be opened', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'missing-session.jsonl');

      const title = await SessionDiscovery.readSessionMetadataTitle(filePath);

      expect(title).toBeUndefined();
    });

    it('reads the last valid session_metadata title when multiple exist', async () => {
      const chatsDir = await makeTempChatsDir();
      const filePath = path.join(chatsDir, 'session-discovery-multi.jsonl');
      await writeJsonlFile(filePath, [
        sessionStartLine(1),
        sessionMetadataLine(2, 'First metadata'),
        contentLine(3, makeContent('turn')),
        sessionMetadataLine(4, 'Second metadata'),
      ]);

      const title = await SessionDiscovery.readSessionMetadataTitle(filePath);
      expect(title).toBe('Second metadata');
    });
  });

  describe('SessionSummary createdAt (immutable ordering)', () => {
    it('includes createdAt from session_start.startTime', async () => {
      const chatsDir = await makeTempChatsDir();
      const service = new SessionRecordingService(makeConfig({ chatsDir }));
      services.push(service);
      service.recordContent(makeContent('hello'));
      await service.flush();

      const sessions = await SessionDiscovery.listSessions(
        chatsDir,
        PROJECT_HASH,
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0].createdAt).toBeDefined();
      expect(typeof sessions[0].createdAt).toBe('string');
      expect(Number.isNaN(Date.parse(sessions[0].createdAt!))).toBe(false);
    });
  });
});
