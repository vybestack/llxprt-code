/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LocalMediaStore, type Config } from '@vybestack/llxprt-code-core';
import { SessionPersistenceService } from '@vybestack/llxprt-code-core/storage/SessionPersistenceService.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { join } from 'node:path';

const TEST_MEDIA_LIMIT_BYTES = 1024 * 1024;

type SessionMediaConfig = Pick<
  Config,
  | 'getLocalMediaStore'
  | 'getSessionRecordingQueueByteLimit'
  | 'createSessionPersistenceService'
>;

export function createTestSessionMediaConfig(
  projectTempDir: string,
): SessionMediaConfig {
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(projectTempDir, 'media'),
    quotaBytes: TEST_MEDIA_LIMIT_BYTES,
  });

  return {
    getLocalMediaStore: () => mediaStore,
    getSessionRecordingQueueByteLimit: () => TEST_MEDIA_LIMIT_BYTES,
    createSessionPersistenceService: (sessionId: string) =>
      new SessionPersistenceService(new Storage(projectTempDir), sessionId, {
        mediaStore,
        maxQueueBytes: TEST_MEDIA_LIMIT_BYTES,
      }),
  };
}
