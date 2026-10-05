/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, type Mock } from 'bun:test';
import * as fs from 'node:fs';
import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionPersistenceService } from './SessionPersistenceService.js';

export function createSessionPersistenceFixture(): {
  readonly storage: Storage;
  readonly service: SessionPersistenceService;
} {
  vi.clearAllMocks();
  vi.spyOn(fs.promises, 'mkdir').mockImplementation(async () => undefined);
  vi.spyOn(fs.promises, 'writeFile').mockImplementation(async () => undefined);
  vi.spyOn(fs.promises, 'rename').mockImplementation(async () => undefined);
  vi.spyOn(fs.promises, 'readdir').mockImplementation(async () => []);
  // These tests read UTF-8 sessions. Node's last readFile overload describes
  // Buffer reads, while the test's default stub returns UTF-8 text.
  vi.spyOn(fs.promises, 'readFile').mockImplementation(
    (async () => '') as unknown as typeof fs.promises.readFile,
  );
  const storage = new Storage('/test/project');
  return {
    storage,
    service: new SessionPersistenceService(storage, 'test-session-123'),
  };
}

export function readdirMock(): Mock<typeof fs.promises.readdir> {
  return fs.promises.readdir as unknown as Mock<typeof fs.promises.readdir>;
}

export function configureSaveMocks(): void {
  (fs.promises.mkdir as Mock<typeof fs.promises.mkdir>).mockResolvedValue(
    undefined,
  );
  (
    fs.promises.writeFile as Mock<typeof fs.promises.writeFile>
  ).mockResolvedValue();
  (fs.promises.rename as Mock<typeof fs.promises.rename>).mockResolvedValue();
}

interface PersistedTimestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function persistedTimestamps(content: unknown): PersistedTimestamps {
  if (typeof content !== 'string') {
    throw new Error('Expected session persistence to write UTF-8 text');
  }
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error('Persisted session must be an object');
  }
  const { createdAt, updatedAt } = parsed;
  if (typeof createdAt !== 'string') {
    throw new Error('Persisted session is missing createdAt');
  }
  if (typeof updatedAt !== 'string') {
    throw new Error('Persisted session is missing updatedAt');
  }
  return { createdAt, updatedAt };
}

export function speakerForIndex(i: number): string {
  return i % 2 === 0 ? 'human' : 'model';
}
